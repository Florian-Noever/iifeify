import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { checkOptions } from './bundle.js';

const ID = '[A-Za-z_$][\\w$]*';

// How UMD builds assign their global, as rollup, webpack and browserify write it, minified or not:
// root["Name"] = factory(), global.Name = factory(), (t = ... || self).Name = e(),
// global.Name = global.Name || {} and (e = e || self).Name = {}.
const UMD_ASSIGNMENTS = [
    new RegExp(`\\[\\s*["'](${ID})["']\\s*\\]\\s*=\\s*${ID}\\s*\\(`, 'g'),
    new RegExp(`\\.\\s*(${ID})\\s*=\\s*${ID}\\s*\\(`, 'g'),
    new RegExp(`\\.\\s*(${ID})\\s*=\\s*(?:${ID}\\.\\1\\s*\\|\\|\\s*)?\\{\\s*\\}`, 'g'),
];
// A UMD header ends where the factory is handed over: }(this, function ...) and the like.
const UMD_HEADER_END = /\}\s*\)?\s*\(\s*(?:this|self|window|globalThis|"undefined"|typeof)/;
// An IIFE build starts with its global: var Name = (function (exports) {, var Name = (() => {,
// var Name=function(e){. The same line further down is only a variable of some module.
const IIFE = new RegExp(`^var\\s+(${ID})\\s*=\\s*(?:\\(\\s*)?(?:function\\b|\\(\\s*\\)\\s*=>|async\\b)`);
const LEADING_COMMENTS = /^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n))*\s*(?:["']use strict["'];?\s*)?/;

// Names a UMD header assigns that are not the library's global.
const NOT_A_GLOBAL = new Set(['exports', 'module', 'amd', 'define', 'require', 'window', 'self', 'globalThis', 'global', 'document']);

/**
 * Chooses the global's name when --global-name is not given, from what the package says itself:
 * the global its type declarations declare, the one its own browser build assigns, or else a
 * name made from the package name.
 *
 * @param {object} options
 * @param {string} options.packageName
 * @param {string} options.dir        the package's folder
 * @param {object} options.manifest   its package.json
 * @param {import('./entry.js').Plan} options.plan
 * @returns {Promise<{ name: string, reason: string }>}
 */
export async function chooseGlobalName({ packageName, dir, manifest, plan }) {
    const candidates = [];
    const declared = typesNamespace(dir, manifest);
    if (declared) {
        candidates.push({ name: declared, reason: 'from the type declarations' });
    }
    for (const file of [plan.probe.file, ...packageFiles(dir, manifest)]) {
        const name = ownGlobal(file);
        if (name) {
            candidates.push({ name, reason: `from ${relative(dir, file).replaceAll('\\', '/')}` });
        }
    }

    for (const candidate of candidates) {
        if (await isUsable(candidate.name)) {
            return candidate;
        }
    }
    return { name: guessGlobalName(packageName, plan.probe.exports), reason: 'from the package name' };
}

/**
 * The global a UMD or IIFE build assigns, read from its first lines, such as "Chart" from
 * Chart.js's chart.umd.min.js. Undefined for any other file.
 */
export function ownGlobal(file) {
    let text;
    try {
        text = readFileSync(file, 'utf8').slice(0, 20000).replace(LEADING_COMMENTS, '');
    } catch {
        return undefined;
    }

    // A UMD header always checks for an AMD loader; a compiled CommonJS module does not.
    const start = text.slice(0, 2500);
    if (/define\.amd/.test(start)) {
        const end = start.search(UMD_HEADER_END);
        const header = end === -1 ? start : start.slice(0, end);
        // The header assigns module.exports first and the global last.
        const assigned = UMD_ASSIGNMENTS.flatMap(pattern => [...header.matchAll(pattern)])
            .sort((a, b) => /** @type {number} */ (a.index) - /** @type {number} */ (b.index))
            .map(match => match[1])
            .filter(name => !NOT_A_GLOBAL.has(name));
        if (assigned.length > 0) {
            return assigned.at(-1);
        }
    }
    const iife = IIFE.exec(text.slice(0, 3000))?.[1];
    return iife && !NOT_A_GLOBAL.has(iife) ? iife : undefined;
}

/** The global a package's type declarations declare with "export as namespace Name;". */
export function typesNamespace(dir, manifest) {
    for (const field of [manifest.types, manifest.typings, 'index.d.ts']) {
        const file = typeof field === 'string' ? resolve(dir, field) : undefined;
        if (file && isInside(dir, file) && statSync(file, { throwIfNoEntry: false })?.isFile()) {
            return /^\s*export\s+as\s+namespace\s+([A-Za-z_$][\w$]*)\s*;/m.exec(readFileSync(file, 'utf8'))?.[1];
        }
    }
    return undefined;
}

/**
 * A global name made from the package name, for a package that names none itself:
 * "vanilla-jsoneditor" gives "VanillaJsonEditor" when the package exports JsonEditor, "chart.js"
 * gives "Chart", and "@scope/my-lib" gives "ScopeMyLib".
 *
 * @param {string} packageName
 * @param {string[]} [exportNames]   the names the package exports, whose spelling is taken over
 */
export function guessGlobalName(packageName, exportNames = []) {
    const [scope, bare] = packageName.startsWith('@') ? packageName.slice(1).split('/') : [undefined, packageName];
    // "chart.js" and "highlight.js" are named after their language, "htmx.org" after its site.
    const words = [scope, bare.replace(/[.-]js$/i, '').replace(/\.(?:org|io|com|net|dev)$/i, '')]
        .filter(part => part !== undefined)
        .flatMap(part => part.split(/[^A-Za-z0-9]+/))
        .filter(Boolean);

    // A word that an export spells out, such as "jsoneditor" for JsonEditor or "sortablejs" for
    // Sortable, takes that spelling.
    const spellings = new Map();
    for (const name of exportNames) {
        for (const key of [name.toLowerCase(), `${name.toLowerCase()}js`]) {
            spellings.set(key, [...(spellings.get(key) ?? []), name]);
        }
    }
    const name = words.map(word => spell(word, spellings.get(word.toLowerCase()))).join('');
    return /^[A-Za-z]/.test(name) ? name : `_${name}`;
}

/**
 * Of several spellings, JsonEditor rather than JSONEditor: the one with the fewest capitals,
 * but at least one. Without any spelling, the word with a capital first letter.
 */
function spell(word, spellings) {
    if (!spellings) {
        return word[0].toUpperCase() + word.slice(1);
    }
    const capitals = name => name.replace(/[^A-Z]/g, '').length;
    const cased = spellings.filter(name => capitals(name) > 0).sort((a, b) => capitals(a) - capitals(b));
    return cased[0] ?? spellings[0];
}

/** The files a package's own browser build can be in. */
function packageFiles(dir, manifest) {
    const files = [manifest.unpkg, manifest.jsdelivr, manifest.browser, manifest.main]
        .filter(field => typeof field === 'string')
        .map(field => resolve(dir, field))
        .filter(file => isInside(dir, file) && statSync(file, { throwIfNoEntry: false })?.isFile());
    return [...new Set(files)];
}

async function isUsable(name) {
    if (NOT_A_GLOBAL.has(name)) {
        return false;
    }
    try {
        await checkOptions({ globalName: name });
        return true;
    } catch {
        return false;
    }
}

function isInside(dir, file) {
    const fromDir = relative(dir, file);
    return fromDir !== '' && fromDir !== '..' && !fromDir.startsWith(`..${sep}`) && !isAbsolute(fromDir);
}
