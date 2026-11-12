import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { relative, resolve } from 'node:path';
import * as esbuild from 'esbuild';

import { ConversionError, UsageError } from './errors.js';

// esbuild derives the names in its metafile from an output name. Nothing is written under it.
const OUT_JS = 'out.js';

const MAX_ERRORS_SHOWN = 10;
const MESSAGE_FORMAT = { color: false, terminalWidth: 100 };

// What the probes and the build have in common, so that both see the package alike.
const COMMON = /** @type {const} */ ({
    bundle: true,
    // Makes an import of a Node built-in such as "fs" an error.
    platform: 'browser',
    // esbuild sets this by itself only when minifying.
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: OUT_JS,
    write: false,
    metafile: true,
    logLevel: 'silent',
});

/**
 * What bundling an entry point as an ES module tells about it.
 *
 * @typedef {object} Probe
 * @property {string} entryPoint        as handed to esbuild: a file, or a package path
 * @property {string} file              the entry file, as an absolute path
 * @property {'esm' | 'cjs' | undefined} format   undefined for a file without import, export or require
 * @property {string[]} exports         the names the entry exports
 * @property {string[]} inputs          the files whose code is in the bundle, as absolute paths
 */

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
 * Bundles an entry point as an ES module, only to learn what it is: which file, what kind of
 * code, what it exports, and which files it takes in.
 *
 * @param {object} options
 * @param {string} options.workDir      folder whose node_modules holds the package
 * @param {string} options.entryPoint   a file, or a package path such as "ms" or "rxjs/operators"
 * @param {string} options.label        the package in messages, such as "ms 2.1.3"
 * @param {string} [options.entry]      what the user gave as --entry, for messages
 * @returns {Promise<Probe>}
 */
export async function probe({ workDir, entryPoint, label, entry }) {
    const result = await build({ ...COMMON, absWorkingDir: workDir, entryPoints: [entryPoint], format: 'esm' }, label, entryPoint, entry);
    const output = result.metafile.outputs[OUT_JS];
    // A build that succeeds always has an entry point.
    const entryFile = /** @type {string} */ (output.entryPoint);
    return {
        entryPoint,
        file: resolve(workDir, entryFile),
        format: result.metafile.inputs[entryFile]?.format,
        exports: output.exports,
        inputs: inputsOf(result.metafile, workDir),
    };
}

/**
 * Builds the script. A module is bundled into an IIFE that defines the global; a classic script
 * defines its globals itself, so it is only minified, or copied as it is.
 *
 * @param {object} options
 * @param {string} options.workDir
 * @param {import('./entry.js').Plan} options.plan   what to build, from chooseEntry
 * @param {string} options.label
 * @param {string} [options.entry]
 * @param {string} [options.globalName]   the global a module's IIFE defines
 * @param {boolean} options.minify
 * @param {string[]} [options.target]
 * @returns {Promise<{ js: string, css?: string, entry: string, inputs: string[], warnings: string[],
 *     defaultExport: boolean }>} the script, the stylesheet if the package imports CSS, the entry
 *     file, the files whose code is in the output (both as absolute paths), esbuild's warnings as
 *     text, and whether the global holds the module's default export rather than all its exports
 */
export async function bundle({ workDir, plan, label, entry, globalName, minify, target }) {
    if (plan.kind === 'script') {
        return minifyScript({ workDir, file: plan.probe.file, label, minify, target });
    }

    // Holding the default export is what a library's own browser build does, and what its
    // documentation then shows: DOMPurify.sanitize() rather than DOMPurify.default.sanitize().
    const defaultExport = plan.probe.format === 'esm' && plan.probe.exports.includes('default');
    const { entryPoint } = plan.probe;
    const result = await build({
        ...COMMON,
        absWorkingDir: workDir,
        entryPoints: [entryPoint],
        format: 'iife',
        globalName,
        minify,
        target,
        legalComments: 'eof',
        footer: defaultExport ? { js: holdDefaultExport(/** @type {string} */ (globalName)) } : undefined,
    }, label, entryPoint, entry);

    const text = extension => result.outputFiles.find(file => file.path.endsWith(extension))?.text;
    return {
        // A build that succeeds always has a script and an entry point.
        js: /** @type {string} */ (text('.js')),
        css: text('.css'),
        entry: resolve(workDir, /** @type {string} */ (result.metafile.outputs[OUT_JS].entryPoint)),
        inputs: inputsOf(result.metafile, workDir),
        warnings: await esbuild.formatMessages(result.warnings, { kind: 'warning', ...MESSAGE_FORMAT }),
        defaultExport,
    };
}

/**
 * Code after the IIFE that makes the global the module's default export. The module's other
 * exports become properties of it, unless it has a property of that name already. A default
 * export that cannot have properties, such as a number, leaves the global as it was.
 */
function holdDefaultExport(globalName) {
    return `${globalName}=function(n){var d=n.default,k;if(d===null||typeof d!=="object"&&typeof d!=="function")return n;`
        + `for(k in n)if(k!=="default"&&!(k in d))try{d[k]=n[k]}catch(e){}return d}(${globalName});`;
}

/**
 * A classic script, minified without a format: esbuild then keeps the names at its top level,
 * which are the globals it defines. Without --minify and --target it stays exactly as it is.
 */
async function minifyScript({ workDir, file, label, minify, target }) {
    const source = readFileSync(file, 'utf8');
    const script = { css: undefined, entry: file, inputs: [file], defaultExport: false };
    if (!minify && !target) {
        return { ...script, js: source.endsWith('\n') ? source : `${source}\n`, warnings: [] };
    }

    const sourcefile = relative(workDir, file).replaceAll('\\', '/');
    try {
        const result = await esbuild.transform(source, { minify, target, legalComments: 'eof', sourcefile, logLevel: 'silent' });
        return { ...script, js: result.code, warnings: await esbuild.formatMessages(result.warnings, { kind: 'warning', ...MESSAGE_FORMAT }) };
    } catch (error) {
        if (!Array.isArray(error.errors)) {
            throw error;
        }
        throw new ConversionError(await explainFailure(error.errors, label, sourcefile));
    }
}

/**
 * Runs esbuild, and explains a failure.
 *
 * @param {import('esbuild').BuildOptions & { metafile: true, write: false }} options
 */
async function build(options, label, entryPoint, entry) {
    try {
        return await esbuild.build(options);
    } catch (error) {
        if (!Array.isArray(error.errors)) {
            throw error;
        }
        throw new ConversionError(await explainFailure(error.errors, label, entryPoint, entry));
    }
}

/** The files whose code ends up in the output, as absolute paths. */
function inputsOf(metafile, workDir) {
    const inputs = new Set();
    for (const output of Object.values(metafile.outputs)) {
        for (const [file, { bytesInOutput }] of Object.entries(output.inputs)) {
            if (bytesInOutput > 0) {
                inputs.add(resolve(workDir, file));
            }
        }
    }
    // A module that the package's "browser" field switches off is listed under a made-up path.
    return [...inputs].filter(existsSync);
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
