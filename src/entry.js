import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { probe } from './bundle.js';
import { UsageError } from './errors.js';
import { ownGlobal } from './global.js';
import { packageDirOf } from './packages.js';

/**
 * What to build, and why.
 *
 * @typedef {object} Plan
 * @property {import('./bundle.js').Probe} probe
 * @property {'module' | 'script'} kind   a module is bundled into an IIFE. A classic script defines
 *     its globals itself; wrapping it would hide them inside the IIFE, so it is used as it is.
 * @property {string} reason              why this entry, for the summary
 */

/**
 * Chooses the entry point: the one the user named, else the package's import entry. When that
 * needs other packages and the package names a browser build that does not, the browser build:
 * it is the file the package's authors tested, and the one its documentation describes.
 *
 * @param {object} options
 * @param {string} options.workDir
 * @param {string} options.name       the package's folder name inside node_modules
 * @param {string} options.dir        the package's folder
 * @param {object} options.manifest   its package.json
 * @param {string} options.label      the package in messages, such as "ms 2.1.3"
 * @param {string} [options.entry]    file or subpath inside the package, given with --entry
 * @returns {Promise<Plan>}
 */
export async function chooseEntry({ workDir, name, dir, manifest, label, entry }) {
    if (entry) {
        return plan(await probe({ workDir, entryPoint: entryPointFor(name, dir, entry), label, entry }), 'given with --entry');
    }

    // esbuild resolves the package name like an import in browser code: through "exports" with
    // the conditions browser, import, module and default, else through browser, module and main.
    let imported;
    let failure;
    try {
        imported = await probe({ workDir, entryPoint: name, label });
    } catch (error) {
        failure = error;
    }
    if (imported && usesOnlyItself(imported, dir)) {
        return plan(imported, 'the import entry');
    }

    for (const file of browserBuilds(dir, manifest)) {
        if (file === imported?.file) {
            continue;
        }
        let build;
        try {
            build = await probe({ workDir, entryPoint: file, label });
        } catch {
            continue; // a browser build that cannot be bundled either is no better choice
        }
        const candidate = plan(build, 'browser build without dependencies');
        // A module needs exports, or its global would be empty; a script defines its own.
        if (usesOnlyItself(build, dir) && (candidate.kind === 'script' || build.exports.length > 0)) {
            return candidate;
        }
    }

    if (imported) {
        return plan(imported, 'the import entry');
    }
    throw failure;
}

/**
 * The files a package names for use in a browser: "browser", and "unpkg" and "jsdelivr", the
 * files those CDNs serve for a plain <script> tag.
 */
export function browserBuilds(dir, manifest) {
    const files = [manifest.browser, manifest.unpkg, manifest.jsdelivr]
        .filter(field => typeof field === 'string')
        .map(field => resolve(dir, field))
        .filter(file => isInside(dir, file) && statSync(file, { throwIfNoEntry: false })?.isFile());
    return [...new Set(files)];
}

function plan(found, reason) {
    return { probe: found, kind: isClassicScript(found) ? /** @type {const} */ ('script') : /** @type {const} */ ('module'), reason };
}

/**
 * A file that defines its globals itself, as a UMD or IIFE build does: one without import, export
 * or require, or one that is an ES module only because of its package's "type", imports and
 * exports nothing, and assigns a global.
 *
 * @param {import('./bundle.js').Probe} found
 */
function isClassicScript({ file, format, exports, inputs }) {
    if (!/\.c?js$/i.test(file) || inputs.length > 1) {
        return false;
    }
    return format === undefined || (format === 'esm' && exports.length === 0 && ownGlobal(file) !== undefined);
}

/** Whether every file in the bundle belongs to the package itself. */
function usesOnlyItself({ inputs }, dir) {
    return inputs.every(file => resolve(packageDirOf(file) ?? file) === resolve(dir));
}

function isInside(dir, file) {
    const fromDir = relative(dir, file);
    return fromDir !== '' && fromDir !== '..' && !fromDir.startsWith(`..${sep}`) && !isAbsolute(fromDir);
}

/** What to hand esbuild for --entry: a file inside the package, or a subpath of its "exports". */
function entryPointFor(name, dir, entry) {
    const file = resolve(dir, entry);
    const fromPackage = relative(dir, file);
    if (fromPackage === '..' || fromPackage.startsWith(`..${sep}`) || isAbsolute(fromPackage)) {
        throw new UsageError(`--entry must name something inside the package, got: ${entry}`);
    }
    if (!fromPackage) {
        return name;
    }
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
        return file;
    }
    return `${name}/${fromPackage.replaceAll('\\', '/')}`; // a subpath from the package's "exports"
}
