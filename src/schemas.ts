/**
 * Zod schemas mirroring the Malt OpenAPI components.
 *
 * Input schemas are strict: catching a bad argument before it costs an HTTP
 * round trip is the whole point of having them.
 *
 * Output schemas are deliberately permissive: unknown fields pass, and every
 * field is optional and nullable. The SDK validates structuredContent against
 * them and turns a mismatch into a tool error, so anything stricter means a
 * perfectly good API response becomes a failed tool call.
 *
 * Nullable is not belt and braces. Malt really does send `null` for absent
 * optional fields rather than omitting them: externalId, customer.country,
 * supplier.registrationNumber and supplier.vatNumber all come back null on live
 * invoices, and `.optional()` alone rejects null. That combination broke every
 * malt_find_invoices call against the real API while the mocked tests passed.
 *
 * The schemas stay for their documentation value: they tell the model what
 * shape to expect. They are not there to police a payload we did not produce.
 */

import { z } from 'zod';

/** A response field: present, absent or explicitly null are all acceptable. */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullish();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Malt's date parameters are declared `format: date-time` and it means it: a
 * plain `2026-02-01` is answered with a 400. People and models both reach for
 * plain dates, so rather than rejecting them we widen them to the day they
 * obviously mean.
 *
 * `since` opens at the start of its day and `until` closes at the end of its,
 * so `since=2026-02-01, until=2026-02-28` covers February rather than stopping
 * at midnight on the 28th and quietly losing a day of invoices.
 */
function toDateTime(value: string, edge: 'start' | 'end'): string {
    if (!DATE_ONLY.test(value)) return value;
    return `${value}T${edge === 'end' ? '23:59:59.999' : '00:00:00.000'}Z`;
}

export const isoDateTime = z
    .string()
    .refine(v => !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 date or date-time, e.g. 2026-01-01T00:00:00Z');

export const dateRange = z.object({
    since: isoDateTime
        .transform(v => toDateTime(v, 'start'))
        .describe('Start of the range, inclusive. A date like 2026-02-01 or a full 2026-02-01T00:00:00Z.'),
    until: isoDateTime
        .transform(v => toDateTime(v, 'end'))
        .optional()
        .describe('End of the range, inclusive. A date like 2026-02-28 or a full date-time. Defaults to now.')
});

const party = z
    .object({
        name: maybe(z.string()),
        street: maybe(z.string()),
        city: maybe(z.string()),
        zip: maybe(z.string()),
        country: maybe(z.string()),
        countryCode: maybe(z.string()),
        registrationNumber: maybe(z.string()),
        vatNumber: maybe(z.string())
    })
    .loose();

const tax = z
    .object({ name: maybe(z.string()), amount: maybe(z.number()), rate: maybe(z.number()) })
    .loose();

const lightInvoice = z
    .object({ id: maybe(z.string()), externalId: maybe(z.string()), type: maybe(z.string()) })
    .loose();

export const invoiceResource = z
    .object({
        id: maybe(z.string()),
        title: maybe(z.string()),
        creationDate: maybe(z.string()),
        expectedPaymentDate: maybe(z.string()),
        externalId: maybe(z.string()),
        amountAllTaxesIncluded: maybe(z.number()),
        amountWithoutTaxes: maybe(z.number()),
        taxes: maybe(z.array(tax)),
        customer: maybe(party),
        supplier: maybe(party)
    })
    .loose();

export const feeInvoiceResource = z
    .object({
        id: maybe(z.string()),
        title: maybe(z.string()),
        amountAllTaxesIncluded: maybe(z.number()),
        amountWithoutTaxes: maybe(z.number()),
        taxes: maybe(z.array(tax)),
        customer: maybe(party),
        supplier: maybe(party)
    })
    .loose();

export const paymentResource = z
    .object({
        id: maybe(z.string()),
        date: maybe(z.string()),
        amount: maybe(z.number()),
        currency: maybe(z.string()),
        wireRef: maybe(z.string()),
        invoices: maybe(z.array(lightInvoice))
    })
    .loose();

/**
 * The freelancer endpoints return a bare JSON array with no paging, so a wide
 * date range is unbounded. Tools wrap results in this envelope: MCP structured
 * content must be an object anyway, and it gives truncation somewhere to live.
 */
export function listEnvelope<T extends z.ZodType>(item: T) {
    return z.object({
        items: z.array(item),
        count: z.number().int().describe('Number of items returned.'),
        truncated: z
            .boolean()
            .describe('True when the API returned more than MALT_MAX_LIST_ITEMS and the list was cut short.')
    });
}

export const pdfResource = z.object({
    id: z.string().describe('Identifier of the invoice the document belongs to.'),
    bytes: z.number().int().describe('Size of the decoded PDF in bytes.')
});

// --- SCIM ---

export const scimName = z
    .object({
        givenName: z.string().optional(),
        familyName: z.string().optional(),
        formatted: z.string().optional()
    })
    .loose();

/**
 * Written by hand. `createUser` and `replaceUser` declare their request body
 * with the wildcard media type and no concrete content type, so nothing can
 * bind a schema from the spec automatically. This follows the
 * SubmittedUserResource component instead.
 */
export const submittedUser = z.object({
    userName: z
        .string()
        .regex(/\S/, 'userName cannot be blank')
        .describe('Unique identifier for the user, typically their work email, e.g. jane.doe@acme.com.'),
    name: scimName.optional().describe('Given and family name.'),
    externalId: z.string().optional().describe('Your own identifier for this user.'),
    phoneNumbers: z
        .array(z.object({ value: z.string(), type: z.string().optional() }).loose())
        .max(3)
        .optional()
        .describe('Up to 3 phone numbers, formatted per RFC 3966.')
});

export const userResource = z.object({ id: maybe(z.string()) }).loose();

export const userPage = z
    .object({
        totalResults: maybe(z.number().int()),
        startIndex: maybe(z.number().int()),
        itemsPerPage: maybe(z.number().int()),
        Resources: maybe(z.array(z.looseObject({})))
    })
    .loose();

export type Invoice = z.infer<typeof invoiceResource>;
export type FeeInvoice = z.infer<typeof feeInvoiceResource>;
export type Payment = z.infer<typeof paymentResource>;
