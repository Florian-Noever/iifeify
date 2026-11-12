import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

import { bundle, checkOptions } from '../src/bundle.js';
import { chooseEntry } from '../src/entry.js';
import { ConversionError, UsageError } from '../src/errors.js';
import { tempTree } from './helpers.js';

/**
 * Chooses the entry of the package "widget" in a made-up node_modules tree and builds it, the way
 * convert() does after npm install.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string | object>} files
 * @param {{ entry?: string, globalName?: string, minify?: boolean, target?: string[], folder?: string }} [options]
 */
async function bundleWidget(t, files, { entry, globalName = 'Widget', minify = true, target, folder = 'node_modules/widget' } = {}) {
    const workDir = tempTree(t, files);
    const dir = join(workDir, ...folder.split('/'));
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const label = 'widget 1.0.0';
    const plan = await chooseEntry({ workDir, name: 'widget', dir, manifest, label, entry });
    const built = await bundle({ workDir, plan, label, entry, globalName, minify, target });
    return { ...built, plan, workDir };
}

/** Runs a script the way a browser runs a classic script, and returns the globals it defines. */
function run(script) {
    const globals = {};
    vm.runInNewContext(script, globals);
    return globals;
}

const paths = (files, workDir) => files.map(file => file.slice(workDir.length + 1).replaceAll('\\', '/')).sort();

// An ES module whose import entry needs the package "helper", the case where a browser build helps.
const NEEDS_HELPER = {
    'node_modules/widget/index.js': 'import helper from "helper";\nexport const kind = helper("import entry");',
    'node_modules/helper/package.json': { name: 'helper', version: '1.0.0', main: 'index.js' },
    'node_modules/helper/index.js': 'module.exports = text => text;',
};

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
    assert.equal(Widget(), 'hello', 'the global is the default export');
    assert.equal(Widget.four, 4, 'with the other exports as its properties');

    assert.equal(built.plan.reason, 'the import entry');
    assert.deepEqual(paths([built.entry], built.workDir), ['node_modules/widget/index.js']);
    assert.deepEqual(paths(built.inputs, built.workDir), ['node_modules/twice/index.js', 'node_modules/widget/index.js']);
    assert.ok(
        built.js.includes('\n/*! Bundled license information:\n\ntwice/index.js:\n  (*! twice 0.1.0 | ISC *)\n*/\n'),
        'license comments of dependencies are kept at the end'
    );
    assert.equal(built.defaultExport, true);
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
    assert.equal(built.defaultExport, false);
});

test('the global is the default export, with the other exports as its properties', async t => {
    const globalOf = async source => run((await bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', main: 'index.js' },
        'node_modules/widget/index.js': source,
    })).js).Widget;

    const sanitizer = await globalOf('export default { sanitize: html => `<${html}>` };');
    assert.equal(sanitizer.sanitize('b'), '<b>', 'DOMPurify.sanitize() rather than DOMPurify.default.sanitize()');

    const Sortable = await globalOf('export default class Sortable { static version = 1; }\nexport const Swap = 2;\nexport const version = 3;');
    assert.equal(typeof Sortable, 'function');
    assert.equal(Sortable.Swap, 2);
    assert.equal(Sortable.version, 1, 'a property of the default export wins over an export of that name');

    const answer = await globalOf('export default 42;\nexport const other = 1;');
    assert.deepEqual({ ...answer }, { default: 42, other: 1 }, 'a default export that cannot have properties leaves all exports');

    const named = await globalOf('export const kind = "named";');
    assert.deepEqual({ ...named }, { kind: 'named' }, 'without a default export, the global holds the exports');
});

test('a CommonJS default property stays where it is', async t => {
    const built = await bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', main: 'index.js' },
        'node_modules/widget/index.js': 'exports.default = 1;\nexports.other = 2;',
    });
    assert.deepEqual({ ...run(built.js).Widget }, { default: 1, other: 2 });
    assert.equal(built.defaultExport, false);
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

test('picks a browser build without dependencies over an import entry that has some', async t => {
    const withBuild = (field, file, source) => bundleWidget(t, {
        ...NEEDS_HELPER,
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', exports: './index.js', [field]: file },
        [`node_modules/widget/${file}`]: source,
    });

    const standalone = await withBuild('browser', 'standalone.js', 'export const kind = "standalone";');
    assert.equal(standalone.plan.reason, 'browser build without dependencies');
    assert.equal(standalone.plan.kind, 'module');
    assert.equal(run(standalone.js).Widget.kind, 'standalone');
    assert.deepEqual(paths(standalone.inputs, standalone.workDir), ['node_modules/widget/standalone.js']);

    // A UMD build that esbuild reads as CommonJS, in a package that is not "type": "module".
    const umd = await bundleWidget(t, {
        ...NEEDS_HELPER,
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', exports: { '.': { import: './index.mjs' } }, unpkg: 'dist/widget.umd.js' },
        'node_modules/widget/index.mjs': NEEDS_HELPER['node_modules/widget/index.js'],
        'node_modules/widget/dist/widget.umd.js': 'module.exports = { kind: "umd" };',
    });
    assert.equal(umd.plan.reason, 'browser build without dependencies');
    assert.equal(run(umd.js).Widget.kind, 'umd');
});

test('keeps the import entry when no browser build is a better choice', async t => {
    const reasonWith = async (files, manifest) => {
        const built = await bundleWidget(t, {
            ...files,
            'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', exports: './index.js', ...manifest },
        });
        return [built.plan.reason, run(built.js).Widget.kind];
    };

    assert.deepEqual(
        await reasonWith({ 'node_modules/widget/index.js': 'export const kind = "import entry";', 'node_modules/widget/b.js': 'export const kind = "b";' }, { browser: 'b.js' }),
        ['the import entry', 'import entry'],
        'an import entry that needs no other package'
    );
    assert.deepEqual(
        await reasonWith({ ...NEEDS_HELPER, 'node_modules/widget/b.js': 'import helper from "helper";\nexport const kind = helper("b");' }, { browser: 'b.js' }),
        ['the import entry', 'import entry'],
        'a browser build that needs other packages too'
    );
    assert.deepEqual(
        await reasonWith({ ...NEEDS_HELPER, 'node_modules/widget/b.js': 'console.log("side effect");' }, { unpkg: 'b.js' }),
        ['the import entry', 'import entry'],
        'a browser build that neither exports nor defines anything'
    );
});

test('falls back to a browser build when the import entry cannot be bundled', async t => {
    const built = await bundleWidget(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', main: 'index.js', jsdelivr: 'dist/widget.js' },
        'node_modules/widget/index.js': 'import fs from "fs";\nexport const kind = typeof fs;',
        'node_modules/widget/dist/widget.js': 'export const kind = "browser build";',
    });
    assert.equal(built.plan.reason, 'browser build without dependencies');
    assert.equal(run(built.js).Widget.kind, 'browser build');
});

test('uses a classic script as it is, so that its globals stay global', async t => {
    const script = 'var Widget = (function () {\n    return { kind: "global" };\n})();\n';
    const files = {
        ...NEEDS_HELPER,
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', exports: './index.js', unpkg: 'dist/widget.global.js' },
        'node_modules/widget/dist/widget.global.js': script,
    };

    const copied = await bundleWidget(t, files, { minify: false, globalName: undefined });
    assert.equal(copied.plan.kind, 'script');
    assert.equal(copied.js, script, 'without --minify and --target, exactly as it is');
    assert.equal(run(copied.js).Widget.kind, 'global');

    const minified = await bundleWidget(t, files, { globalName: undefined });
    assert.match(minified.js, /^var Widget=/, 'minified, with its global kept');
    assert.equal(run(minified.js).Widget.kind, 'global');
});

test('uses a UMD build of a "type": "module" package as a classic script', async t => {
    // esbuild reads it as an ES module that exports nothing, as with Chart.js's chart.umd.min.js.
    const built = await bundleWidget(t, {
        ...NEEDS_HELPER,
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', exports: './index.js', unpkg: 'widget.umd.js' },
        'node_modules/widget/widget.umd.js': `(function (global, factory) {
            typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
            typeof define === 'function' && define.amd ? define(factory) :
            (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.Widget = factory());
        })(this, (function () { return { kind: 'umd' }; }));`,
    }, { globalName: undefined });
    assert.equal(built.plan.kind, 'script');
    assert.equal(run(built.js).Widget.kind, 'umd');
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
    assert.equal(built.plan.reason, 'given with --entry');
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

test('--entry overrides a browser build that would be chosen', async t => {
    const built = await bundleWidget(t, {
        ...NEEDS_HELPER,
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', exports: './index.js', browser: 'standalone.js' },
        'node_modules/widget/standalone.js': 'export const kind = "standalone";',
    }, { entry: 'index.js' });
    assert.equal(built.plan.reason, 'given with --entry');
    assert.equal(run(built.js).Widget.kind, 'import entry');
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
    const built = await bundleWidget(t, {
        'local/widget/package.json': { name: 'widget', version: '1.0.0', type: 'module', main: 'index.js' },
        'local/widget/index.js': 'export const here = import.meta.url;',
    }, { entry: 'index.js', folder: 'local/widget' });
    assert.equal(built.warnings.length, 1);
    assert.match(built.warnings[0], /"import\.meta" is not available with the "iife" output format/);
});
