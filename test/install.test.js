import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UsageError } from '../src/errors.js';
import { parseSpec } from '../src/install.js';

test('a bare name installs the latest version', () => {
    assert.deepEqual(parseSpec('vanilla-jsoneditor'), { name: 'vanilla-jsoneditor', range: 'latest' });
});

test('a version, range or tag follows the @', () => {
    assert.deepEqual(parseSpec('vanilla-jsoneditor@3.13.0'), { name: 'vanilla-jsoneditor', range: '3.13.0' });
    assert.deepEqual(parseSpec('ms@^2.1'), { name: 'ms', range: '^2.1' });
    assert.deepEqual(parseSpec('ms@>=2 <3'), { name: 'ms', range: '>=2 <3' });
    assert.deepEqual(parseSpec('ms@next'), { name: 'ms', range: 'next' });
});

test('a scope keeps its leading @', () => {
    assert.deepEqual(parseSpec('@codemirror/state'), { name: '@codemirror/state', range: 'latest' });
    assert.deepEqual(parseSpec('@codemirror/state@6.4.1'), { name: '@codemirror/state', range: '6.4.1' });
});

test('whatever follows the first @ goes to npm unchanged', () => {
    assert.deepEqual(parseSpec('alias@npm:ms@2.1.3'), { name: 'alias', range: 'npm:ms@2.1.3' });
});

test('old package names with capital letters are accepted', () => {
    assert.deepEqual(parseSpec('JSONStream'), { name: 'JSONStream', range: 'latest' });
});

test('rejects what is not a package name', () => {
    for (const spec of ['', '../evil', 'two words', '@scope', '.hidden', 'a/b/c', 'C:\\folder', 'https://example.com/x.tgz']) {
        assert.throws(() => parseSpec(spec), UsageError, spec);
    }
});
