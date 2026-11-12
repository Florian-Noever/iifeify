import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { renderBanner, renderNotices } from './banner.js';
import { bundle, checkOptions } from './bundle.js';
import { installPackage, parseSpec } from './install.js';
import { bundledPackages } from './packages.js';

/**
 * Installs an npm package into a temporary folder and writes it as one classic browser script.
 *
 * @param {object} options
 * @param {string} options.spec            package to convert, such as "vanilla-jsoneditor@3.13.0"
 * @param {string} [options.entry]         file or subpath inside the package; default is its browser entry
 * @param {string} [options.globalName]    default is the package name in PascalCase
 * @param {string} [options.outfile]       default is <package name>.iife.js in the current folder
 * @param {boolean} [options.minify]
 * @param {string[]} [options.target]      esbuild targets such as ["es2020"]
 * @param {boolean} [options.notices]      also write the full license texts next to the script
 * @returns {Promise<{ files: { js: string, css?: string, notices?: string }, bytes: number,
 *     packages: object[], entry: string, globalName: string, warnings: string[], hint?: string }>}
 */
export async function convert({ spec, entry, globalName: requestedGlobalName, outfile, minify = true, target, notices = false }) {
    const wanted = parseSpec(spec);
    await checkOptions({ globalName: requestedGlobalName, target });

    // The real path: on Windows the temp folder can be given as a short 8.3 alias, and esbuild
    // reports files by their real paths.
    const workDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'iifeify-')));
    try {
        const { dir, manifest } = installPackage(wanted, workDir);
        const globalName = requestedGlobalName ?? defaultGlobalName(manifest.name);

        const label = `${manifest.name} ${manifest.version}`;
        const built = await bundle({ workDir, name: wanted.name, dir, label, entry, globalName, minify, target });
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
            entry: relative(dir, built.entry).replaceAll('\\', '/'),
            globalName,
            warnings: [...built.warnings.map(warning => warning.trim()), ...unlicensed],
            hint: entry ? undefined : prebuiltHint(manifest, dir, built.entry),
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

/** "vanilla-jsoneditor" and "@scope/vanilla-jsoneditor" both give "VanillaJsoneditor". */
export function defaultGlobalName(packageName) {
    const words = unscoped(packageName).split(/[^A-Za-z0-9]+/).filter(Boolean);
    const name = words.map(word => word[0].toUpperCase() + word.slice(1)).join('');
    return /^[A-Za-z]/.test(name) ? name : `_${name}`;
}

/** "@scope/vanilla-jsoneditor" gives "vanilla-jsoneditor.iife.js". */
export function defaultOutfile(packageName) {
    return `${unscoped(packageName)}.iife.js`;
}

function unscoped(packageName) {
    return packageName.slice(packageName.indexOf('/') + 1);
}

/**
 * Some packages point "exports" at a file that needs its dependencies bundled in, and "browser" at
 * a ready-made file that contains them. Bundlers follow "exports", so the ready-made file takes --entry.
 */
function prebuiltHint(manifest, dir, entryFile) {
    if (typeof manifest.browser !== 'string') {
        return undefined;
    }

    const prebuilt = resolve(dir, manifest.browser);
    if (prebuilt === entryFile || !existsSync(prebuilt)) {
        return undefined;
    }
    const entry = relative(dir, prebuilt).replaceAll('\\', '/');
    return `${manifest.name} also ships a prebuilt browser file. To bundle that instead, add: --entry ${entry}`;
}
