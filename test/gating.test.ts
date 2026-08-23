import { describe, expect, it } from 'vitest';
import { promptNames, toolNames } from './harness.js';

describe('toolset gating', () => {
    it('exposes nothing at all by default', async () => {
        expect(await toolNames({})).toEqual([]);
    });

    it('exposes exactly the invoices toolset when asked for it', async () => {
        expect(await toolNames({ MALT_TOOLSETS: 'invoices' })).toEqual([
            'malt_find_invoices',
            'malt_get_invoice',
            'malt_get_invoice_pdf'
        ]);
    });

    it('adds only the requested toolset, leaving the rest hidden', async () => {
        const names = await toolNames({ MALT_TOOLSETS: 'invoices,payments' });
        expect(names).toContain('malt_find_payments');
        expect(names).not.toContain('malt_find_fee_invoices');
        expect(names).toHaveLength(4);
    });

    it('hides SCIM writes until writes are allowed', async () => {
        const names = await toolNames({ MALT_TOOLSETS: 'scim' });
        expect(names).toEqual(['malt_find_users', 'malt_get_user']);
        expect(names).not.toContain('malt_delete_user');
    });

    it('exposes SCIM writes once MALT_ALLOW_WRITES is set', async () => {
        const names = await toolNames({ MALT_TOOLSETS: 'scim', MALT_ALLOW_WRITES: 'true' });
        expect(names).toEqual([
            'malt_create_user',
            'malt_deactivate_user',
            'malt_delete_user',
            'malt_find_users',
            'malt_get_user',
            'malt_replace_user'
        ]);
    });

    it('exposes all 13 operations with "all" plus writes', async () => {
        expect(await toolNames({ MALT_TOOLSETS: 'all', MALT_ALLOW_WRITES: 'true' })).toHaveLength(13);
    });

    it('names the PATCH tool for what the API actually accepts', async () => {
        const names = await toolNames({ MALT_TOOLSETS: 'scim', MALT_ALLOW_WRITES: 'true' });
        expect(names).toContain('malt_deactivate_user');
        expect(names).not.toContain('malt_modify_user');
    });
});

describe('prompt gating', () => {
    it('offers no prompts when no toolsets are on', async () => {
        expect(await promptNames({})).toEqual([]);
    });

    it('withholds reconciliation until all three billing toolsets are on', async () => {
        expect(await promptNames({ MALT_TOOLSETS: 'invoices,payments' })).not.toContain('malt_reconcile_revenue');
        expect(await promptNames({ MALT_TOOLSETS: 'invoices,payments,fee-invoices' })).toContain(
            'malt_reconcile_revenue'
        );
    });

    it('offers the user lifecycle prompt with the scim toolset', async () => {
        expect(await promptNames({ MALT_TOOLSETS: 'scim' })).toEqual(['malt_user_lifecycle']);
    });
});

describe('tool metadata', () => {
    it('marks reads read-only and destructive writes destructive', async () => {
        const { startSession } = await import('./harness.js');
        const session = await startSession({ MALT_TOOLSETS: 'all', MALT_ALLOW_WRITES: 'true' });
        const { tools } = await session.send('tools/list');
        const byName = new Map(tools.map((t: any) => [t.name, t]));

        expect(byName.get('malt_find_invoices').annotations.readOnlyHint).toBe(true);
        expect(byName.get('malt_delete_user').annotations.destructiveHint).toBe(true);
        expect(byName.get('malt_create_user').annotations.idempotentHint).toBe(false);

        const readOnly = tools.filter((t: any) => t.annotations?.readOnlyHint === true);
        expect(readOnly).toHaveLength(9);

        await session.close();
    });
});
