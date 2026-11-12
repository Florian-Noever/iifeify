import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { tempTree } from './helpers.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// None of these calls gets as far as installing anything.
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('prints each step on stderr and the result on stdout', t => {
    // npm installs a package from a local folder without going to the registry.
    const root = tempTree(t, {
        'widget/package.json': { name: 'widget', version: '1.0.0', main: 'index.js', license: 'MIT' },
        'widget/index.js': 'module.exports = 42;',
    });
    const spec = `widget@file:${join(root, 'widget').replaceAll('\\', '/')}`;
    const { status, stdout, stderr } = spawnSync(process.execPath, [cli, spec, '-o', 'out.js'], { cwd: root, encoding: 'utf8' });

    assert.equal(status, 0, stderr);
    assert.ok(stderr.startsWith(`Installing ${spec} with npm... done in `), stderr);
    assert.match(stderr, /\.\.\. done in \d+(?:ms|\.\ds)\nBundling widget 1\.0\.0 with esbuild\.\.\. done in \d+(?:ms|\.\ds)\n$/);
    assert.equal(stdout.replace(/\(0\.\d KB\)/, '(size)'), [
        'Wrote out.js (size)',
        '  package  widget 1.0.0 - MIT',
        '  entry    index.js (the import entry)',
        '  global   Widget (from the package name)',
        '',
    ].join('\n'));
});

test('uses a classic script as it is, and refuses to rename its global', t => {
    const root = tempTree(t, {
        'widget/package.json': { name: 'widget', version: '1.0.0', main: 'widget.global.js', license: 'MIT' },
        'widget/widget.global.js': 'var Widget = (function () { return { kind: "global" }; })();\n',
    });
    const spec = `widget@file:${join(root, 'widget').replaceAll('\\', '/')}`;
    const iifeify = (...args) => spawnSync(process.execPath, [cli, spec, '-o', 'out.js', ...args], { cwd: root, encoding: 'utf8' });

    const copied = iifeify();
    assert.equal(copied.status, 0, copied.stderr);
    assert.match(copied.stdout, /\n {2}entry {4}widget\.global\.js \(the import entry, a classic script already\)\n {2}global {3}Widget \(set by the script itself\)\n$/);

    const renamed = iifeify('--global-name', 'Other');
    assert.equal(renamed.status, 2);
    assert.match(renamed.stderr, /\nwidget\.global\.js is a classic script that defines its own global, Widget, so --global-name cannot rename it\. /);
});

test('--help prints the usage, the options and the examples', () => {
    const { status, stdout } = run('--help');
    assert.equal(status, 0);
    assert.ok(stdout.startsWith(`iifeify/${version}\n\nUsage:\n  $ iifeify <package>[@version] [options]\n`));
    for (const option of ['-e, --entry <path>', '-g, --global-name <name>', '-o, --outfile <file>', '--no-minify', '--target <list>', '--notices']) {
        assert.ok(stdout.includes(option), option);
    }
    assert.match(stdout, /\nExamples:\n {2}\$ iifeify vanilla-jsoneditor@3\.13\.0\n/);
});

test('--version prints the version from package.json', () => {
    for (const flag of ['-v', '--version']) {
        const { status, stdout } = run(flag);
        assert.equal(status, 0);
        assert.ok(stdout.startsWith(`iifeify/${version} `), stdout);
    }
});

test('wrong usage exits with 2 and points to --help', () => {
    const cases = {
        'no package': [],
        'two packages': ['ms', 'is-odd'],
        'unknown option': ['ms', '--bogus'],
        'option without its value': ['ms', '--entry'],
        'not a package name': ['../evil'],
        'not a global name': ['ms', '--global-name', 'my-lib'],
        'a number as global name': ['ms', '--global-name', '123'],
        'not a target': ['ms', '--target', 'es20200'],
        'a number as target': ['ms', '--target', '2020'],
    };
    for (const [name, args] of Object.entries(cases)) {
        const { status, stdout, stderr } = run(...args);
        assert.equal(status, 2, name);
        assert.equal(stdout, '', name);
        assert.match(stderr, /Run "iifeify --help" for the options\./, name);
    }
});
