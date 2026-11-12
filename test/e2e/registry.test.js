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

test('refuses a package that needs Node built-ins', t => {
    const { cwd, status, stdout, stderr } = iifeify(t, 'mkdirp@3.0.1');
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /^mkdirp 3\.0\.1 is not browser compatible: it needs the Node\.js built-in modules fs, path\.\n/);
    assert.deepEqual(readdirSync(cwd), [], 'nothing is written');
});

test('reports a version that does not exist', t => {
    const { cwd, status, stderr } = iifeify(t, 'ms@0.0.0-does-not-exist');
    assert.equal(status, 1);
    assert.match(stderr, /^Could not install ms@0\.0\.0-does-not-exist\.\n/);
    assert.equal(existsSync(join(cwd, 'ms.iife.js')), false);
});
