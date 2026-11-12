# Changelog

All notable changes to **iifeify** are documented in this file.

---

## [Unreleased]

### Added

- `iifeify <package>[@version]` installs an npm package into a temporary folder and bundles it with esbuild into one classic script that defines a single global
- A license banner generated from the `package.json` and license file of every bundled package, and `--notices` for a file with their full license texts
- A package that imports a Node.js built-in module is refused as not browser compatible, with the modules and the files that import them
- `--entry`, `--global-name`, `--outfile`, `--no-minify` and `--target`, and a hint when a package ships a prebuilt browser file
