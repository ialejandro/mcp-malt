import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSession } from './harness.js';

const env = { MALT_TOOLSETS: 'all', MALT_ALLOW_WRITES: 'true', MALT_RATE_LIMIT_RPS: '1000' };

function json(body: unknown, status = 200) {
    return () => new Response(JSON.stringify(body), { status });
}

async function callTool(name: string, args: Record<string, unknown>, extraEnv: NodeJS.ProcessEnv = {}) {
    const session = await startSession({ ...env, ...extraEnv });
    try {
        return await session.send('tools/call', { name, arguments: args });
    } finally {
        await session.close();
    }
}

afterEach(() => vi.restoreAllMocks());

describe('invoices', () => {
    it('returns invoices with a count and no truncation', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(json([{ id: 'INV-1' }, { id: 'INV-2' }])));

        const res = await callTool('malt_find_invoices', { since: '2026-01-01T00:00:00Z' });

        expect(res.structuredContent.count).toBe(2);
        expect(res.structuredContent.truncated).toBe(false);
        expect(res.content[0].text).toBe('Found 2 invoices.');
    });

    it('truncates an unpaged list at the cap and says so', async () => {
        const many = Array.from({ length: 50 }, (_, i) => ({ id: `INV-${i}` }));
        vi.stubGlobal('fetch', vi.fn().mockImplementation(json(many)));

        const res = await callTool('malt_find_invoices', { since: '2026-01-01T00:00:00Z' }, { MALT_MAX_LIST_ITEMS: '10' });

        expect(res.structuredContent.count).toBe(10);
        expect(res.structuredContent.truncated).toBe(true);
        expect(res.content[0].text).toMatch(/Narrow the date range/);
    });

    // Malt sends null for absent optional fields rather than omitting them.
    // Schemas that were optional but not nullable failed every live call while
    // every mocked test passed, because the fixtures omitted the fields instead.
    it('accepts null in the optional fields Malt actually nulls', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(
                json([
                    {
                        id: 'ESRE0063GQ260001',
                        title: 'DevOps para proyecto de migración',
                        creationDate: '2026-02-02T08:17:59.694Z',
                        expectedPaymentDate: '2026-04-03T00:00:00Z',
                        externalId: null,
                        amountAllTaxesIncluded: 2544.0,
                        amountWithoutTaxes: 2400.0,
                        taxes: [{ name: 'IRPF', amount: -360.0, rate: -15.0 }],
                        customer: { name: 'Malt Community SL', city: 'Madrid', country: null },
                        supplier: { name: 'Someone', registrationNumber: null, vatNumber: null }
                    }
                ])
            )
        );

        const res = await callTool('malt_find_invoices', { since: '2026-01-01T00:00:00Z' });

        expect(res.isError).toBeUndefined();
        expect(res.structuredContent.count).toBe(1);
    });

    // Malt declares these parameters as date-time and enforces it: a plain
    // 2026-02-01 comes back as a 400. Date-only input is widened rather than
    // refused, because it is what people and models naturally pass.
    it('widens a date-only since to the start of that day', async () => {
        const fetchMock = vi.fn().mockImplementation(json([]));
        vi.stubGlobal('fetch', fetchMock);

        await callTool('malt_find_invoices', { since: '2026-02-01' });

        expect(String(fetchMock.mock.calls[0]![0])).toContain('since=2026-02-01T00%3A00%3A00.000Z');
    });

    it('widens a date-only until to the end of that day, so the last day is included', async () => {
        const fetchMock = vi.fn().mockImplementation(json([]));
        vi.stubGlobal('fetch', fetchMock);

        await callTool('malt_find_invoices', { since: '2026-02-01', until: '2026-02-28' });

        expect(String(fetchMock.mock.calls[0]![0])).toContain('until=2026-02-28T23%3A59%3A59.999Z');
    });

    it('passes a full date-time through untouched', async () => {
        const fetchMock = vi.fn().mockImplementation(json([]));
        vi.stubGlobal('fetch', fetchMock);

        await callTool('malt_find_invoices', { since: '2026-02-01T09:30:00Z' });

        expect(String(fetchMock.mock.calls[0]![0])).toContain('since=2026-02-01T09%3A30%3A00Z');
    });

    it('rejects a since value that is not a date before calling the API', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const res = await callTool('malt_find_invoices', { since: 'last tuesday' });

        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/ISO 8601/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('decodes the base64 PDF Malt wraps in JSON and attaches it', async () => {
        const pdf = Buffer.from('%PDF-1.4 fake').toString('base64');
        vi.stubGlobal('fetch', vi.fn().mockImplementation(json({ id: 'INV-1', pdf })));

        const res = await callTool('malt_get_invoice_pdf', { id: 'INV-1' });

        expect(res.structuredContent).toEqual({ id: 'INV-1', bytes: 13 });
        expect(res.content[1].resource.mimeType).toBe('application/pdf');
        expect(res.content[1].resource.blob).toBe(pdf);
    });
});

describe('failures reach the model as tool errors, not transport faults', () => {
    it('turns a 401 into an isError result', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('', { status: 401 })));

        const res = await callTool('malt_find_payments', { since: '2026-01-01T00:00:00Z' });

        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/account\/tokens/);
    });
});

describe('scim', () => {
    it('sends a PATCH that only deactivates, whatever the caller asks for', async () => {
        const fetchMock = vi.fn().mockImplementation(() => new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);

        await callTool('malt_deactivate_user', { userId: 'u1' });

        const [, init] = fetchMock.mock.calls[0]!;
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toEqual({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', value: { active: false } }]
        });
    });

    it('refuses a blank userName rather than letting Malt reject it', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const res = await callTool('malt_create_user', { userName: '   ' });

        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/userName cannot be blank/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('caps phone numbers at the three Malt accepts', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const res = await callTool('malt_create_user', {
            userName: 'jane@acme.com',
            phoneNumbers: [{ value: '1' }, { value: '2' }, { value: '3' }, { value: '4' }]
        });

        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/<=3 items/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains a refused delete in terms of the deactivate tool', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('', { status: 403 })));

        const res = await callTool('malt_delete_user', { userId: 'u1' });

        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/malt_deactivate_user/);
    });

    it('does not send the userId in the replace body', async () => {
        const fetchMock = vi.fn().mockImplementation(json({ id: 'u1' }));
        vi.stubGlobal('fetch', fetchMock);

        await callTool('malt_replace_user', { userId: 'u1', userName: 'jane@acme.com' });

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(String(url)).toContain('/scim/v2/Users/u1');
        expect(JSON.parse(init.body)).toEqual({ userName: 'jane@acme.com' });
    });
});
