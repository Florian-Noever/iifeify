const RULE = '='.repeat(80);

/**
 * The comment that opens the generated script: one line per bundled package.
 *
 * @param {object[]} packages   as described by describePackage, the converted package first
 */
export function renderBanner([root, ...dependencies]) {
    if (dependencies.length === 0) {
        return `/*! ${line(root)} */`;
    }
    return [
        '/*!',
        ` * ${line(root)}`,
        ' *',
        ' * Bundled dependencies:',
        ...dependencies.map(dependency => ` * ${line(dependency)}`),
        ' */',
    ].join('\n');
}

function line({ name, version, copyright, license, url }) {
    return [[name, version].filter(Boolean).join(' '), copyright, licenseLabel(license), url]
        .filter(Boolean)
        .map(clean)
        .join(' - ');
}

function licenseLabel(license) {
    if (!license) {
        return 'license unknown';
    }
    // "MIT" reads better as "MIT License"; an expression such as "(MIT OR Apache-2.0)" stays as it is.
    return /^[\w.+-]+$/.test(license) ? `${license} License` : license;
}

// The values come from package metadata, which anyone can publish: nothing in them may end the
// comment or start a new line, or the rest would run as code.
function clean(value) {
    return String(value).replace(/\s+/g, ' ').replaceAll('*/', '* /').trim();
}

/**
 * The text of the notices file: the full license texts of all bundled packages.
 *
 * @param {object[]} packages    as described by describePackage
 * @param {string} scriptName    file name of the script the notices belong to
 */
export function renderNotices(packages, scriptName) {
    const sections = packages.map(({ name, version, license, url, legalTexts }) => [
        RULE,
        [name, version].filter(Boolean).join(' '),
        `License: ${license ?? 'unknown'}`,
        url,
        RULE,
        '',
        legalTexts.length > 0
            ? legalTexts.map(({ text }) => text).join('\n\n')
            : 'This package contains no license file.',
        '',
    ].join('\n'));

    return [`License notices for the packages bundled in ${scriptName}`, '', ...sections].join('\n');
}
