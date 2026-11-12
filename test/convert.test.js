import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultGlobalName, defaultOutfile } from '../src/convert.js';

test('the default global is the package name in PascalCase', () => {
    assert.equal(defaultGlobalName('ms'), 'Ms');
    assert.equal(defaultGlobalName('vanilla-jsoneditor'), 'VanillaJsoneditor');
    assert.equal(defaultGlobalName('@scope/my.lib_two'), 'MyLibTwo');
});

test('the default global is a valid identifier even if the name starts with a digit', () => {
    assert.equal(defaultGlobalName('3d-view'), '_3dView');
});

test('the default output file is named after the package, without its scope', () => {
    assert.equal(defaultOutfile('vanilla-jsoneditor'), 'vanilla-jsoneditor.iife.js');
    assert.equal(defaultOutfile('@codemirror/state'), 'state.iife.js');
});
