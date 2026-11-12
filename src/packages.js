import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const NODE_MODULES = '/node_modules/';
const HOSTS = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };

const LEGAL_FILE = /^(licen[cs]e|copying|notice)\b/i;
const CODE_FILE = /\.([cm]?js|ts|json)$/i;

// License files of these kinds open with the package's own copyright notice. An Apache or GPL file
// instead holds a fill-in template or the notice of the license's publisher.
const NOTICE_FIRST_LICENSE = /\b(MIT|ISC|0?BSD)\b/i;
// "Copyright (c) <year> <copyright holders>", "Copyright [yyyy] [name of copyright owner]"
const TEMPLATE = /[<[{]\s*(year|yyyy|name|owner|fullname|copyright holders?)\b/i;
// Sentences of the license text itself, which can start a line where the text is wrapped.
const PROSE = /^copyright\s+(holders?|owners?|notice|law|and)\b/i;

/**
 * The packages whose code is in the bundle: the converted package first, then the others by name.
 *
 * @param {string[]} inputs   absolute paths of the bundled files
 * @param {string} rootDir    folder of the converted package
 */
export function bundledPackages(inputs, rootDir) {
    const dirs = new Set(inputs.map(packageDirOf).filter(Boolean).map(dir => resolve(dir)));
    dirs.delete(resolve(rootDir));

    // The same version can be installed more than once, in nested node_modules folders.
    const others = new Map();
    for (const dir of dirs) {
        const pkg = describePackage(dir);
        others.set(`${pkg.name}@${pkg.version}`, pkg);
    }
    return [describePackage(rootDir), ...[...others.keys()].sort().map(key => others.get(key))];
}

/** The folder of the package that a file belongs to, or undefined if it belongs to none. */
export function packageDirOf(file) {
    const path = file.replaceAll('\\', '/');
    const at = path.lastIndexOf(NODE_MODULES);
    if (at !== -1) {
        const [first, second] = path.slice(at + NODE_MODULES.length).split('/');
        return path.slice(0, at + NODE_MODULES.length) + (first.startsWith('@') ? `${first}/${second}` : first);
    }

    // A linked local folder is not under node_modules. Its package.json is the nearest one with a
    // name; a nested one such as dist/esm/package.json only sets the module type.
    for (let dir = dirname(file); ; dir = dirname(dir)) {
        if (isPackageRoot(dir)) return dir;
        if (dirname(dir) === dir) return undefined;
    }
}

function isPackageRoot(dir) {
    try {
        return typeof JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'string';
    } catch {
        return false;
    }
}

/**
 * What the banner and the notices file say about a package.
 *
 * @returns {{ name: string, version: string, license?: string, copyright?: string, url: string,
 *     legalTexts: { file: string, text: string }[] }}
 */
export function describePackage(dir) {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const license = licenseOf(manifest);
    const legalTexts = readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && LEGAL_FILE.test(entry.name) && !CODE_FILE.test(entry.name))
        .map(entry => entry.name)
        .sort()
        .map(file => ({ file, text: readFileSync(join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim() }));

    return {
        name: manifest.name,
        version: manifest.version,
        license,
        copyright: copyrightOf(license, legalTexts, manifest.author),
        url: urlOf(manifest),
        legalTexts,
    };
}

function licenseOf({ license, licenses }) {
    if (typeof license === 'string' && license) return license;
    if (typeof license?.type === 'string') return license.type; // old form: { type, url }
    if (Array.isArray(licenses)) { // old form: a list of the above
        return licenses.map(entry => entry?.type ?? entry).filter(type => typeof type === 'string').join(' OR ') || undefined;
    }
    return undefined;
}

function copyrightOf(license, legalTexts, author) {
    if (license && NOTICE_FIRST_LICENSE.test(license)) {
        for (const { text } of legalTexts) {
            const notice = copyrightNotice(text);
            if (notice) return notice;
        }
    }
    // "Jane Doe <jane@example.com> (https://example.com)" or { name, email, url }
    const name = typeof author === 'string' ? author.replace(/\s*[<(].*$/, '') : author?.name;
    return typeof name === 'string' && name.trim() ? `(c) ${name.trim()}` : undefined;
}

/** The first copyright notice in a license text, such as "Copyright (c) 2020 Jane Doe". */
function copyrightNotice(text) {
    // Without Markdown heading, quote, list and emphasis marks.
    const lines = text.split('\n').map(line => line.replace(/^[\s#>*_-]+|[\s*_]+$/g, ''));
    const start = lines.findIndex(line => /^(copyright\b|\(c\)|©)/i.test(line) && !TEMPLATE.test(line) && !PROSE.test(line));
    if (start === -1) return undefined;

    // A long list of holders runs on to the next line, leaving a comma at the end of this one.
    let end = start;
    while (lines[end].endsWith(',') && lines[end + 1]) end++;
    return lines.slice(start, end + 1).join(' ').replace(/\s+/g, ' ');
}

function urlOf({ name, homepage, repository }) {
    if (typeof homepage === 'string' && /^https?:\/\//.test(homepage)) return homepage;
    return repositoryUrl(repository) ?? `https://www.npmjs.com/package/${name}`;
}

/** The web address of a package.json "repository", which can be a string or { url } in several notations. */
function repositoryUrl(repository) {
    const raw = typeof repository === 'string' ? repository : repository?.url;
    if (typeof raw !== 'string') return undefined;

    const short = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/.exec(raw); // "user/repo", "gitlab:user/repo"
    if (short) return `https://${HOSTS[short[1] ?? 'github']}/${short[2]}`;

    const url = raw
        .replace(/^git\+/, '')
        .replace(/^git@([^:/]+):/, 'https://$1/') // git@github.com:user/repo.git
        .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
        .replace(/\.git(#.*)?$/, '');
    return /^https?:\/\//.test(url) ? url : undefined;
}
