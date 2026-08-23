import { describe, expect, it } from 'vitest';
import { capList } from '../src/tools/operations.js';

const items = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('capList boundaries', () => {
    it('leaves an empty list alone', () => {
        expect(capList([], 10)).toEqual({ items: [], count: 0, truncated: false });
    });

    it('leaves a list one under the cap alone', () => {
        expect(capList(items(9), 10)).toMatchObject({ count: 9, truncated: false });
    });

    it('does not truncate a list exactly at the cap', () => {
        expect(capList(items(10), 10)).toMatchObject({ count: 10, truncated: false });
    });

    it('truncates a list one over the cap', () => {
        expect(capList(items(11), 10)).toMatchObject({ count: 10, truncated: true });
    });

    it('returns exactly the cap when far over it', () => {
        const result = capList(items(5000), 200);
        expect(result.items).toHaveLength(200);
        expect(result.truncated).toBe(true);
    });

    it('keeps the first items rather than an arbitrary slice', () => {
        expect(capList(items(100), 3).items).toEqual([0, 1, 2]);
    });

    it('handles a cap of one', () => {
        expect(capList(items(5), 1)).toMatchObject({ count: 1, truncated: true });
    });
});
