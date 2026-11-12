// These tests install real packages from the npm registry. Run them with: npm run test:e2e

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { tempTree } from '../helpers.js';

const cli = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));

/** Runs the CLI in a new empty folder and returns that folder with the process result. */
function iifeify(t, ...args) {
    const cwd = tempTree(t);
    return { cwd, ...spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }) };
}

function run(script) {
    const globals = {};
    vm.runInNewContext(script, globals);
    return globals;
}

test('converts a package without dependencies', t => {
    const { cwd, status, stdout, stderr } = iifeify(t, 'ms@2.1.3');
    assert.equal(status, 0, stderr);
    assert.match(stderr, /^Installing ms@2\.1\.3 with npm\.\.\. done in \d+(?:ms|\.\ds)\nBundling ms 2\.1\.3 with esbuild\.\.\. done in \d+(?:ms|\.\ds)\n$/);
    assert.match(stdout, /^Wrote ms\.iife\.js /);

    const script = readFileSync(join(cwd, 'ms.iife.js'), 'utf8');
    assert.equal(
        script.slice(0, script.indexOf('\n')),
        '/*! ms 2.1.3 - Copyright (c) 2020 Vercel, Inc. - MIT License - https://github.com/vercel/ms */'
    );
    assert.equal(run(script).Ms('2 days'), 172800000);
    assert.deepEqual(readdirSync(cwd), ['ms.iife.js']);
});

test('lists a bundled dependency in the banner and writes the notices file', t => {
    // The options in every form the command line takes: before the package, short, long and negated.
    const { cwd, status, stdout, stderr } = iifeify(t, '--notices', 'is-odd@3.0.1', '-g', 'isOdd', '--outfile', 'out/odd.js', '--no-minify');
    assert.equal(status, 0, stderr);
    assert.match(stdout, /bundled {2}1 dependency\n\s+is-number 6\.\d+\.\d+ - MIT\n/);

    const script = readFileSync(join(cwd, 'out', 'odd.js'), 'utf8');
    assert.match(script, /^\/\*!\n \* is-odd 3\.0\.1 - .*MIT License.*\n \*\n \* Bundled dependencies:\n \* is-number 6\.\d+\.\d+ - .*MIT License.*\n \*\/\n/);
    assert.match(script, /\nvar isOdd = \(\(\) => \{\n/, 'not minified');
    assert.equal(run(script).isOdd(3), true);

    const notices = readFileSync(join(cwd, 'out', 'odd.LICENSES.txt'), 'utf8');
    assert.match(notices, /^License notices for the packages bundled in odd\.js\n/);
    assert.match(notices, /\nis-odd 3\.0\.1\nLicense: MIT\n/);
    assert.match(notices, /\nis-number 6\.\d+\.\d+\nLicense: MIT\n/);
    assert.equal(notices.match(/Permission is hereby granted/g)?.length, 2, 'both license texts');
});

test('detects the entry and the global of vanilla-jsoneditor without options', t => {
    const { cwd, status, stdout, stderr } = iifeify(t, 'vanilla-jsoneditor@3.13.0');
    assert.equal(status, 0, stderr);
    assert.match(stdout, /\n {2}entry {4}standalone\.js \(browser build without dependencies\)\n {2}global {3}VanillaJsonEditor \(from the package name\)\n$/);

    const script = readFileSync(join(cwd, 'vanilla-jsoneditor.iife.js'), 'utf8');
    assert.ok(script.startsWith(
        '/*! vanilla-jsoneditor 3.13.0 - Copyright (c) 2020-2026 by Jos de Jong - ISC License - https://github.com/josdejong/svelte-jsoneditor */\nvar VanillaJsonEditor='
    ));
});

test('uses the UMD build of Chart.js as the classic script it is', t => {
    const { cwd, status, stdout, stderr } = iifeify(t, 'chart.js@4.6.1');
    assert.equal(status, 0, stderr);
    assert.match(stdout, /\n {2}entry {4}dist\/chart\.umd\.min\.js \(browser build without dependencies, a classic script already\)\n {2}global {3}Chart \(set by the script itself\)\n$/);

    const script = readFileSync(join(cwd, 'chart.js.iife.js'), 'utf8');
    assert.match(script, /^\/\*! chart\.js 4\.6\.1 - .* - MIT License - /);
    assert.match(script, /\.Chart=/, 'the UMD build assigns Chart itself');
});

test('makes DOMPurify its default export, under the name its own browser build uses', t => {
    const { cwd, status, stdout, stderr } = iifeify(t, 'dompurify@3.4.17');
    assert.equal(status, 0, stderr);
    assert.match(stdout, /\n {2}global {3}DOMPurify \(from dist\/purify\.js, holds the default export\)\n$/);

    // Without a DOM, DOMPurify returns itself unsupported, but with its version.
    const { DOMPurify } = run(readFileSync(join(cwd, 'dompurify.iife.js'), 'utf8'));
    assert.equal(typeof DOMPurify, 'function', 'DOMPurify itself rather than { default: DOMPurify }');
    assert.equal(DOMPurify.version, '3.4.17');
});

test('refuses a package that needs Node built-ins', t => {
    const { cwd, status, stdout, stderr } = iifeify(t, 'mkdirp@3.0.1');
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /^Installing mkdirp@3\.0\.1 with npm\.\.\. done in \d+(?:ms|\.\ds)\nBundling mkdirp 3\.0\.1 with esbuild\.\.\. failed\n\nmkdirp 3\.0\.1 is not browser compatible: it needs the Node\.js built-in modules fs, path\.\n/);
    assert.deepEqual(readdirSync(cwd), [], 'nothing is written');
});

test('reports a version that does not exist', t => {
    const { cwd, status, stderr } = iifeify(t, 'ms@0.0.0-does-not-exist');
    assert.equal(status, 1);
    assert.match(stderr, /^Installing ms@0\.0\.0-does-not-exist with npm\.\.\. failed\n\nCould not install ms@0\.0\.0-does-not-exist\.\n/);
    assert.equal(existsSync(join(cwd, 'ms.iife.js')), false);
});
