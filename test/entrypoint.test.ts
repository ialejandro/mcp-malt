/**
 * The bin is installed as a symlink, so `npx` runs `.bin/mcp-malt` rather than
 * `dist/index.js`. Version 1.0.0 compared argv[1] to import.meta.url as raw
 * strings, which never matched through that symlink: the server exited 0 having
 * started nothing, with no error to explain it.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isMainModule } from '../src/index.js';

let dir: string;
let realFile: string;
let linkToFile: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-malt-entry-'));
    realFile = join(dir, 'index.js');
    linkToFile = join(dir, 'mcp-malt');
    writeFileSync(realFile, '');
    symlinkSync(realFile, linkToFile);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('isMainModule', () => {
    it('matches when the file is run directly', () => {
        expect(isMainModule(realFile, pathToFileURL(realFile).href)).toBe(true);
    });

    it('matches through a bin symlink, which is how npx invokes it', () => {
        expect(isMainModule(linkToFile, pathToFileURL(realFile).href)).toBe(true);
    });

    it('does not match a different file, so importing the module starts nothing', () => {
        const other = join(dir, 'other.js');
        writeFileSync(other, '');
        expect(isMainModule(other, pathToFileURL(realFile).href)).toBe(false);
    });

    it('does not match when there is no argv[1]', () => {
        expect(isMainModule(undefined, pathToFileURL(realFile).href)).toBe(false);
    });

    it('returns false rather than throwing when the path does not exist', () => {
        expect(isMainModule(join(dir, 'missing.js'), pathToFileURL(realFile).href)).toBe(false);
    });
});
