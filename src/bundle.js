import { existsSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import * as esbuild from 'esbuild';

import { ConversionError, UsageError } from './errors.js';

// esbuild derives the names in its metafile from an output name. Nothing is written under it.
const OUT_JS = 'out.js';

const MAX_ERRORS_SHOWN = 10;
const MESSAGE_FORMAT = { color: false, terminalWidth: 100 };

/**
 * Rejects a global name or target that esbuild will not accept. esbuild defines the rules for
 * both, so it is asked directly. This is quick, so it can run before anything is installed.
 *
 * @param {{ globalName?: string, target?: string[] }} options
 */
export async function checkOptions({ globalName, target }) {
    try {
        await esbuild.transform('', { format: 'iife', globalName, target });
    } catch (error) {
        // A bad target fails with a message that names it. A bad global name fails like a syntax error in code.
        if (!Array.isArray(error.errors)) {
            throw new UsageError(error.message);
        }
        throw new UsageError(`--global-name "${globalName}" is not a valid name. ${error.errors.map(({ text }) => text).join(' ')}`);
    }
}

/**
 * Bundles an installed package into one classic script that defines a global.
 *
 * @param {object} options
 * @param {string} options.workDir       folder whose node_modules holds the package
 * @param {string} options.name          the package's folder name inside node_modules
 * @param {string} options.dir           the package's folder
 * @param {string} options.label         the package in messages, such as "ms 2.1.3"
 * @param {string} [options.entry]       file or subpath inside the package; default is its browser entry
 * @param {string} options.globalName
 * @param {boolean} options.minify
 * @param {string[]} [options.target]
 * @returns {Promise<{ js: string, css?: string, entry: string, inputs: string[], warnings: string[] }>}
 *     the script, the stylesheet if the package imports CSS, the entry file, the files whose code
 *     is in the output (both as absolute paths), and esbuild's warnings as text
 */
export async function bundle({ workDir, name, dir, label, entry, globalName, minify, target }) {
    const entryPoint = entryPointFor(name, dir, entry);

    let result;
    try {
        result = await esbuild.build({
            absWorkingDir: workDir,
            entryPoints: [entryPoint],
            outfile: OUT_JS,
            write: false,
            metafile: true,
            bundle: true,
            format: 'iife',
            globalName,
            // Makes an import of a Node built-in such as "fs" an error.
            platform: 'browser',
            minify,
            target,
            legalComments: 'eof',
            // esbuild sets this by itself only when minifying.
            define: { 'process.env.NODE_ENV': '"production"' },
            logLevel: 'silent',
        });
    } catch (error) {
        if (!Array.isArray(error.errors)) {
            throw error;
        }
        throw new ConversionError(await explainFailure(error.errors, label, entryPoint, entry));
    }

    const { outputs } = result.metafile;
    const inputs = new Set();
    for (const output of Object.values(outputs)) {
        for (const [file, { bytesInOutput }] of Object.entries(output.inputs)) {
            if (bytesInOutput > 0) {
                inputs.add(resolve(workDir, file));
            }
        }
    }
    const text = extension => result.outputFiles.find(file => file.path.endsWith(extension))?.text;

    // A build that succeeds always has a script and an entry point.
    return {
        js: /** @type {string} */ (text('.js')),
        css: text('.css'),
        entry: resolve(workDir, /** @type {string} */ (outputs[OUT_JS].entryPoint)),
        // A module that the package's "browser" field switches off is listed under a made-up path.
        inputs: [...inputs].filter(existsSync),
        warnings: await esbuild.formatMessages(result.warnings, { kind: 'warning', ...MESSAGE_FORMAT }),
    };
}

/**
 * What to hand esbuild as entry point: a file inside the package, or a package path. esbuild
 * resolves a package path like an import in browser code: through "exports" with the conditions
 * browser, import, module and default, else through the fields browser, module and main.
 */
function entryPointFor(name, dir, entry) {
    if (!entry) {
        return name;
    }

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

/** Says in one sentence why the package cannot be bundled, followed by esbuild's own messages. */
async function explainFailure(errors, label, entryPoint, entry) {
    const unresolved = errors.map(error => /^Could not resolve "(.+)"$/.exec(error.text)?.[1]).filter(Boolean);
    const builtins = [...new Set(unresolved.filter(isBuiltin).map(module => module.replace(/^node:/, '')))].sort();

    let summary;
    if (builtins.length > 0) {
        const modules = `module${builtins.length > 1 ? 's' : ''} ${builtins.join(', ')}`;
        summary = `${label} is not browser compatible: it needs the Node.js built-in ${modules}.`;
    } else if (unresolved.includes(entryPoint)) {
        summary = entry
            ? `${label} has no file or export "${entry}".`
            : `${label} has no entry point that can be imported in a browser. Use --entry to name a file inside the package.`;
    } else {
        summary = `${label} could not be bundled for the browser.`;
    }

    // esbuild's notes also suggest options of its own, such as "You can use platform: 'node'".
    // This tool has no such options, and none of them would make the package run in a browser.
    const shown = errors.slice(0, MAX_ERRORS_SHOWN).map(error => ({
        ...error,
        notes: error.notes.filter(note => !/\bYou can (use|mark)\b/.test(note.text)),
    }));
    const details = await esbuild.formatMessages(shown, { kind: 'error', ...MESSAGE_FORMAT });
    const more = errors.length > shown.length ? `...and ${errors.length - shown.length} more errors.` : '';
    return `${summary}\n\n${details.join('')}${more}`.trimEnd();
}
