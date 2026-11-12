import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Writes files into a new temp folder that is removed when the test ends.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string | object>} files   path -> text, or an object to write as JSON
 * @returns {string} the folder
 */
export function tempTree(t, files = {}) {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'iifeify-test-')));
    t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

    for (const [path, content] of Object.entries(files)) {
        const file = join(root, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    }
    return root;
}
