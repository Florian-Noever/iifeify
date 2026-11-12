import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { renderBanner, renderNotices } from './banner.js';
import { bundle, checkOptions } from './bundle.js';
import { chooseEntry } from './entry.js';
import { UsageError } from './errors.js';
import { chooseGlobalName, ownGlobal } from './global.js';
import { installPackage, parseSpec } from './install.js';
import { bundledPackages } from './packages.js';

/**
 * @typedef {{ name: 'install', spec: string } | { name: 'bundle', label: string }} Step
 *     a step of a conversion: npm installs the package as the user named it, or esbuild bundles
 *     the installed package, labelled with its name and version such as "ms 2.1.3"
 */

/**
 * Installs an npm package into a temporary folder and writes it as one classic browser script.
 *
 * @param {object} options
 * @param {string} options.spec            package to convert, such as "vanilla-jsoneditor@3.13.0"
 * @param {string} [options.entry]         file or subpath inside the package; detected if not given
 * @param {string} [options.globalName]    detected if not given
 * @param {string} [options.outfile]       default is <package name>.iife.js in the current folder
 * @param {boolean} [options.minify]
 * @param {string[]} [options.target]      esbuild targets such as ["es2020"]
 * @param {boolean} [options.notices]      also write the full license texts next to the script
 * @param {(step: Step) => void} [options.onStep]  called as each step starts, to report progress
 * @returns {Promise<{ files: { js: string, css?: string, notices?: string }, bytes: number,
 *     packages: object[], entry: { file: string, reason: string },
 *     global: { name?: string, reason: string, defaultExport: boolean }, warnings: string[] }>}
 *     the entry and the global come with the reason they were chosen; a classic script's global
 *     has no name when it cannot be read from the script
 */
export async function convert({ spec, entry, globalName: requestedGlobalName, outfile, minify = true, target, notices = false, onStep }) {
    const wanted = parseSpec(spec);
    await checkOptions({ globalName: requestedGlobalName, target });

    // The real path: on Windows the temp folder can be given as a short 8.3 alias, and esbuild
    // reports files by their real paths.
    const workDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'iifeify-')));
    try {
        onStep?.({ name: 'install', spec });
        const { dir, manifest } = await installPackage(wanted, workDir);

        const label = `${manifest.name} ${manifest.version}`;
        onStep?.({ name: 'bundle', label });
        const plan = await chooseEntry({ workDir, name: wanted.name, dir, manifest, label, entry });
        const entryFile = relative(dir, plan.probe.file).replaceAll('\\', '/');
        const global = await globalFor({ plan, entryFile, requestedGlobalName, packageName: manifest.name, dir, manifest });

        const built = await bundle({ workDir, plan, label, entry, globalName: global.name, minify, target });
        const packages = bundledPackages(built.inputs, dir);
        const banner = renderBanner(packages);

        const files = { js: resolve(outfile ?? defaultOutfile(manifest.name)) };
        const base = files.js.replace(/\.js$/i, '');
        const script = `${banner}\n${built.js}`;
        mkdirSync(dirname(files.js), { recursive: true });
        writeFileSync(files.js, script);
        if (built.css !== undefined) {
            files.css = `${base}.css`;
            writeFileSync(files.css, `${banner}\n${built.css}`);
        }
        if (notices) {
            files.notices = `${base}.LICENSES.txt`;
            writeFileSync(files.notices, renderNotices(packages, basename(files.js)));
        }

        const unlicensed = packages.filter(pkg => !pkg.license).map(pkg => `${pkg.name} ${pkg.version} does not declare a license.`);
        return {
            files,
            bytes: Buffer.byteLength(script),
            packages,
            entry: { file: entryFile, reason: plan.kind === 'script' ? `${plan.reason}, a classic script already` : plan.reason },
            global: { ...global, defaultExport: built.defaultExport },
            warnings: [...built.warnings.map(warning => warning.trim()), ...unlicensed],
        };
    } finally {
        try {
            rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
            // A virus scanner can hold files open on Windows. A leftover temp folder must not turn
            // a finished conversion into a failure, or hide the error that is already on its way.
        }
    }
}

/** "@scope/vanilla-jsoneditor" gives "vanilla-jsoneditor.iife.js". */
export function defaultOutfile(packageName) {
    return `${packageName.slice(packageName.indexOf('/') + 1)}.iife.js`;
}

/**
 * The global's name, and where it comes from. A classic script defines its globals itself, so
 * there is nothing to name; the summary shows the one it defines, if that can be read from it.
 *
 * @returns {Promise<{ name?: string, reason: string }>}
 */
async function globalFor({ plan, entryFile, requestedGlobalName, packageName, dir, manifest }) {
    if (plan.kind === 'script') {
        const own = ownGlobal(plan.probe.file);
        if (requestedGlobalName) {
            throw new UsageError(
                `${entryFile} is a classic script that defines its own global${own ? `, ${own}` : ''}, so --global-name cannot rename it. `
                + 'Leave out --global-name, or choose another file with --entry.'
            );
        }
        return { name: own, reason: 'set by the script itself' };
    }
    if (requestedGlobalName) {
        return { name: requestedGlobalName, reason: 'given with --global-name' };
    }
    return chooseGlobalName({ packageName, dir, manifest, plan });
}
