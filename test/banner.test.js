import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderBanner, renderNotices } from '../src/banner.js';

const jsoneditor = {
    name: 'vanilla-jsoneditor',
    version: '3.13.0',
    license: 'ISC',
    copyright: 'Copyright (c) 2020-2026 by Jos de Jong',
    url: 'https://github.com/josdejong/svelte-jsoneditor',
    legalTexts: [{ file: 'LICENSE.md', text: 'The ISC License\n\nCopyright (c) 2020-2026 by Jos de Jong' }],
};

test('a single package gives a one-line banner', () => {
    assert.equal(
        renderBanner([jsoneditor]),
        '/*! vanilla-jsoneditor 3.13.0 - Copyright (c) 2020-2026 by Jos de Jong - ISC License - https://github.com/josdejong/svelte-jsoneditor */'
    );
});

test('bundled dependencies get a line each', () => {
    const banner = renderBanner([
        jsoneditor,
        { name: 'dep-a', version: '1.4.2', license: 'MIT', copyright: '(c) John Roe', url: 'https://github.com/john/dep-a' },
        { name: 'dep-b', version: '0.9.0', license: '(MIT OR Apache-2.0)', url: 'https://github.com/acme/dep-b' },
        { name: 'dep-c', version: '0.0.1', url: 'https://www.npmjs.com/package/dep-c' },
    ]);
    assert.equal(banner, [
        '/*!',
        ' * vanilla-jsoneditor 3.13.0 - Copyright (c) 2020-2026 by Jos de Jong - ISC License - https://github.com/josdejong/svelte-jsoneditor',
        ' *',
        ' * Bundled dependencies:',
        ' * dep-a 1.4.2 - (c) John Roe - MIT License - https://github.com/john/dep-a',
        ' * dep-b 0.9.0 - (MIT OR Apache-2.0) - https://github.com/acme/dep-b',
        ' * dep-c 0.0.1 - license unknown - https://www.npmjs.com/package/dep-c',
        ' */',
    ].join('\n'));
});

test('package metadata cannot end the comment or add a line', () => {
    const hostile = {
        name: 'evil',
        version: '1.0.0',
        license: 'MIT */ globalThis.hacked = true; /*',
        copyright: 'Copyright\n*/ globalThis.hacked = true; /*',
        url: 'https://example.com/*/x',
    };
    for (const banner of [renderBanner([hostile]), renderBanner([jsoneditor, hostile])]) {
        assert.equal(banner.indexOf('*/'), banner.length - 2, 'the only */ closes the banner');
        const sandbox = {};
        new Function('globalThis', `${banner}\nreturn 1;`)(sandbox);
        assert.equal(sandbox.hacked, undefined);
    }
    assert.equal(renderBanner([hostile]).includes('\n'), false);
});

test('the notices file holds the full license texts', () => {
    const notices = renderNotices(
        [jsoneditor, { name: 'dep-c', version: '0.0.1', url: 'https://www.npmjs.com/package/dep-c', legalTexts: [] }],
        'vanilla-jsoneditor.iife.js'
    );
    const rule = '='.repeat(80);
    assert.equal(notices, [
        'License notices for the packages bundled in vanilla-jsoneditor.iife.js',
        '',
        rule,
        'vanilla-jsoneditor 3.13.0',
        'License: ISC',
        'https://github.com/josdejong/svelte-jsoneditor',
        rule,
        '',
        'The ISC License',
        '',
        'Copyright (c) 2020-2026 by Jos de Jong',
        '',
        rule,
        'dep-c 0.0.1',
        'License: unknown',
        'https://www.npmjs.com/package/dep-c',
        rule,
        '',
        'This package contains no license file.',
        '',
    ].join('\n'));
});
