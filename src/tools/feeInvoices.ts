/**
 * Malt's own service charge invoices: the commission Malt bills you.
 * Same three operations as client invoices, opposite direction of money.
 */

import { z } from 'zod';
import { dateRange, feeInvoiceResource, listEnvelope, pdfResource } from '../schemas.js';
import { findById, findInDateRange, findPdfById, type ResourceFamily } from './operations.js';
import { guard, toolName, type Toolset } from './shared.js';

const FEE_INVOICES: ResourceFamily = {
    path: '/freelancer/fee-invoices',
    label: 'service charge invoices',
    singular: 'Service charge invoice'
};

const idArg = z.object({ id: z.string().describe('Fee invoice identifier.') });

export const feeInvoicesToolset: Toolset = {
    name: 'fee-invoices',
    summary: "Malt's commission invoices to you, including their PDFs.",

    register(server, ctx) {
        server.registerTool(
            toolName('find', 'fee', 'invoices'),
            {
                title: 'Find service charge invoices',
                description:
                    'List Malt service charge (commission) invoices within a date range. These are what Malt bills ' +
                    'you, as opposed to malt_find_invoices which is what you bill clients. "since" is required.',
                inputSchema: dateRange,
                outputSchema: listEnvelope(feeInvoiceResource),
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async range => guard(ctx.log, () => findInDateRange(ctx, FEE_INVOICES, range))
        );

        server.registerTool(
            toolName('get', 'fee', 'invoice'),
            {
                title: 'Get a service charge invoice',
                description: 'Fetch one Malt service charge invoice by its identifier.',
                inputSchema: idArg,
                outputSchema: feeInvoiceResource,
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async ({ id }) => guard(ctx.log, () => findById(ctx, FEE_INVOICES, id))
        );

        server.registerTool(
            toolName('get', 'fee', 'invoice', 'pdf'),
            {
                title: 'Get a service charge invoice PDF',
                description:
                    'Fetch a Malt service charge invoice as a PDF. Malt returns it base64-encoded inside JSON; ' +
                    'this tool decodes it and attaches the file.',
                inputSchema: idArg,
                outputSchema: pdfResource,
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async ({ id }) => guard(ctx.log, () => findPdfById(ctx, FEE_INVOICES, id))
        );
    }
};
