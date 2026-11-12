#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { convert } from '../src/convert.js';
import { ConversionError, UsageError } from '../src/errors.js';

const HELP = `Usage: iifeify <package>[@version] [options]

Turns an npm package into one classic browser script that defines a single global.

Options:
  -e, --entry <path>        file or subpath inside the package to bundle
                            (default: the package's own browser entry)
  -g, --global-name <name>  global variable the script defines
                            (default: the package name in PascalCase)
  -o, --outfile <file>      where to write the script
                            (default: ./<package>.iife.js)
      --no-minify           keep the output readable
      --target <list>       language level of the output, e.g. es2020
                            (default: esnext)
      --notices             also write the full license texts of all bundled
                            packages, to a file such as ms.iife.LICENSES.txt
  -h, --help                show this help
  -v, --version             show the version

Examples:
  iifeify ms
  iifeify vanilla-jsoneditor@3.13.0 --entry standalone.js --global-name VanillaJsonEditor`;

const OPTIONS = {
    entry: { type: 'string', short: 'e' },
    'global-name': { type: 'string', short: 'g' },
    outfile: { type: 'string', short: 'o' },
    'no-minify': { type: 'boolean' },
    target: { type: 'string' },
    notices: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
};

async function main(argv) {
    let values, positionals;
    try {
        ({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }));
    } catch (error) {
        throw new UsageError(error.message);
    }

    if (values.help) {
        console.log(HELP);
        return;
    }
    if (values.version) {
        console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
        return;
    }
    if (positionals.length !== 1) {
        throw new UsageError(positionals.length === 0 ? 'Name the package to convert.' : 'Name one package only.');
    }

    report(await convert({
        spec: positionals[0],
        entry: values.entry,
        globalName: values['global-name'],
        outfile: values.outfile,
        minify: !values['no-minify'],
        target: values.target?.split(','),
        notices: values.notices,
    }));
}

function report({ files, bytes, packages, entry, globalName, warnings, hint }) {
    const [root, ...dependencies] = packages;
    // Relative to the current folder if the file is inside it, else in full.
    const shown = file => {
        const fromHere = relative(process.cwd(), file);
        return fromHere.startsWith('..') || isAbsolute(fromHere) ? file : fromHere;
    };
    const described = pkg => `${pkg.name} ${pkg.version} - ${pkg.license ?? 'license unknown'}`;
    const size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

    console.log(`Wrote ${shown(files.js)} (${size})`);
    console.log(`  package  ${described(root)}`);
    console.log(`  entry    ${entry}`);
    console.log(`  global   ${globalName}`);
    if (dependencies.length > 0) {
        console.log(`  bundled  ${dependencies.length} ${dependencies.length === 1 ? 'dependency' : 'dependencies'}`);
        for (const dependency of dependencies) console.log(`           ${described(dependency)}`);
    }
    if (files.css) console.log(`  styles   ${shown(files.css)}`);
    if (files.notices) console.log(`  notices  ${shown(files.notices)}`);

    for (const warning of warnings) console.error(`\n${warning}`);
    if (hint) console.log(`\nHint: ${hint}`);
}

main(process.argv.slice(2)).catch(error => {
    if (error instanceof UsageError) {
        console.error(`${error.message}\nRun "iifeify --help" for the options.`);
        process.exitCode = 2;
    } else if (error instanceof ConversionError) {
        console.error(error.message);
        process.exitCode = 1;
    } else {
        console.error(error);
        process.exitCode = 1;
    }
});
