import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { chooseGlobalName, guessGlobalName, ownGlobal, typesNamespace } from '../src/global.js';
import { tempTree } from './helpers.js';

/** The global that ownGlobal reads from a file with this content. */
function globalIn(t, source) {
    return ownGlobal(join(tempTree(t, { 'build.js': source }), 'build.js'));
}

test('reads the global from the UMD headers of rollup, webpack and browserify', t => {
    const headers = {
        moment: `(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    global.moment = factory()
}(this, (function () { 'use strict'; return 1; })));`,
        dayjs: '!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self).dayjs=e()}(this,(function(){"use strict";return 1}));',
        d3: '!function(t,n){"object"==typeof exports&&"undefined"!=typeof module?n(exports):"function"==typeof define&&define.amd?define(["exports"],n):n((t="undefined"!=typeof globalThis?globalThis:t||self).d3=t.d3||{})}(this,(function(t){"use strict";t.version="7"}));',
        JSONEditor: '!function(e,t){"object"==typeof exports&&"object"==typeof module?module.exports=t():"function"==typeof define&&define.amd?define([],t):"object"==typeof exports?exports.JSONEditor=t():e.JSONEditor=t()}(self,(()=>(()=>{var e={};return e})()));',
        ApexCharts: `(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["ApexCharts"] = factory();
	else
		root["ApexCharts"] = factory();
})(self, () => { return 1; });`,
        tippy: '!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?module.exports=t(require("@popperjs/core")):"function"==typeof define&&define.amd?define(["@popperjs/core"],t):(e=e||self).tippy=t(e.Popper)}(this,(function(e){"use strict";var TIPPY_DEFAULT_APPEND_TO=e.x();return 1}));',
        Papa: '!function(e,t){"function"==typeof define&&define.amd?define([],t):"object"==typeof module&&"undefined"!=typeof exports?module.exports=t():e.Papa=t()}(this,function s(){"use strict";return 1});',
    };
    for (const [name, header] of Object.entries(headers)) {
        assert.equal(globalIn(t, `/*! a license comment */\n${header}`), name, name);
    }
});

test('reads the global from an IIFE build', t => {
    assert.equal(globalIn(t, "/*! Vue v3 */\nvar Vue = (function (exports) {\n  'use strict';\n  return exports;\n})({});"), 'Vue');
    assert.equal(globalIn(t, '"use strict";\nvar Widget = (() => {\n  return 1;\n})();'), 'Widget');
    assert.equal(globalIn(t, 'var luxon=function(e){"use strict";return e}({});'), 'luxon');
});

test('finds no global in modules, or in a UMD build that writes to window itself', t => {
    assert.equal(globalIn(t, 'export const x = 1;'), undefined);
    assert.equal(globalIn(t, 'import { x } from "./x.js";\nvar NOOP = () => {};\nvar TIPPY_DEFAULT_APPEND_TO = function () {};\nexport { NOOP };'), undefined, 'a variable further down');
    assert.equal(globalIn(t, '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.API = require("./api")();'), undefined);
    assert.equal(globalIn(t, '!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t=t||self).window=t.window||{})}(this,(function(e){}));'), undefined);
    assert.equal(ownGlobal(join(tempTree(t), 'missing.js')), undefined);
});

test('reads the global that the type declarations declare', t => {
    const dir = tempTree(t, {
        'typed/types/index.d.ts': 'declare class ApexCharts {}\nexport = ApexCharts;\nexport as namespace ApexCharts;\n',
        'default/index.d.ts': 'export declare const version: string;\nexport as namespace katex;\n',
        'none/index.d.ts': 'export declare const version: string;\n',
        'outside/package.json': '{}',
        'elsewhere.d.ts': 'export as namespace Elsewhere;\n',
    });
    assert.equal(typesNamespace(join(dir, 'typed'), { types: 'types/index.d.ts' }), 'ApexCharts');
    assert.equal(typesNamespace(join(dir, 'default'), {}), 'katex', 'index.d.ts without a "types" field');
    assert.equal(typesNamespace(join(dir, 'none'), {}), undefined);
    assert.equal(typesNamespace(join(dir, 'outside'), { types: '../elsewhere.d.ts' }), undefined, 'nothing outside the package');
});

test('guesses a global from the package name, spelled as the package exports it', () => {
    assert.equal(guessGlobalName('ms'), 'Ms');
    assert.equal(guessGlobalName('vanilla-jsoneditor'), 'VanillaJsoneditor');
    assert.equal(guessGlobalName('vanilla-jsoneditor', ['JSONEditor', 'JsonEditor', 'createJSONEditor']), 'VanillaJsonEditor');
    assert.equal(guessGlobalName('chart.js'), 'Chart');
    assert.equal(guessGlobalName('sortablejs', ['MultiDrag', 'Sortable', 'Swap', 'default']), 'Sortable');
    assert.equal(guessGlobalName('marked', ['Lexer', 'marked', 'parse']), 'marked');
    assert.equal(guessGlobalName('htmx.org'), 'Htmx');
    assert.equal(guessGlobalName('signature_pad'), 'SignaturePad');
    assert.equal(guessGlobalName('@codemirror/state'), 'CodemirrorState');
    assert.equal(guessGlobalName('3d-view'), '_3dView');
});

test('chooses the declared global first, then the one a build assigns, then a guess', async t => {
    const dir = tempTree(t, {
        'package.json': '{}',
        'types/widget.d.ts': 'export as namespace Declared;\n',
        'index.mjs': 'export default 1;',
        'dist/widget.umd.js': '!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?module.exports=t():"function"==typeof define&&define.amd?define(t):(e=e||self).FromBuild=t()}(this,function(){return 1});',
        'dist/window.umd.js': '!function(e,t){"function"==typeof define&&define.amd?define(t):(e=e||self).window=t()}(this,function(){return 1});',
    });
    const plan = /** @type {import('../src/entry.js').Plan} */ ({
        probe: { entryPoint: 'widget', file: join(dir, 'index.mjs'), format: 'esm', exports: ['default', 'WidgetKit'], inputs: [] },
        kind: 'module',
        reason: 'the import entry',
    });
    const choose = manifest => chooseGlobalName({ packageName: 'widget-kit', dir, manifest, plan });

    assert.deepEqual(await choose({ types: 'types/widget.d.ts', unpkg: 'dist/widget.umd.js' }), { name: 'Declared', reason: 'from the type declarations' });
    assert.deepEqual(await choose({ unpkg: 'dist/widget.umd.js' }), { name: 'FromBuild', reason: 'from dist/widget.umd.js' });
    assert.deepEqual(await choose({ unpkg: 'dist/window.umd.js' }), { name: 'WidgetKit', reason: 'from the package name' });
});
