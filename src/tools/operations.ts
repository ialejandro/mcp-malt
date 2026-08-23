/**
 * The three shapes every Malt billing resource follows: search a date range,
 * fetch one by id, fetch one as a PDF.
 *
 * Invoices and service charge invoices are the same endpoints under different
 * paths, so the logic lives here once and each toolset supplies the nouns. A
 * third family, if Malt adds one, needs no new logic at all.
 */

import type { ToolContext, ToolOutcome } from './shared.js';

/** Malt returns PDFs base64-encoded inside a JSON body rather than as a binary response. */
interface PdfPayload {
    id: string;
    pdf: string;
}

export interface DateRange {
    since: string;
    until?: string;
}

/**
 * Cap an unpaged list before it reaches the context window.
 *
 * The billing endpoints return a bare array with no paging, so a multi-year
 * range can return thousands of records and there is no server-side way to
 * narrow it.
 */
export function capList<T>(items: T[], max: number): { items: T[]; count: number; truncated: boolean } {
    if (items.length <= max) return { items, count: items.length, truncated: false };
    return { items: items.slice(0, max), count: max, truncated: true };
}

function describeList(label: string, result: { count: number; truncated: boolean }): string {
    if (!result.truncated) return `Found ${result.count} ${label}.`;
    return (
        `Showing the first ${result.count} ${label}; the API returned more. ` +
        `Narrow the date range, or raise MALT_MAX_LIST_ITEMS.`
    );
}

/** A base64 PDF from Malt, returned as an MCP blob the client can save. */
function pdfBlock(base64: string, id: string) {
    return {
        type: 'resource' as const,
        resource: { uri: `malt://document/${id}.pdf`, mimeType: 'application/pdf', blob: base64 }
    };
}

export interface ResourceFamily {
    /** Path under the API root, e.g. `/freelancer/invoices`. */
    path: string;
    /** Plural noun for result messages, e.g. `invoices`. */
    label: string;
    /** Singular noun for single-resource messages, e.g. `Invoice`. */
    singular: string;
}

export async function findInDateRange(
    ctx: ToolContext,
    family: ResourceFamily,
    range: DateRange
): Promise<ToolOutcome> {
    const raw = await ctx.client.request<unknown[]>(family.path, { query: { ...range } });
    const result = capList(raw ?? [], ctx.config.maxListItems);
    return { text: describeList(family.label, result), structured: result as unknown as Record<string, unknown> };
}

export async function findById(ctx: ToolContext, family: ResourceFamily, id: string): Promise<ToolOutcome> {
    const resource = await ctx.client.request<Record<string, unknown>>(resourceUrl(family, id));
    return { text: `${family.singular} ${id}.`, structured: resource };
}

export async function findPdfById(ctx: ToolContext, family: ResourceFamily, id: string): Promise<ToolOutcome> {
    const document = await ctx.client.request<PdfPayload>(`${resourceUrl(family, id)}/pdf`);
    const bytes = Buffer.from(document.pdf, 'base64').length;
    return {
        text: `${family.singular} ${document.id} as PDF (${bytes} bytes).`,
        structured: { id: document.id, bytes },
        extra: [pdfBlock(document.pdf, document.id)]
    };
}

function resourceUrl(family: ResourceFamily, id: string): string {
    return `${family.path}/${encodeURIComponent(id)}`;
}
