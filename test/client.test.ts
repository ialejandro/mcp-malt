import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, MaltApiError } from '../src/client.js';
import { loadConfig } from '../src/config.js';
import { createLogger, redact } from '../src/logger.js';

const log = createLogger('error');

function cfg(extra: NodeJS.ProcessEnv = {}) {
    // Pacing off by default so tests do not sit in setTimeout.
    return loadConfig({ MALT_API_TOKEN: 'tok_abc123', MALT_RATE_LIMIT_RPS: '1000', ...extra });
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });
}

afterEach(() => vi.restoreAllMocks());

describe('auth', () => {
    it('sends the bare token, which is what Malt documents', async () => {
        const fetchMock = vi.fn().mockImplementation(() => reply(200, []));
        vi.stubGlobal('fetch', fetchMock);

        await createClient(cfg(), log).request('/freelancer/invoices');

        expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('tok_abc123');
    });

    it('sends Bearer only when explicitly asked', async () => {
        const fetchMock = vi.fn().mockImplementation(() => reply(200, []));
        vi.stubGlobal('fetch', fetchMock);

        await createClient(cfg({ MALT_AUTH_SCHEME: 'bearer' }), log).request('/freelancer/invoices');

        expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok_abc123');
    });

    it('drops undefined query parameters instead of sending "undefined"', async () => {
        const fetchMock = vi.fn().mockImplementation(() => reply(200, []));
        vi.stubGlobal('fetch', fetchMock);

        await createClient(cfg(), log).request('/freelancer/invoices', {
            query: { since: '2026-01-01', until: undefined }
        });

        const url = String(fetchMock.mock.calls[0]![0]);
        expect(url).toContain('since=2026-01-01');
        expect(url).not.toContain('until');
    });
});

describe('error mapping', () => {
    it('explains a 401 and where to get a new token', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('', { status: 401 })));
        await expect(createClient(cfg(), log).request('/freelancer/invoices')).rejects.toThrow(
            /401.*account\/tokens/s
        );
    });

    it('reads the Spring-shaped freelancer error body', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() => reply(400, { timestamp: 't', status: 400, error: 'Bad since', path: '/x' }))
        );
        await expect(createClient(cfg(), log).request('/freelancer/invoices')).rejects.toThrow(/Bad since/);
    });

    it('reads the SCIM error body and explains the eq-only filter', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() =>
                reply(400, {
                    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
                    status: 400,
                    scimType: 'invalidFilter',
                    detail: 'Unsupported operator'
                })
            )
        );
        const err = await createClient(cfg(), log)
            .request('/scim/v2/Users')
            .catch(e => e as MaltApiError);
        expect(err.message).toMatch(/"eq" operator/);
        expect(err.message).toMatch(/Unsupported operator/);
    });

    it('falls back to the generic explanation when the caller offers no hint', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('', { status: 403 })));
        await expect(createClient(cfg(), log).request('/scim/v2/Users/u1', { method: 'DELETE' })).rejects.toThrow(
            /lacks the permission scope/
        );
    });

    it('lets the caller override a status with an endpoint-specific hint', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('', { status: 403 })));

        await expect(
            createClient(cfg(), log).request('/scim/v2/Users/u1', {
                method: 'DELETE',
                errorHints: { 403: 'This user still has activity; deactivate instead.' }
            })
        ).rejects.toThrow(/deactivate instead/);
    });

    it('still appends Malt detail to a hinted message', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => reply(403, { detail: 'pending missions' })));

        await expect(
            createClient(cfg(), log).request('/x', { method: 'DELETE', errorHints: { 403: 'Custom.' } })
        ).rejects.toThrow(/Custom\. Malt said: pending missions\./);
    });

    it('keeps a non-JSON error body rather than discarding it', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('<html>gateway</html>', { status: 500 })));
        await expect(createClient(cfg(), log).request('/x')).rejects.toThrow(/gateway/);
    });
});

describe('retries', () => {
    it('never retries POST, because createUser has no idempotency key', async () => {
        const fetchMock = vi.fn().mockImplementation(() => reply(503, {}));
        vi.stubGlobal('fetch', fetchMock);

        await expect(createClient(cfg(), log).request('/scim/v2/Users', { method: 'POST', body: {} })).rejects.toThrow(
            MaltApiError
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries GET on 503 and returns the eventual success', async () => {
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(() => reply(503, {}))
            .mockImplementationOnce(() => reply(200, [{ id: 'INV-1' }]));
        vi.stubGlobal('fetch', fetchMock);

        const out = await createClient(cfg(), log).request<unknown[]>('/freelancer/invoices');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(out).toEqual([{ id: 'INV-1' }]);
    });

    it('gives up after three attempts', async () => {
        const fetchMock = vi.fn().mockImplementation(() => reply(502, {}));
        vi.stubGlobal('fetch', fetchMock);

        await expect(createClient(cfg(), log).request('/freelancer/invoices')).rejects.toThrow(MaltApiError);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not retry a plain 404', async () => {
        const fetchMock = vi.fn().mockImplementation(() => reply(404, {}));
        vi.stubGlobal('fetch', fetchMock);

        await expect(createClient(cfg(), log).request('/freelancer/invoices/nope')).rejects.toThrow(/404/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('responses', () => {
    it('treats 204 as an empty result', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response(null, { status: 204 })));
        await expect(createClient(cfg(), log).request('/scim/v2/Users/u1', { method: 'DELETE' })).resolves.toBeUndefined();
    });
});

describe('pacing', () => {
    it('spaces consecutive calls by the configured interval', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => reply(200, [])));
        const client = createClient(cfg({ MALT_RATE_LIMIT_RPS: '20' }), log); // 50ms apart

        const started = Date.now();
        await client.request('/freelancer/invoices');
        await client.request('/freelancer/invoices');
        await client.request('/freelancer/invoices');

        expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    });
});

describe('redaction', () => {
    it('removes the token wherever it appears in a line', () => {
        expect(redact('auth=tok_abc123 and again tok_abc123', 'tok_abc123')).toBe('auth=*** and again ***');
    });

    it('leaves text alone when there is no token', () => {
        expect(redact('nothing here', undefined)).toBe('nothing here');
    });
});
