import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { bundledPackages, describePackage, packageDirOf } from '../src/packages.js';
import { tempTree } from './helpers.js';

const MIT_TEXT = `MIT License

Copyright (c) 2024 Jane Doe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software, to deal in the Software without restriction. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY.`;

/** Describes a package made of a package.json and the given other files. */
function describe(t, manifest, files = {}) {
    return describePackage(tempTree(t, { 'package.json': { name: 'widget', version: '1.2.3', ...manifest }, ...files }));
}

test('describes a typical MIT package', t => {
    const pkg = describe(t, {
        license: 'MIT',
        author: 'Someone Else',
        repository: { type: 'git', url: 'git+https://github.com/jane/widget.git' },
    }, { LICENSE: MIT_TEXT });

    assert.equal(pkg.name, 'widget');
    assert.equal(pkg.version, '1.2.3');
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.copyright, 'Copyright (c) 2024 Jane Doe'); // the license file, not the author field
    assert.equal(pkg.url, 'https://github.com/jane/widget');
    assert.deepEqual(pkg.legalTexts, [{ file: 'LICENSE', text: MIT_TEXT }]);
});

test('reads the notice from a Markdown license file', t => {
    const pkg = describe(t, { license: 'ISC' }, {
        'LICENSE.md': '# The ISC License\r\n\r\n**Copyright (c) 2020-2026 by Jos de Jong**\r\n\r\nPermission to use...\r\n',
    });
    assert.equal(pkg.copyright, 'Copyright (c) 2020-2026 by Jos de Jong');
    assert.equal(pkg.legalTexts[0].text, '# The ISC License\n\n**Copyright (c) 2020-2026 by Jos de Jong**\n\nPermission to use...');
});

test('skips template lines and sentences of the license text', t => {
    const pkg = describe(t, { license: 'BSD-3-Clause' }, {
        'LICENSE.txt': [
            'Copyright (c) <year> <copyright holders>',
            'Copyright [yyyy] [name of copyright owner]',
            'THIS SOFTWARE IS PROVIDED BY THE',
            'COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"',
            'copyright notice, this list of conditions and the following disclaimer.',
            '(c) 2019 Real Person',
        ].join('\n'),
    });
    assert.equal(pkg.copyright, '(c) 2019 Real Person');
});

test('joins a notice that runs on to the next line', t => {
    const pkg = describe(t, { license: 'MIT' }, {
        LICENSE: 'Copyright (c) 2011-2019 Stefan Goessner, Subbu Allamaraju,\nRobert Krahn, Brett Zamir\n\nPermission is hereby granted...',
    });
    assert.equal(pkg.copyright, 'Copyright (c) 2011-2019 Stefan Goessner, Subbu Allamaraju, Robert Krahn, Brett Zamir');
});

test('falls back to the author when the license file has no notice', t => {
    assert.equal(describe(t, { license: 'MIT', author: 'John Roe <john@example.com> (https://example.com)' }).copyright, '(c) John Roe');
    assert.equal(describe(t, { license: 'MIT', author: { name: 'John Roe', email: 'john@example.com' } }).copyright, '(c) John Roe');
    assert.equal(describe(t, { license: 'MIT' }).copyright, undefined);
});

test('does not search an Apache license file, which holds a template and no notice', t => {
    const files = { LICENSE: 'Apache License\n\nCopyright 2004 The Apache Software Foundation\n', NOTICE: 'Widget\nCopyright 2020 Acme Inc.' };
    assert.equal(describe(t, { license: 'Apache-2.0', author: 'Acme Inc.' }, files).copyright, '(c) Acme Inc.');
    assert.equal(describe(t, { license: 'Apache-2.0' }, files).copyright, undefined);
});

test('collects license, copying and notice files but no code', t => {
    const pkg = describe(t, { license: 'Apache-2.0' }, {
        'LICENSE-APACHE': 'apache text',
        'NOTICE.txt': 'notice text',
        'license.js': 'module.exports = {}',
        'LICENSES/extra.txt': 'not a file in the package root',
        'README.md': 'readme',
    });
    assert.deepEqual(pkg.legalTexts, [{ file: 'LICENSE-APACHE', text: 'apache text' }, { file: 'NOTICE.txt', text: 'notice text' }]);
});

test('understands the old license forms', t => {
    assert.equal(describe(t, { license: { type: 'MIT', url: 'https://example.com' } }).license, 'MIT');
    assert.equal(describe(t, { licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }).license, 'MIT OR Apache-2.0');
    assert.equal(describe(t, {}).license, undefined);
});

test('prefers the homepage, then the repository, then the npm page', t => {
    assert.equal(describe(t, { homepage: 'https://widget.example', repository: 'jane/widget' }).url, 'https://widget.example');
    assert.equal(describe(t, {}).url, 'https://www.npmjs.com/package/widget');

    const repositories = {
        'jane/widget': 'https://github.com/jane/widget',
        'gitlab:jane/widget': 'https://gitlab.com/jane/widget',
        'git@github.com:jane/widget.git': 'https://github.com/jane/widget',
        'git://github.com/jane/widget.git': 'https://github.com/jane/widget',
        'git+ssh://git@github.com/jane/widget.git': 'https://github.com/jane/widget',
        'https://github.com/jane/widget.git#main': 'https://github.com/jane/widget',
    };
    for (const [repository, url] of Object.entries(repositories)) {
        assert.equal(describe(t, { repository }).url, url, repository);
        assert.equal(describe(t, { repository: { type: 'git', url: repository } }).url, url, repository);
    }
});

test('finds the package folder of a file under node_modules', () => {
    assert.equal(packageDirOf('/work/node_modules/widget/lib/index.js'), '/work/node_modules/widget');
    assert.equal(packageDirOf('/work/node_modules/@scope/widget/index.js'), '/work/node_modules/@scope/widget');
    assert.equal(packageDirOf('/work/node_modules/a/node_modules/b/index.js'), '/work/node_modules/a/node_modules/b');
    assert.equal(packageDirOf('C:\\work\\node_modules\\widget\\lib\\index.js'), 'C:/work/node_modules/widget');
});

test('finds the package folder of a file in a linked local folder', t => {
    const root = tempTree(t, {
        'package.json': { name: 'local', version: '0.0.1' },
        'dist/esm/package.json': { type: 'module' },
        'dist/esm/index.js': 'export {};',
    });
    assert.equal(packageDirOf(join(root, 'dist', 'esm', 'index.js')), root);
});

test('lists the converted package first, then each bundled package once', t => {
    const root = tempTree(t, {
        'node_modules/widget/package.json': { name: 'widget', version: '1.0.0' },
        'node_modules/zeta/package.json': { name: 'zeta', version: '2.0.0' },
        'node_modules/@scope/alpha/package.json': { name: '@scope/alpha', version: '3.0.0' },
        'node_modules/zeta/node_modules/@scope/alpha/package.json': { name: '@scope/alpha', version: '3.0.0' },
        'node_modules/unused/package.json': { name: 'unused', version: '9.9.9' },
    });
    const inputs = [
        'node_modules/zeta/index.js',
        'node_modules/widget/index.js',
        'node_modules/widget/lib/more.js',
        'node_modules/zeta/node_modules/@scope/alpha/index.js',
        'node_modules/@scope/alpha/index.js',
    ].map(file => join(root, file));

    const packages = bundledPackages(inputs, join(root, 'node_modules', 'widget'));
    assert.deepEqual(packages.map(pkg => `${pkg.name}@${pkg.version}`), ['widget@1.0.0', '@scope/alpha@3.0.0', 'zeta@2.0.0']);
});
