#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { cac } from 'cac';

import { convert } from '../src/convert.js';
import { ConversionError, UsageError } from '../src/errors.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// cac turns a value that looks like a number into one, such as the file name in "--outfile 2024".
const text = value => (value === undefined ? undefined : String(value));

const cli = cac('iifeify');

cli.command('<package>', 'Turn an npm package into one classic browser script that defines a single global')
    .usage('<package>[@version] [options]')
    .option('-e, --entry <path>', 'File or subpath inside the package to bundle (default: detected)')
    .option('-g, --global-name <name>', 'Global variable the script defines (default: detected)')
    .option('-o, --outfile <file>', 'Where to write the script (default: ./<package>.iife.js)')
    .option('--minify', 'Minify the output; --no-minify keeps it readable', { default: true })
    .option('--target <list>', 'Language level of the output, e.g. es2020 (default: esnext)')
    .option('--notices', 'Also write the full license texts of all bundled packages, e.g. to ms.iife.LICENSES.txt')
    .example('  $ iifeify vanilla-jsoneditor@3.13.0')
    .example('  $ iifeify chart.js --entry dist/chart.js --global-name ChartModule')
    .action(async (spec, options) => {
        const result = await convert({
            spec: String(spec),
            entry: text(options.entry),
            globalName: text(options.globalName),
            outfile: text(options.outfile),
            minify: options.minify,
            target: text(options.target)?.split(','),
            notices: options.notices,
            onStep: step => startStep(step.name === 'install'
                ? `Installing ${step.spec} with npm`
                : `Bundling ${step.label} with esbuild`),
        });
        endStep('done');
        report(result);
    });
cli.help();
cli.version(version);

// While a conversion runs, each step gets a line on stderr, like the warnings: what is being done,
// then how long it took, or that it failed. stdout gets the result only.
/** @type {number | undefined} */
let stepStartedAt;

/** @param {string} description */
function startStep(description) {
    endStep('done');
    process.stderr.write(`${description}... `);
    stepStartedAt = performance.now();
}

/** @param {'done' | 'failed'} outcome */
function endStep(outcome) {
    if (stepStartedAt === undefined) {
        return;
    }
    const ms = performance.now() - stepStartedAt;
    stepStartedAt = undefined;
    if (outcome === 'failed') {
        process.stderr.write('failed\n\n'); // the error follows after a blank line
        return;
    }
    const took = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
    process.stderr.write(`done in ${took}\n`);
}

/** @param {Awaited<ReturnType<typeof convert>>} result */
function report({ files, bytes, packages, entry, global, warnings }) {
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
    console.log(`  entry    ${entry.file} (${entry.reason})`);
    const holds = global.defaultExport ? ', holds the default export' : '';
    console.log(`  global   ${global.name ? `${global.name} (${global.reason}${holds})` : global.reason}`);
    if (dependencies.length > 0) {
        console.log(`  bundled  ${dependencies.length} ${dependencies.length === 1 ? 'dependency' : 'dependencies'}`);
        for (const dependency of dependencies) {
            console.log(`           ${described(dependency)}`);
        }
    }
    if (files.css) {
        console.log(`  styles   ${shown(files.css)}`);
    }
    if (files.notices) {
        console.log(`  notices  ${shown(files.notices)}`);
    }

    for (const warning of warnings) {
        console.error(`\n${warning}`);
    }
}

try {
    // Parsing prints the help or the version if asked to. Running is a separate step, so that
    // a failure inside the conversion can be awaited and caught here.
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
} catch (error) {
    endStep('failed');
    // cac does not export the class of the errors it throws for a wrong command line.
    if (error instanceof UsageError || error.name === 'CACError') {
        console.error(`${error.message}\nRun "iifeify --help" for the options.`);
        process.exitCode = 2;
    } else if (error instanceof ConversionError) {
        console.error(error.message);
        process.exitCode = 1;
    } else {
        console.error(error);
        process.exitCode = 1;
    }
}
