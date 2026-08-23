/**
 * Invoices a freelancer has issued through Malt: money coming in.
 */

import { z } from 'zod';
import { dateRange, invoiceResource, listEnvelope, pdfResource } from '../schemas.js';
import { findById, findInDateRange, findPdfById, type ResourceFamily } from './operations.js';
import { guard, toolName, type Toolset } from './shared.js';

const INVOICES: ResourceFamily = {
    path: '/freelancer/invoices',
    label: 'invoices',
    singular: 'Invoice'
};

const idArg = z.object({ id: z.string().describe('Invoice identifier, e.g. INV-123456.') });

export const invoicesToolset: Toolset = {
    name: 'invoices',
    summary: 'Invoices you issued to clients, including their PDFs.',

    register(server, ctx) {
        server.registerTool(
            toolName('find', 'invoices'),
            {
                title: 'Find invoices',
                description:
                    'List the invoices you issued through Malt within a date range. Returns money owed to you by ' +
                    'clients. "since" is required. The API does not paginate this endpoint, so prefer a range of ' +
                    'months rather than years.',
                inputSchema: dateRange,
                outputSchema: listEnvelope(invoiceResource),
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async range => guard(ctx.log, () => findInDateRange(ctx, INVOICES, range))
        );

        server.registerTool(
            toolName('get', 'invoice'),
            {
                title: 'Get an invoice',
                description:
                    'Fetch one invoice you issued, by its Malt identifier, including line taxes and the client.',
                inputSchema: idArg,
                outputSchema: invoiceResource,
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async ({ id }) => guard(ctx.log, () => findById(ctx, INVOICES, id))
        );

        server.registerTool(
            toolName('get', 'invoice', 'pdf'),
            {
                title: 'Get an invoice PDF',
                description:
                    'Fetch an invoice as a PDF document. Malt returns the PDF base64-encoded inside a JSON body; ' +
                    'this tool decodes it and attaches the file.',
                inputSchema: idArg,
                outputSchema: pdfResource,
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async ({ id }) => guard(ctx.log, () => findPdfById(ctx, INVOICES, id))
        );
    }
};
