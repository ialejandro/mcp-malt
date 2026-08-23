# Endpoints

All 13 operations Malt publishes, with the tool that wraps each one. Examples use the values from Malt's own OpenAPI document, so the shapes match what you will actually get back.

Base URL is `https://api.malt.com`. Every request carries `Authorization: your-token-here`, bare, with no `Bearer` prefix.

---

## Invoices

Money your clients owe you. Toolset: `invoices`.

### malt_find_invoices

`GET /freelancer/invoices`

| Parameter | Required | Notes |
| --- | --- | --- |
| `since` | yes | ISO 8601. Start of the range, inclusive |
| `until` | no | ISO 8601. Defaults to now |

This endpoint does not paginate and returns a bare array, so a multi-year range can return thousands of records. Results are capped at `MALT_MAX_LIST_ITEMS` (200 by default) and the tool tells you when it truncated.

```bash
curl -H "Authorization: your-token-here" \
  "https://api.malt.com/freelancer/invoices?since=2023-03-01T00:00:00Z&until=2023-03-31T23:59:59Z"
```

```json
[
  {
    "id": "INV-123456",
    "title": "Web Development Services - March 2023",
    "creationDate": "2023-03-01T10:00:00Z",
    "expectedPaymentDate": "2023-03-31T23:59:59Z",
    "externalId": "EXT-789",
    "amountWithoutTaxes": 1000,
    "amountAllTaxesIncluded": 1200,
    "taxes": [{ "name": "VAT", "rate": 20, "amount": 200 }],
    "customer": { "name": "Acme Corporation", "city": "Paris", "countryCode": "FR", "vatNumber": "FR12345678901" },
    "supplier": { "name": "John Doe Consulting", "city": "Lyon", "countryCode": "FR" }
  }
]
```

The tool wraps this as `{ items, count, truncated }`, because MCP structured output must be an object and the truncation flag needs somewhere to live.

### malt_get_invoice

`GET /freelancer/invoices/{id}`

Takes `id`, returns one invoice in the shape above.

### malt_get_invoice_pdf

`GET /freelancer/invoices/{id}/pdf`

Despite the name, this returns JSON, not a binary body:

```json
{ "id": "INV-123456", "pdf": "SlZCRVJpMHhMalFLSmRQci4uLg==" }
```

The `pdf` field is base64. The tool decodes it and hands back a real PDF attachment, so you do not have to think about the encoding.

---

## Payments

Money that actually arrived. Toolset: `payments`.

### malt_find_payments

`GET /freelancer/payments`

Same `since` and `until` as the invoice search, same lack of pagination.

```json
[
  {
    "id": "PAY-123456",
    "date": "2023-04-01T10:00:00Z",
    "amount": 1200,
    "currency": "EUR",
    "wireRef": "WIRE-REF-789",
    "invoices": [{ "id": "INV-123456", "externalId": "EXT-789", "type": "INVOICE" }]
  }
]
```

The `invoices` array is what makes reconciliation possible: each payment names what it settles. `type` is either `INVOICE` or `SERVICE_FEES`.

This is read-only. Malt exposes no way to initiate or modify a payment.

---

## Fee invoices

Malt's commission, billed to you. Toolset: `fee-invoices`.

Same three operations as client invoices, at `/freelancer/fee-invoices`:
`malt_find_fee_invoices`, `malt_get_fee_invoice`, `malt_get_fee_invoice_pdf`. The PDF is
base64 in JSON here too.

```json
{
  "id": "FEE-123456",
  "title": "Service Charges - March 2023",
  "amountWithoutTaxes": 200,
  "amountAllTaxesIncluded": 240,
  "taxes": [{ "name": "VAT", "rate": 20, "amount": 40 }]
}
```

Money flows the opposite way from the `invoices` family. Do not add the two together when reconciling.

---

## SCIM users

User provisioning for an organization account, following SCIM 2.0. Toolset: `scim`. Needs an organization token, which comes through your Malt representative.

Reads come with the toolset. The four writes also need `MALT_ALLOW_WRITES=true`.

### malt_find_users

`GET /scim/v2/Users`

| Parameter | Required | Notes |
| --- | --- | --- |
| `filter` | no | SCIM filter. Only the `eq` operator works |
| `startIndex` | no | 1-based, not 0-based |
| `count` | no | Results per page |

```bash
curl -H "Authorization: your-token-here" \
  --get --data-urlencode 'filter=userName eq "jane.doe@acme.com"' \
  https://api.malt.com/scim/v2/Users
```

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 10,
  "Resources": [{ "id": "2819c223-7f76-453a-919d-413861904646", "userName": "jane.doe@acme.com", "active": true }]
}
```

Anything other than `eq` comes back as a 400 with `scimType: invalidFilter`. There is no `co`, no `sw`, no `and`.

### malt_get_user

`GET /scim/v2/Users/{userId}`

### malt_create_user

`POST /scim/v2/Users`

```json
{
  "userName": "jane.doe@acme.com",
  "name": { "givenName": "Jane", "familyName": "Doe" },
  "externalId": "12345678",
  "phoneNumbers": [{ "value": "tel:+33-1-23-45-67-89", "type": "work" }]
}
```

`userName` is required and cannot be blank. `phoneNumbers` takes at most 3 entries. Both are checked before the request goes out.

**This operation has no idempotency key.** If a create times out, you cannot tell whether it worked. Repeating it blindly gives you two users. Call `malt_find_users` with a `userName` filter first and only create when nothing comes back; this server never retries a POST automatically, for the same reason. The `malt_user_lifecycle` prompt encodes the rule.

### malt_replace_user

`PUT /scim/v2/Users/{userId}`

Wholesale replacement. Anything you leave out is cleared, so read the user first and send the full record back with your edits applied.

### malt_deactivate_user

`PATCH /scim/v2/Users/{userId}`

Named for what it does. Malt's PATCH accepts only setting `active` to false, so the tool takes just a `userId` and builds the body itself:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [{ "op": "replace", "value": { "active": false } }]
}
```

Returns 204. There is no matching reactivate operation.

### malt_delete_user

`DELETE /scim/v2/Users/{userId}`

Returns 204 on success and **403 when the user still has activity on the platform**, which is the common case for anyone who has actually worked. Deactivation is the supported way to offboard. Reach for delete only when an account was created in error.
