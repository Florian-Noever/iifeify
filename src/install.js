import { exec } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ConversionError, UsageError } from './errors.js';

// Asynchronous, so that the caller can report progress while npm works.
const run = promisify(exec);

// npm's rule for package names, including old names with capital letters.
const PACKAGE_NAME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

const INSTALL = 'npm install --ignore-scripts --no-audit --no-fund --no-package-lock --loglevel=error';

/**
 * Splits what the user typed, such as "vanilla-jsoneditor@3.13.0" or "@scope/name", into the
 * package name and the version, range or tag to install.
 */
export function parseSpec(spec) {
    const at = spec.indexOf('@', 1); // an @ at position 0 starts a scope
    const name = at === -1 ? spec : spec.slice(0, at);
    const range = at === -1 ? '' : spec.slice(at + 1);
    if (!PACKAGE_NAME.test(name)) {
        throw new UsageError(
            `"${spec}" is not a package name. ` +
            'Expected a name such as vanilla-jsoneditor, optionally with a version: vanilla-jsoneditor@3.13.0'
        );
    }
    return { name, range: range || 'latest' };
}

/**
 * Installs the package and its dependencies into workDir/node_modules.
 *
 * @returns {Promise<{ dir: string, manifest: object }>} the package's folder and its package.json
 */
export async function installPackage({ name, range }, workDir) {
    // A package.json of our own makes workDir the project root. Without one, npm installs into the
    // nearest parent folder that has a package.json, and the temp folder lies inside the user
    // profile. It also keeps the range off the command line: on Windows npm starts through cmd.exe,
    // where the ^, < and > of a range mean something else.
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ private: true, dependencies: { [name]: range } }));

    try {
        await run(INSTALL, { cwd: workDir, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
        const output = String(error.stderr ?? '').trim() || error.message;
        throw new ConversionError(`Could not install ${name}@${range}.\n\n${output}`);
    }

    // The real path, because that is how esbuild reports the package's files: a linked local folder
    // (name@file:/some/folder) is not under node_modules at all.
    const dir = realpathSync.native(join(workDir, 'node_modules', name));
    return { dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) };
}
