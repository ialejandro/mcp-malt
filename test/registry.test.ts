/**
 * Invariants that keep the extension points honest.
 *
 * These exist to fail loudly when someone adds a toolset and forgets a step,
 * which is exactly the mistake the registry is meant to make hard.
 */

import { describe, expect, it } from 'vitest';
import { TOOLSET_NAMES, TOOLSETS } from '../src/tools/registry.js';
import { TOOL_PREFIX } from '../src/tools/shared.js';
import { parseToolsets } from '../src/config.js';
import { toolNames } from './harness.js';

describe('registry', () => {
    it('gives every toolset a unique name', () => {
        expect(new Set(TOOLSET_NAMES).size).toBe(TOOLSET_NAMES.length);
    });

    it('gives every toolset a summary for the empty-config message', () => {
        for (const toolset of TOOLSETS) {
            expect(toolset.summary, `${toolset.name} has no summary`).toBeTruthy();
        }
    });

    it('uses lowercase kebab-case names, since MALT_TOOLSETS is lowercased before matching', () => {
        for (const name of TOOLSET_NAMES) expect(name).toMatch(/^[a-z][a-z-]*$/);
    });

    it('accepts every registered name in MALT_TOOLSETS', () => {
        for (const name of TOOLSET_NAMES) {
            expect(parseToolsets(name)).toEqual(new Set([name]));
        }
    });

    it('enables exactly the registered toolsets with "all"', () => {
        expect(parseToolsets('all')).toEqual(new Set(TOOLSET_NAMES));
    });
});

describe('tool naming', () => {
    it('prefixes every registered tool', async () => {
        const names = await toolNames({ MALT_TOOLSETS: 'all', MALT_ALLOW_WRITES: 'true' });
        for (const name of names) expect(name.startsWith(`${TOOL_PREFIX}_`)).toBe(true);
    });

    it('registers no duplicate tool names across toolsets', async () => {
        const names = await toolNames({ MALT_TOOLSETS: 'all', MALT_ALLOW_WRITES: 'true' });
        expect(new Set(names).size).toBe(names.length);
    });

    it('registers a tool for every toolset that is enabled', async () => {
        for (const name of TOOLSET_NAMES) {
            const names = await toolNames({ MALT_TOOLSETS: name });
            expect(names.length, `${name} registered no tools`).toBeGreaterThan(0);
        }
    });
});
