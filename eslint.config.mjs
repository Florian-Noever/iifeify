import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';

export default [
    {
        ignores: ['node_modules/**', 'examples/**', 'artifacts/**'],
    },

    // ── Base rules — every JavaScript file ───────────────────────────────────
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        plugins: {
            '@stylistic': stylistic,
            'import-x': importX,
        },
        rules: {
            // ── Formatting ───────────────────────────────────────────────────
            '@stylistic/indent': ['warn', 4, { SwitchCase: 1 }],
            '@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
            '@stylistic/semi': 'warn',
            '@stylistic/brace-style': ['warn', '1tbs'],
            '@stylistic/linebreak-style': ['warn', 'unix'],
            curly: 'warn',

            // ── Core correctness ─────────────────────────────────────────────
            eqeqeq: ['warn', 'always', { null: 'ignore' }],
            'no-console': 'warn',
            'no-eval': 'error',
            'no-throw-literal': 'warn',
            'no-useless-return': 'warn',
            'no-var': 'error',
            'object-shorthand': 'warn',
            'prefer-const': 'warn',
            'prefer-template': 'warn',

            // ── Code quality ─────────────────────────────────────────────────
            // Undefined names, wrong types and unused code are left to tsc, which checks the JSDoc too.
            'no-shadow': 'warn',

            // ── Imports ──────────────────────────────────────────────────────
            // Two groups: packages, then the project's own modules.
            'import-x/order': ['warn', {
                groups: [['builtin', 'external', 'unknown'], ['internal', 'parent', 'sibling', 'index']],
                'newlines-between': 'always',
                alphabetize: { order: 'ignore' },
            }],
            'import-x/no-duplicates': 'warn',
        },
    },

    // ── Command line — its output is the console ─────────────────────────────
    {
        files: ['bin/**/*.js'],
        rules: {
            'no-console': 'off',
        },
    },
];
