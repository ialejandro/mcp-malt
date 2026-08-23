/**
 * The list of toolsets this server can offer.
 *
 * This is the single place a toolset is registered. Config validates
 * MALT_TOOLSETS against these names and the server iterates them, so adding a
 * toolset means writing a module and adding one line here.
 */

import type { Toolset } from './shared.js';
import { invoicesToolset } from './invoices.js';
import { paymentsToolset } from './payments.js';
import { feeInvoicesToolset } from './feeInvoices.js';
import { scimToolset } from './scim.js';

export const TOOLSETS: readonly Toolset[] = [
    invoicesToolset,
    paymentsToolset,
    feeInvoicesToolset,
    scimToolset
];

export const TOOLSET_NAMES: readonly string[] = TOOLSETS.map(t => t.name);

export function describeToolsets(): string {
    return TOOLSETS.map(t => `  ${t.name} — ${t.summary}`).join('\n');
}
