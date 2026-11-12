# iifeify

Turn an npm package into one classic browser script.

```bash
npx -y iifeify vanilla-jsoneditor@3.13.0
```

This writes `vanilla-jsoneditor.iife.js`. Loaded with a plain `<script>` tag, the file defines the global `VanillaJsonEditor`, which holds everything the package exports. iifeify chose both by itself: the package's browser build `standalone.js`, which needs no other packages, and a global named after the package. The file starts with a license banner generated from the package's own metadata:

```js
/*! vanilla-jsoneditor 3.13.0 - Copyright (c) 2020-2026 by Jos de Jong - ISC License - https://github.com/josdejong/svelte-jsoneditor */
var VanillaJsonEditor=(()=>{ ... })();
```

iifeify is for hosts that accept only classic scripts and cannot `import` anything, such as control add-ins in Microsoft Dynamics 365 Business Central.

---

## ✨ Features

- **Any npm package** — installed with npm itself, so versions, ranges, tags, scoped packages, private registries and proxies work as they do for `npm install`
- **One file, one global** — the package and every dependency it imports, bundled with [esbuild](https://esbuild.github.io/) into an IIFE
- **No options needed** — the package's own browser build is used when that saves bundling its dependencies, and the global gets the name the package itself uses, holding what its documentation shows
- **License banner** — one line per bundled package with its version, copyright notice, license and web address, read from its `package.json` and license file
- **Full license texts** — `--notices` writes the license and notice files of all bundled packages next to the script
- **Browser check** — a package that imports `fs`, `path` or another Node.js built-in is refused, with the modules and the files that import them

---

## 🚀 Installation

Run it directly with `npx`, no installation required:

```bash
npx -y iifeify <package>
```

Or install it globally:

```bash
npm install -g iifeify
```

---

## 🧰 Usage

```bash
npx iifeify <package>[@version] [options]
```

`<package>` is a package name as you would give it to `npm install`: `ms`, `ms@2.1.3`, `ms@^2`, `@codemirror/state`.

| Option | Meaning | Default |
| --- | --- | --- |
| `-e`, `--entry <path>` | File or subpath inside the package to bundle | Detected, see [Which file is bundled](#which-file-is-bundled) |
| `-g`, `--global-name <name>` | Global variable the script defines | Detected, see [The global](#the-global) |
| `-o`, `--outfile <file>` | Where to write the script | `./<package>.iife.js` |
| `--no-minify` | Keep the output readable | Minified |
| `--target <list>` | Language level of the output, for example `es2020` | `esnext` |
| `--notices` | Also write the full license texts next to the script, for example `ms.iife.LICENSES.txt` | Off |
| `-h`, `--help` | Show the help | |
| `-v`, `--version` | Show the version | |

While it runs, iifeify prints each step and how long it took on stderr, and the result on stdout:

```text
Installing vanilla-jsoneditor@3.13.0 with npm... done in 3.3s
Bundling vanilla-jsoneditor 3.13.0 with esbuild... done in 847ms
Wrote vanilla-jsoneditor.iife.js (1.21 MB)
  package  vanilla-jsoneditor 3.13.0 - ISC
  entry    standalone.js (browser build without dependencies)
  global   VanillaJsonEditor (from the package name)
```

The summary says which file was bundled and where the global's name comes from. A step that fails ends with `failed`, followed by the reason. The exit code is 0 on success, 1 if the package cannot be converted and 2 for a wrong command line.

### How it works

1. iifeify runs `npm install` for the package in a temporary folder. It uses your npm configuration, so private registries and proxies work. Install scripts are not run.
2. It chooses the file to bundle and the global's name, and bundles that file and the dependencies it imports into one file with esbuild, in the `iife` format.
3. It reads `package.json` and the license file of every package that ended up in the bundle and writes the banner.
4. It removes the temporary folder.

### Which file is bundled

Without `--entry`, iifeify starts from what a bundler picks for an `import` of the package in browser code: the package's `exports` (conditions `browser`, `import`, `module`, `default`), or else its `browser`, `module` or `main` field.

When that import entry pulls in other packages, iifeify looks at the files the package names for browsers in `browser`, `unpkg` and `jsdelivr`, and takes the first that needs no other package and exports something, or is a classic script. Such a build is the one the package's authors tested, it gives the same output every time, and it is usually what the package's documentation describes for a `<script>` tag: vanilla-jsoneditor gets its `standalone.js`, Chart.js its `chart.umd.min.js` and Vue its `vue.global.js`. When the import entry cannot be bundled at all, those files are tried as well.

Otherwise iifeify bundles the import entry, together with its dependencies from `node_modules` in the versions their ranges resolve to on that day. The banner records the exact versions.

With `--entry` you choose a file inside the package, or a subpath that the package exports:

```bash
npx -y iifeify vanilla-jsoneditor --entry index.js
npx -y iifeify rxjs --entry operators
```

**Classic scripts are used as they are.** A UMD or IIFE build that defines its globals itself, such as `vue.global.js`, is not wrapped in another IIFE, which would hide its global. iifeify writes it with the banner on top, minified unless `--no-minify`. Its global keeps the name the script gives it, so `--global-name` cannot be used with it.

### The global

Without `--global-name`, the global gets the name the package uses itself:

1. the one its type declarations declare with `export as namespace`, such as `ApexCharts`;
2. else the one its own UMD or IIFE build assigns, such as `Chart`, `dayjs` or `DOMPurify`;
3. else a name made from the package name: `chart.js` gives `Chart`, and `vanilla-jsoneditor` gives `VanillaJsonEditor`, spelled as the package's export `JsonEditor`.

What the global holds:

- For an ES module with a default export, the default export, with the module's other exports as its properties. That is what a package's own browser build defines, so `DOMPurify.sanitize()` works as its documentation shows. A default export that cannot have properties, such as a number, leaves the global an object with all exports.
- For an ES module without a default export, an object with the module's exports.
- For a CommonJS package, whatever the package assigns to `module.exports`.
- A classic script defines its globals itself.

If the package imports CSS, the styles are written next to the script, with `.css` in place of `.js`. `process.env.NODE_ENV` is replaced by `"production"`.

### License information

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

### Packages that cannot be converted

iifeify fails, and writes nothing, when the package cannot be bundled for a browser:

- It imports a Node.js built-in module such as `fs` or `path`. The message names the modules and the files that import them.
- It has no entry point that browser code can import, for example a command-line tool or a package whose `exports` only allow `require`. Name a file with `--entry` if you know one that works.
- It imports a file type other than JavaScript, JSON or CSS, such as an image, a font or WebAssembly.
- It uses top-level `await`, which a classic script cannot do.

A package passes this check and can still fail in the browser if it uses Node.js globals such as `process.argv` or `Buffer` without importing anything. iifeify does not look for that.

---

## 🧠 Requirements

- **Node.js** ≥ 22, with npm

---

## 🏗 Example

A Business Central control add-in loads classic scripts only, so a library such as [vanilla-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) has to be one file that defines a global. The command at the top of this page generates that file. In the `controladdin` object, list it under `Scripts`:

```al
Scripts = 'vanilla-jsoneditor.iife.js';
StartupScript = 'Startup.js';
```

The startup script then finds the library in the global `VanillaJsonEditor` and can call, for example, `VanillaJsonEditor.createJSONEditor(...)`.

---

## 🧩 Repository

GitHub: [Florian-Noever/iifeify](https://github.com/Florian-Noever/iifeify)

Bug reports and feature requests are welcome via [Issues](https://github.com/Florian-Noever/iifeify/issues).

---

## 🛠️ Developer Notes

### Architecture

Plain JavaScript modules, run by Node.js as they are: there is no build step, and the package ships `bin/` and `src/` unchanged.

| Module | Purpose |
| --- | --- |
| `bin/cli.js` | The command line, parsed with [cac](https://github.com/cacjs/cac), and the summary it prints |
| `src/convert.js` | One conversion from start to end, including the temporary folder |
| `src/install.js` | Reading the package spec and running `npm install` |
| `src/entry.js` | Which file to bundle: the import entry, or a browser build, and whether it is a classic script |
| `src/global.js` | The global's name: from the type declarations, the package's own build, or the package name |
| `src/bundle.js` | The esbuild calls that probe an entry and build the script, and the explanation when a package cannot be bundled |
| `src/packages.js` | Which packages ended up in the bundle, and their metadata and license files |
| `src/banner.js` | The banner and the notices file |

### Build commands

```bash
npm ci                 # install exactly what package-lock.json pins

npm run check-types    # tsc over the JavaScript and its JSDoc types
npm run lint           # eslint, with no warning allowed
npm test               # the offline tests
npm run test:e2e       # tests that install real packages from the npm registry
node bin/cli.js ms     # the tool, run from the checkout
```

**Install scripts are opt-in.** npm 11 runs a dependency's install script only when `allowScripts` in `package.json` approves it. esbuild's is approved. On Windows, the import rules of the linter need the Microsoft Visual C++ Redistributable, which most machines already have.

### Tests

Both suites use Node.js's own test runner. `npm test` runs offline: it bundles small packages written into a temporary `node_modules`, and runs the CLI on packages in local folders, which npm installs without the registry. `npm run test:e2e` converts `ms`, `is-odd`, `mkdirp`, `vanilla-jsoneditor`, `chart.js` and `dompurify` from the npm registry.

### CI & Releases

CI runs on every push and pull request. One job type-checks and lints, one runs both test suites on Linux with Node.js 22, 24 and 26 and on Windows with Node.js 24, and a third packs a preview tarball, kept for 14 days. Dependabot's minor and patch updates are merged once all three passed. `ci.yml` and `publish.yml` only call the shared npm package workflows of [Florian-Noever/Florian-Noever](https://github.com/Florian-Noever/Florian-Noever/blob/main/.github/CI.md), which hold the jobs.

To release, bump the version with `npm version x.y.z --no-git-tag-version` and publish a GitHub release `vx.y.z` from a commit whose CI is green. The publish workflow checks, tests and packs the tag, attaches the tarball to the release with a build attestation, and publishes the same tarball to npm. A pre-release only gets the tarball on the GitHub release.

npm publishes through a trusted publisher instead of a token, and adds provenance. npm only offers trusted publishers for a package that exists, so publish the first version from your machine with `npm publish`. Shortly before the next release, add one in the package's settings on [npmjs.com](https://www.npmjs.com): GitHub Actions, user `Florian-Noever`, repository `iifeify`, workflow `publish.yml`, environment `npm`. Allow `npm publish` for it as well, since a new trusted publisher only allows staged publishing otherwise. It expires unless it publishes within 48 hours. npm checks the name of this repository's `publish.yml`, not of the shared workflow it calls; see [Trusted publishing](https://github.com/Florian-Noever/Florian-Noever/blob/main/.github/CI.md#trusted-publishing) in the shared CI docs.

---

## 📜 License

Licensed under the [MIT](LICENSE) License.

<br>
<br>

[!["Buy me a coffee"](https://raw.githubusercontent.com/Florian-Noever/Florian-Noever/refs/heads/main/_meta/BuyMeACoffee/Buttons%20%26%20Icons/orange-button-x180.png)](https://www.buymeacoffee.com/florian_noever)
