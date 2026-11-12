# Changelog

All notable changes to **iifeify** are documented in this file.

---

## [2.0.0] – Unreleased

### Changed

- **Breaking:** without `--entry`, a package whose import entry needs other packages is bundled from its own browser build, when it names one in `browser`, `unpkg` or `jsdelivr` that needs no other package. vanilla-jsoneditor now gives what `--entry standalone.js` gave before
- **Breaking:** without `--global-name`, the global gets the name the package uses itself: from its type declarations, else from its own UMD or IIFE build, else from the package name, spelled as the package's exports spell it. Chart.js gets `Chart` instead of `ChartJs`, DOMPurify `DOMPurify` instead of `Dompurify`, and vanilla-jsoneditor `VanillaJsonEditor` instead of `VanillaJsoneditor`
- **Breaking:** for an ES module with a default export, the global is the default export, with the module's other exports as its properties, instead of an object with a `default` property
- The summary says where the entry and the global's name come from
- The hint about a prebuilt browser file is gone, since such a file is now chosen without it

### Fixed

- A classic script, such as Vue's `vue.global.js`, is written as it is instead of being wrapped in an IIFE that hid its global. `--global-name` with such a script is refused, since it cannot rename the script's own global

---

## [1.1.0] – 2026-11-12

### Added

- Progress while a conversion runs: a line on stderr when npm installs the package and when esbuild bundles it, each ending with the time it took, or with `failed` before the reason

---

## [1.0.0] – 2026-11-12

### Added

- `iifeify <package>[@version]` installs an npm package into a temporary folder and bundles it with esbuild into one classic script that defines a single global
- A license banner generated from the `package.json` and license file of every bundled package, and `--notices` for a file with their full license texts
- A package that imports a Node.js built-in module is refused as not browser compatible, with the modules and the files that import them
- `--entry`, `--global-name`, `--outfile`, `--no-minify` and `--target`, and a hint when a package ships a prebuilt browser file
