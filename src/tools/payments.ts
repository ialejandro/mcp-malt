/**
 * Payments received. Read-only: Malt exposes no way to move money through
 * this API, only to see what has already landed.
 */

import { dateRange, listEnvelope, paymentResource } from '../schemas.js';
import { findInDateRange, type ResourceFamily } from './operations.js';
import { guard, toolName, type Toolset } from './shared.js';

const PAYMENTS: ResourceFamily = {
    path: '/freelancer/payments',
    label: 'payments',
    singular: 'Payment'
};

export const paymentsToolset: Toolset = {
    name: 'payments',
    summary: 'Payments received, each listing the invoices it settles.',

    register(server, ctx) {
        server.registerTool(
            toolName('find', 'payments'),
            {
                title: 'Find payments',
                description:
                    'List payments received within a date range. Each payment carries the invoices it settles, ' +
                    'which is what lets you reconcile cash received against invoices issued. "since" is required.',
                inputSchema: dateRange,
                outputSchema: listEnvelope(paymentResource),
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async range => guard(ctx.log, () => findInDateRange(ctx, PAYMENTS, range))
        );
    }
};
