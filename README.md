# iifeify

Turn an npm package into one classic browser script.

```
npx iifeify vanilla-jsoneditor@3.13.0 --entry standalone.js --global-name VanillaJsonEditor
```

This writes `vanilla-jsoneditor.iife.js`. Loaded with a plain `<script>` tag, the file defines the global `VanillaJsonEditor`, which holds everything the package exports. The file starts with a license banner generated from the package's own metadata:

```js
/*! vanilla-jsoneditor 3.13.0 - Copyright (c) 2020-2026 by Jos de Jong - ISC License - https://github.com/josdejong/svelte-jsoneditor */
var VanillaJsonEditor=(()=>{ ... })();
```

iifeify is for hosts that accept only classic scripts and cannot `import` anything, such as control add-ins in Microsoft Dynamics 365 Business Central.

## Usage

```
npx iifeify <package>[@version] [options]
```

`<package>` is a package name as you would give it to `npm install`: `ms`, `ms@2.1.3`, `ms@^2`, `@codemirror/state`.

| Option | Meaning | Default |
| --- | --- | --- |
| `-e`, `--entry <path>` | File or subpath inside the package to bundle | The package's own browser entry |
| `-g`, `--global-name <name>` | Global variable the script defines | The package name in PascalCase |
| `-o`, `--outfile <file>` | Where to write the script | `./<package>.iife.js` |
| `--no-minify` | Keep the output readable | Minified |
| `--target <list>` | Language level of the output, for example `es2020` | `esnext` |
| `--notices` | Also write the full license texts next to the script, for example `ms.iife.LICENSES.txt` | Off |
| `-h`, `--help` | Show the help | |
| `-v`, `--version` | Show the version | |

The exit code is 0 on success, 1 if the package cannot be converted and 2 for a wrong command line.

## How it works

1. iifeify runs `npm install` for the package in a temporary folder. It uses your npm configuration, so private registries and proxies work. Install scripts are not run.
2. It bundles the package and the dependencies it imports into one file with [esbuild](https://esbuild.github.io/), in the `iife` format with your global name.
3. It reads `package.json` and the license file of every package that ended up in the bundle and writes the banner.
4. It removes the temporary folder.

## Which file is bundled

Without `--entry`, iifeify bundles what a bundler picks for an `import` of the package in browser code: the package's `exports` (conditions `browser`, `import`, `module`, `default`), or else its `browser`, `module` or `main` field. Dependencies are bundled from `node_modules`, in the versions that their version ranges resolve to on that day. The banner records the exact versions.

With `--entry` you choose a file inside the package, or a subpath that the package exports:

```
npx iifeify vanilla-jsoneditor --entry standalone.js
npx iifeify rxjs --entry operators
```

Some packages ship a ready-made browser file with all dependencies already inside, like `standalone.js` above. Bundling that file gives the same output every time. When a package names such a file in its `browser` field but `exports` points elsewhere, iifeify prints a hint with the `--entry` to use.

## The global

- For an ES module package the global is an object with the package's exports. A default export is the property `default`.
- For a CommonJS package the global is whatever the package assigns to `module.exports`.
- If the package imports CSS, the styles are written next to the script, with `.css` in place of `.js`.
- `process.env.NODE_ENV` is replaced by `"production"`.

## License information

The banner has one line for each package whose code is in the bundle: name, version, copyright notice, license and web address. With bundled dependencies it looks like this:

```js
/*!
 * is-odd 3.0.1 - Copyright (c) 2015-present, Jon Schlinkert. - MIT License - https://github.com/jonschlinkert/is-odd
 *
 * Bundled dependencies:
 * is-number 6.0.0 - Copyright (c) 2014-2018, Jon Schlinkert. - MIT License - https://github.com/jonschlinkert/is-number
 */
```

- The license comes from the `license` field of `package.json`.
- The copyright notice is the first one in the package's license file if the license is MIT, ISC or BSD. Otherwise it is the `author` from `package.json`, and it is left out if there is none.
- The address is the `homepage`, else the repository, else the package's npm page.
- License comments in the source files (`/*! ... */`, `@license`, `@preserve`) are kept at the end of the script.
- `--notices` writes the complete license and notice files of all bundled packages to one text file next to the script. Use it when you have to ship the full license texts with your product.

## Packages that cannot be converted

iifeify fails, and writes nothing, when the package cannot be bundled for a browser:

- It imports a Node.js built-in module such as `fs` or `path`. The message names the modules and the files that import them.
- It has no entry point that browser code can import, for example a command-line tool or a package whose `exports` only allow `require`. Name a file with `--entry` if you know one that works.
- It imports a file type other than JavaScript, JSON or CSS, such as an image, a font or WebAssembly.
- It uses top-level `await`, which a classic script cannot do.

A package passes this check and can still fail in the browser if it uses Node.js globals such as `process.argv` or `Buffer` without importing anything. iifeify does not look for that.

## Example: a Business Central control add-in

A control add-in loads classic scripts only, so a library such as [vanilla-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) has to be one file that defines a global. The command at the top of this page generates that file. In the `controladdin` object, list it under `Scripts`:

```al
Scripts = 'vanilla-jsoneditor.iife.js';
StartupScript = 'Startup.js';
```

The startup script then finds the library in the global `VanillaJsonEditor` and can call, for example, `VanillaJsonEditor.createJSONEditor(...)`.

## Requirements

Node.js 20.19 or newer, with npm.

## Development

```
npm install
npm test
npm run test:e2e
```

`npm test` runs offline. `npm run test:e2e` installs real packages from the npm registry. Both need Node.js 22 or newer. From a checkout, run the tool with `node bin/cli.js <package>`.

## License

MIT
