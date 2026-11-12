import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// None of these calls gets as far as installing anything.
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('--help prints the usage', () => {
    const { status, stdout } = run('--help');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage: iifeify <package>/);
    assert.match(stdout, /--global-name/);
});

test('--version prints the version from package.json', () => {
    const { status, stdout } = run('-v');
    assert.equal(status, 0);
    assert.equal(stdout.trim(), version);
});

test('wrong usage exits with 2 and points to --help', () => {
    const cases = {
        'no package': [],
        'two packages': ['ms', 'is-odd'],
        'unknown option': ['ms', '--bogus'],
        'option without its value': ['ms', '--entry'],
        'not a package name': ['../evil'],
        'not a global name': ['ms', '--global-name', 'my-lib'],
        'not a target': ['ms', '--target', 'es20200'],
    };
    for (const [name, args] of Object.entries(cases)) {
        const { status, stdout, stderr } = run(...args);
        assert.equal(status, 2, name);
        assert.equal(stdout, '', name);
        assert.match(stderr, /Run "iifeify --help" for the options\./, name);
    }
});
