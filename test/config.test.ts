import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseToolsets } from '../src/config.js';

const base = { MALT_API_TOKEN: 'tok_abc123' } as NodeJS.ProcessEnv;

describe('parseToolsets', () => {
    it('enables nothing by default', () => {
        expect(parseToolsets(undefined).size).toBe(0);
        expect(parseToolsets('').size).toBe(0);
    });

    it('expands "all" to every toolset', () => {
        expect([...parseToolsets('all')].sort()).toEqual(['fee-invoices', 'invoices', 'payments', 'scim']);
    });

    it('accepts a comma list and tolerates spacing and case', () => {
        expect([...parseToolsets(' Invoices , SCIM ')].sort()).toEqual(['invoices', 'scim']);
    });

    it('rejects an unknown name rather than silently ignoring it', () => {
        expect(() => parseToolsets('invoices,projects')).toThrow(/projects/);
    });
});

describe('loadConfig', () => {
    it('requires a token and points at where to get one', () => {
        expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(ConfigError);
        expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/account\/tokens/);
    });

    it('defaults to raw auth, no toolsets and no writes', () => {
        const c = loadConfig({ ...base });
        expect(c.authScheme).toBe('raw');
        expect(c.toolsets.size).toBe(0);
        expect(c.allowWrites).toBe(false);
        expect(c.baseUrl).toBe('https://api.malt.com');
        expect(c.maxListItems).toBe(200);
    });

    it('strips a trailing slash from the base URL', () => {
        expect(loadConfig({ ...base, MALT_API_BASE_URL: 'http://localhost:9/' }).baseUrl).toBe('http://localhost:9');
    });

    it('rejects a bad auth scheme and a bad log level', () => {
        expect(() => loadConfig({ ...base, MALT_AUTH_SCHEME: 'oauth' })).toThrow(/raw.*bearer/);
        expect(() => loadConfig({ ...base, MALT_LOG_LEVEL: 'verbose' })).toThrow(/MALT_LOG_LEVEL/);
    });

    it('rejects a non-numeric rate limit', () => {
        expect(() => loadConfig({ ...base, MALT_RATE_LIMIT_RPS: 'fast' })).toThrow(ConfigError);
    });
});
