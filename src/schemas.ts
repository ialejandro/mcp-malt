/**
 * Zod schemas mirroring the Malt OpenAPI components.
 *
 * Input schemas are strict: catching a bad argument before it costs an HTTP
 * round trip is the whole point of having them.
 *
 * Output schemas are deliberately permissive, both to unknown fields and to
 * missing ones. The SDK validates structuredContent against them and turns a
 * mismatch into a tool error, so a strict schema here would mean that the day
 * Malt omits a field its own spec marks required, every call fails even though
 * the data is fine. At spec version 0.0.1 that is a real risk and we gain
 * nothing by policing a payload we did not produce. The schemas stay for their
 * documentation value: they tell the model what shape to expect.
 */

import { z } from 'zod';

/** ISO 8601 date-time, which is what the `since` and `until` parameters want. */
export const isoDateTime = z
    .string()
    .refine(v => !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 date or date-time, e.g. 2026-01-01T00:00:00Z');

export const dateRange = z.object({
    since: isoDateTime.describe('Start of the search range, inclusive. ISO 8601, e.g. 2026-01-01T00:00:00Z.'),
    until: isoDateTime.optional().describe('End of the search range. ISO 8601. Defaults to now if omitted.')
});

const party = z
    .object({
        name: z.string(),
        street: z.string().optional(),
        city: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
        countryCode: z.string().optional(),
        registrationNumber: z.string().optional(),
        vatNumber: z.string().optional()
    })
    .partial()
    .loose();

const tax = z.object({ name: z.string(), amount: z.number(), rate: z.number() }).partial().loose();

export const invoiceResource = z
    .object({
        id: z.string(),
        title: z.string(),
        creationDate: z.string(),
        expectedPaymentDate: z.string(),
        externalId: z.string().optional(),
        amountAllTaxesIncluded: z.number(),
        amountWithoutTaxes: z.number(),
        taxes: z.array(tax),
        customer: party,
        supplier: party
    })
    .partial()
    .loose();

export const feeInvoiceResource = z
    .object({
        id: z.string(),
        title: z.string(),
        amountAllTaxesIncluded: z.number(),
        amountWithoutTaxes: z.number(),
        taxes: z.array(tax),
        customer: party,
        supplier: party
    })
    .partial()
    .loose();

export const paymentResource = z
    .object({
        id: z.string(),
        date: z.string(),
        amount: z.number(),
        currency: z.string(),
        wireRef: z.string().optional(),
        invoices: z.array(z.object({ id: z.string(), externalId: z.string().optional(), type: z.string() }).partial().loose())
    })
    .partial()
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

export const userResource = z.object({ id: z.string() }).partial().loose();

export const userPage = z
    .object({
        totalResults: z.number().int().optional(),
        startIndex: z.number().int().optional(),
        itemsPerPage: z.number().int().optional(),
        Resources: z.array(z.looseObject({})).optional()
    })
    .loose();

export type Invoice = z.infer<typeof invoiceResource>;
export type FeeInvoice = z.infer<typeof feeInvoiceResource>;
export type Payment = z.infer<typeof paymentResource>;
