/**
 * Workflow prompts.
 *
 * The API's 13 operations only become useful in a few specific combinations,
 * and each combination has a trap in it. These encode the traps so the model
 * does not rediscover them one failed call at a time. Each registers only when
 * the toolsets it depends on are enabled.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from './config.js';

function userMessage(text: string) {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerPrompts(server: McpServer, config: Config): void {
    const has = (...names: string[]) => names.every(n => config.toolsets.has(n as never));

    if (has('invoices', 'fee-invoices', 'payments')) {
        server.registerPrompt(
            'malt_reconcile_revenue',
            {
                title: 'Reconcile Malt revenue for a period',
                description:
                    'Pull invoices, Malt service charges and payments received over a date range and reconcile ' +
                    'them into gross billed, platform charges, tax and cash received.',
                argsSchema: z.object({
                    since: z.string().describe('Start of the period, ISO 8601, e.g. 2026-01-01T00:00:00Z.'),
                    until: z.string().optional().describe('End of the period, ISO 8601. Defaults to now.')
                })
            },
            ({ since, until }) =>
                userMessage(
                    [
                        `Reconcile my Malt revenue from ${since}${until ? ` to ${until}` : ' to now'}.`,
                        '',
                        'Work through it in this order:',
                        '1. malt_find_invoices for what I billed clients.',
                        '2. malt_find_fee_invoices for what Malt billed me in commission.',
                        '3. malt_find_payments for cash that actually landed.',
                        '',
                        'Then report gross billed excluding tax, tax collected, gross billed including tax,',
                        'Malt service charges, and cash received. Reconcile payments against invoices using the',
                        'invoice list carried on each payment, and call out any invoice with no matching payment',
                        'and any payment that does not match an invoice.',
                        '',
                        'Two things to watch. Money flows in opposite directions in these two invoice families,',
                        'so do not add them together. And if any list comes back marked truncated, say so and',
                        'split the range into shorter windows rather than reporting a total you know is short.'
                    ].join('\n')
                )
        );
    }

    if (has('invoices') || has('fee-invoices')) {
        server.registerPrompt(
            'malt_get_invoice_document',
            {
                title: 'Retrieve a Malt invoice as a PDF',
                description: 'Find the right invoice and fetch its PDF, choosing the correct invoice family.',
                argsSchema: z.object({
                    reference: z.string().describe('Invoice id, client name, or a description of which invoice.')
                })
            },
            ({ reference }) =>
                userMessage(
                    [
                        `Find and download the Malt invoice PDF for: ${reference}`,
                        '',
                        'Pick the family by the direction of the money. An invoice I issued to a client is',
                        'malt_find_invoices then malt_get_invoice_pdf. A commission invoice Malt issued to me is',
                        'malt_find_fee_invoices then malt_get_fee_invoice_pdf. If the reference is ambiguous, ask',
                        'which one I mean before fetching.',
                        '',
                        'If I gave a description rather than an id, list the candidates you found and confirm',
                        'before downloading.'
                    ].join('\n')
                )
        );
    }

    if (has('scim')) {
        server.registerPrompt(
            'malt_user_lifecycle',
            {
                title: 'Provision or offboard a Malt user',
                description:
                    'Drive the SCIM user lifecycle safely, including the read-before-create rule that stands in ' +
                    'for the idempotency key Malt does not provide.',
                argsSchema: z.object({
                    action: z.string().describe('What to do, e.g. "onboard jane.doe@acme.com" or "offboard john".'),
                })
            },
            ({ action }) =>
                userMessage(
                    [
                        `Handle this Malt user request: ${action}`,
                        '',
                        'Rules that matter here:',
                        '- Always call malt_find_users with a userName eq filter before creating anyone.',
                        '  malt_create_user has no idempotency key, so a create that appears to fail may have',
                        '  worked, and repeating it makes a duplicate user.',
                        '- To offboard, use malt_deactivate_user. Do not reach for malt_delete_user: Malt refuses',
                        '  deletion with a 403 once the user has activity on the platform, and deactivation is the',
                        '  supported path. Delete is only for an account created in error.',
                        '- malt_replace_user clears anything you leave out, so read the user first and send the',
                        '  whole record back with your edits applied.',
                        '- The filter grammar supports only "eq". Nothing else will parse.',
                        '',
                        'Tell me what you are about to change and wait for confirmation before any write.'
                    ].join('\n')
                )
        );
    }
}
