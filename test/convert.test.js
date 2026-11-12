import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultOutfile } from '../src/convert.js';

test('the default output file is named after the package, without its scope', () => {
    assert.equal(defaultOutfile('vanilla-jsoneditor'), 'vanilla-jsoneditor.iife.js');
    assert.equal(defaultOutfile('@codemirror/state'), 'state.iife.js');
});
