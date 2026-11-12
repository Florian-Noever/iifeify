import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

import { bundle, checkOptions } from '../src/bundle.js';
import { ConversionError, UsageError } from '../src/errors.js';
import { tempTree } from './helpers.js';

/** Bundles the package "widget" from a made-up node_modules tree, the way convert() does after npm install. */
function bundleWidget(t, files, options = {}) {
    const workDir = tempTree(t, files);
    return bundle({
        workDir,
        name: 'widget',
        dir: join(workDir, 'node_modules', 'widget'),
        label: 'widget 1.0.0',
        globalName: 'Widget',
        minify: true,
        ...options,
    });
}

/** Runs a script the way a browser runs a classic script, and returns the globals it defines. */
function run(script) {
    const globals = {};
    vm.runInNewContext(script, globals);
    return globals;
}

const paths = (files, workDir) => files.map(file => file.slice(workDir.length + 1).replaceAll('\\', '/')).sort();

test('bundles a package and its dependency into one global', async t => {
    const built = await bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', exports: './index.js' },
        'node_modules/widget/index.js': `
            import twice from 'twice';
            export const four = twice(2);
            export default function hello() { return 'hello'; }`,
        'node_modules/twice/package.json': { name: 'twice', version: '0.1.0', main: 'index.js' },
        'node_modules/twice/index.js': '/*! twice 0.1.0 | ISC */\nmodule.exports = n => n * 2;',
        'node_modules/unused/package.json': { name: 'unused', version: '9.9.9', main: 'index.js' },
        'node_modules/unused/index.js': 'module.exports = "never imported";',
    });

    const { Widget } = run(built.js);
    assert.equal(Widget.four, 4);
    assert.equal(Widget.default(), 'hello');

    const workDir = join(built.entry, '..', '..', '..');
    assert.deepEqual(paths([built.entry], workDir), ['node_modules/widget/index.js']);
    assert.deepEqual(paths(built.inputs, workDir), ['node_modules/twice/index.js', 'node_modules/widget/index.js']);
    assert.ok(
        built.js.endsWith('\n/*! Bundled license information:\n\ntwice/index.js:\n  (*! twice 0.1.0 | ISC *)\n*/\n'),
        'license comments of dependencies are kept at the end'
    );
    assert.equal(built.css, undefined);
    assert.deepEqual(built.warnings, []);
});

test('a CommonJS package becomes the global itself', async t => {
    const built = await bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', main: 'index.js' },
        'node_modules/widget/index.js': 'module.exports = function widget() { return process.env.NODE_ENV; };',
    }, { minify: false });

    assert.equal(run(built.js).Widget(), 'production');
    assert.match(built.js, /function widget\(\)/, 'not minified');
});

test('rejects a package that imports Node built-ins', async t => {
    const failed = bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', main: 'index.js' },
        'node_modules/widget/index.js': `
            import { readFileSync } from 'node:fs';
            import path from 'path';
            import { readFile } from 'fs/promises';
            export const read = file => readFileSync(path.resolve(file));`,
    });

    await assert.rejects(failed, error => {
        assert.ok(error instanceof ConversionError);
        assert.match(error.message, /^widget 1\.0\.0 is not browser compatible: it needs the Node\.js built-in modules fs, fs\/promises, path\.\n/);
        assert.match(error.message, /node_modules\/widget\/index\.js:2:/, 'says where the import is');
        assert.doesNotMatch(error.message, /platform/, 'no advice about esbuild options');
        return true;
    });
});

test('accepts built-ins that the package switches off or guards', async t => {
    const built = await bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', main: 'index.js', browser: { fs: false } },
        'node_modules/widget/index.js': `
            const fs = require('fs');
            let os;
            try { os = require('os'); } catch {}
            module.exports = { hasFs: typeof fs.readFileSync === 'function', hasOs: os !== undefined };`,
    });
    assert.deepEqual({ ...run(built.js).Widget }, { hasFs: false, hasOs: false });
});

test('resolves the entry like an import in browser code', async t => {
    const files = {
        'node_modules/widget/browser.js': 'export const kind = "browser";',
        'node_modules/widget/esm.js': 'export const kind = "esm";',
        'node_modules/widget/cjs.js': 'exports.kind = "cjs";',
    };
    const kindWith = async manifest => {
        const built = await bundleWidget(t, { ...files, 'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', ...manifest } });
        return run(built.js).Widget.kind;
    };

    assert.equal(await kindWith({ exports: { '.': { browser: './browser.js', import: './esm.js', require: './cjs.js' } } }), 'browser');
    assert.equal(await kindWith({ exports: { '.': { import: './esm.js', require: './cjs.js' } } }), 'esm');
    assert.equal(await kindWith({ main: 'cjs.js', module: 'esm.js', browser: 'browser.js' }), 'browser');
    assert.equal(await kindWith({ main: 'cjs.js', module: 'esm.js' }), 'esm');
    assert.equal(await kindWith({ main: 'cjs.js' }), 'cjs');
});

test('a package without an importable entry needs --entry', async t => {
    const files = {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', exports: { '.': { require: './cjs.js' } } },
        'node_modules/widget/cjs.js': 'exports.kind = "cjs";',
    };
    await assert.rejects(bundleWidget(t, files), error => {
        assert.ok(error instanceof ConversionError);
        assert.match(error.message, /^widget 1\.0\.0 has no entry point that can be imported in a browser\. Use --entry /);
        return true;
    });

    const built = await bundleWidget(t, files, { entry: 'cjs.js' });
    assert.equal(run(built.js).Widget.kind, 'cjs');
});

test('--entry names a file or an exported subpath', async t => {
    const files = {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', exports: { '.': './index.js', './extra': './lib/extra.js' } },
        'node_modules/widget/index.js': 'export const kind = "index";',
        'node_modules/widget/lib/extra.js': 'export const kind = "extra";',
        'node_modules/widget/dist/standalone.js': 'export const kind = "standalone";',
    };
    const kindOf = async entry => run((await bundleWidget(t, files, { entry })).js).Widget.kind;

    assert.equal(await kindOf('dist/standalone.js'), 'standalone', 'a file that "exports" does not list');
    assert.equal(await kindOf('./dist/standalone.js'), 'standalone');
    assert.equal(await kindOf('extra'), 'extra', 'a subpath that "exports" maps to another file');

    await assert.rejects(bundleWidget(t, files, { entry: 'missing.js' }), error => {
        assert.ok(error instanceof ConversionError);
        assert.match(error.message, /^widget 1\.0\.0 has no file or export "missing\.js"\./);
        return true;
    });
});

test('--entry cannot leave the package', async t => {
    const files = {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', main: 'index.js' },
        'node_modules/widget/index.js': 'module.exports = 1;',
        'node_modules/other/index.js': 'module.exports = 2;',
    };
    await assert.rejects(bundleWidget(t, files, { entry: '../other/index.js' }), UsageError);
});

test('CSS that the package imports comes out as a stylesheet', async t => {
    const built = await bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', main: 'index.js' },
        'node_modules/widget/index.js': 'import "./style.css";\nexport const styled = true;',
        'node_modules/widget/style.css': '.widget { color: red; }',
    });
    assert.equal(run(built.js).Widget.styled, true);
    assert.ok(built.css, 'a stylesheet');
    assert.match(built.css, /\.widget\{color:red\}/);
});

test('checks the global name and the target before anything is installed', async () => {
    await checkOptions({});
    await checkOptions({ globalName: 'My.Lib.widget', target: ['es2017', 'chrome80'] });

    await assert.rejects(checkOptions({ globalName: 'my-widget' }), error => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /^--global-name "my-widget" is not a valid name\. /);
        return true;
    });
    await assert.rejects(checkOptions({ globalName: 'class' }), UsageError);
    await assert.rejects(checkOptions({ target: ['es20200'] }), error => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /^Invalid target "es20200"/);
        return true;
    });
});

test('passes on esbuild warnings as text', async t => {
    // esbuild stays quiet about code under node_modules, so this package is a linked local folder.
    const workDir = tempTree(t, {
        'local/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', main: 'index.js' },
        'local/widget/index.js': 'export const here = import.meta.url;',
    });
    const built = await bundle({
        workDir,
        name: 'widget',
        dir: join(workDir, 'local', 'widget'),
        label: 'widget 1.0.0',
        entry: 'index.js',
        globalName: 'Widget',
        minify: true,
    });
    assert.equal(built.warnings.length, 1);
    assert.match(built.warnings[0], /"import\.meta" is not available with the "iife" output format/);
});
