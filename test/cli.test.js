import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// None of these calls gets as far as installing anything.
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('--help prints the usage, the options and the examples', () => {
    const { status, stdout } = run('--help');
    assert.equal(status, 0);
    assert.ok(stdout.startsWith(`iifeify/${version}\n\nUsage:\n  $ iifeify <package>[@version] [options]\n`));
    for (const option of ['-e, --entry <path>', '-g, --global-name <name>', '-o, --outfile <file>', '--no-minify', '--target <list>', '--notices']) {
        assert.ok(stdout.includes(option), option);
    }
    assert.match(stdout, /\nExamples:\n {2}\$ iifeify ms\n/);
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
