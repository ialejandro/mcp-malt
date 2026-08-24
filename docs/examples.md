# Examples

Worked examples of the server in use: what you type, which tools the model reaches for, and what comes back. Every response below is the real shape the tools return, not a sketch.

## How a request actually flows

Your MCP client (Claude Desktop, Claude Code, Cursor) starts the server as a child process and talks JSON-RPC over stdin and stdout. You never call a tool by name yourself. You describe what you want, the model picks tools from the ones the server registered at startup, and the server turns each call into an HTTP request to `https://api.malt.com` with your token attached.

Which tools exist is fixed when the process starts, by `MALT_TOOLSETS`:

```
MALT_TOOLSETS=invoices                    ->  3 tools
MALT_TOOLSETS=invoices,payments           ->  4 tools
MALT_TOOLSETS=all                         ->  9 tools, reads only
MALT_TOOLSETS=all + MALT_ALLOW_WRITES=true -> 13 tools
```

Change either variable and restart the client. There is no way to enable a toolset mid-session, which is the point: a model cannot reach for a tool that was never registered.

---

## Reading invoices

**Config**

```jsonc
{ "env": { "MALT_API_TOKEN": "your-token-here", "MALT_TOOLSETS": "invoices" } }
```

**You ask**

> How much did I bill in February 2026?

**The model calls**

```json
{ "name": "malt_find_invoices", "arguments": { "since": "2026-02-01", "until": "2026-02-28" } }
```

You can write plain dates. Malt's API rejects them with a 400, so the server widens `since` to `2026-02-01T00:00:00.000Z` and `until` to `2026-02-28T23:59:59.999Z` before the request goes out. Widening `until` to the end of the day is what stops February's last day of invoices from vanishing.

**The server returns**

```json
{
  "content": [{ "type": "text", "text": "Found 3 invoices." }],
  "structuredContent": {
    "count": 3,
    "truncated": false,
    "items": [
      {
        "id": "INV-123456",
        "title": "Web Development Services - February 2026",
        "creationDate": "2026-02-01T10:00:00Z",
        "amountWithoutTaxes": 1000,
        "amountAllTaxesIncluded": 1200,
        "taxes": [{ "name": "VAT", "rate": 20, "amount": 200 }],
        "customer": { "name": "Acme Corporation", "countryCode": "FR" }
      }
    ]
  }
}
```

**You get**

> You issued 3 invoices in February 2026, totalling 3,400 EUR before tax and 4,080 EUR with VAT. The largest was INV-123456 to Acme Corporation.

### When the list is cut short

Malt does not paginate the billing endpoints. Ask for three years and you get three years in one array. The server caps the list at `MALT_MAX_LIST_ITEMS` and says so:

```json
{
  "content": [{ "type": "text", "text": "Showing the first 200 invoices; the API returned more. Narrow the date range, or raise MALT_MAX_LIST_ITEMS." }],
  "structuredContent": { "count": 200, "truncated": true, "items": [] }
}
```

`truncated: true` is there so the model knows any total it computes is wrong. Ask quarter by quarter instead, or raise the cap.

---

## Getting a PDF

**You ask**

> Get me the PDF for invoice INV-123456.

**The model calls**

```json
{ "name": "malt_get_invoice_pdf", "arguments": { "id": "INV-123456" } }
```

Malt sends PDFs base64-encoded inside a JSON body, not as a binary response. The server decodes it and attaches a real file, so the base64 never reaches the conversation:

```json
{
  "content": [
    { "type": "text", "text": "Invoice INV-123456 as PDF (48213 bytes)." },
    { "type": "resource", "resource": { "uri": "malt://document/INV-123456.pdf", "mimeType": "application/pdf", "blob": "..." } }
  ],
  "structuredContent": { "id": "INV-123456", "bytes": 48213 }
}
```

If you ask for "the Malt invoice for February" you may mean either family: the one you issued to a client, or the commission invoice Malt issued to you. The `malt_get_invoice_document` prompt tells the model to ask rather than guess.

---

## Reconciling a quarter

This is the case the API is actually good at, and the one worth using a prompt for.

**Config**

```jsonc
{ "env": { "MALT_API_TOKEN": "your-token-here", "MALT_TOOLSETS": "invoices,payments,fee-invoices" } }
```

Run the `malt_reconcile_revenue` prompt (in Claude Desktop and Claude Code, prompts appear as slash commands) with `since=2026-01-01` and `until=2026-03-31`, or just ask:

> Reconcile my Malt revenue for Q1 2026.

**Three calls, in order**

```json
{ "name": "malt_find_invoices",     "arguments": { "since": "2026-01-01", "until": "2026-03-31" } }
{ "name": "malt_find_fee_invoices", "arguments": { "since": "2026-01-01", "until": "2026-03-31" } }
{ "name": "malt_find_payments",     "arguments": { "since": "2026-01-01", "until": "2026-03-31" } }
```

Payments are what make this work. Each one names the invoices it settles:

```json
{
  "id": "PAY-123456",
  "date": "2026-04-01T10:00:00Z",
  "amount": 1200,
  "currency": "EUR",
  "wireRef": "WIRE-REF-789",
  "invoices": [{ "id": "INV-123456", "externalId": "EXT-789", "type": "INVOICE" }]
}
```

So the model can match cash to invoices instead of guessing from amounts and dates.

**You get**

> Q1 2026: 12,400 EUR billed before tax, 2,480 EUR VAT, 14,880 EUR gross. Malt charged 1,240 EUR in commission. 13,680 EUR landed in your account.
>
> INV-123461 (1,200 EUR, issued 2026-03-28) has no matching payment yet.

Two traps the prompt already covers. Fee invoices run in the opposite direction, so they are subtracted rather than added. And a payment dated April can settle a March invoice, so cash received in a window will rarely equal what was billed in it.

---

## Provisioning a user

SCIM needs an organization token, which comes through your Malt representative. A freelancer token gets a 401 or 403 here.

**Config**

```jsonc
{ "env": { "MALT_API_TOKEN": "your-org-token", "MALT_TOOLSETS": "scim", "MALT_ALLOW_WRITES": "true" } }
```

Without `MALT_ALLOW_WRITES` you get `malt_find_users` and `malt_get_user` and nothing else. Reading your user directory and being able to delete from it are different levels of trust.

**You ask**

> Onboard jane.doe@acme.com to our Malt organization.

**Search first, always**

```json
{ "name": "malt_find_users", "arguments": { "filter": "userName eq \"jane.doe@acme.com\"" } }
```

```json
{ "content": [{ "type": "text", "text": "Matched 0 user(s)." }],
  "structuredContent": { "totalResults": 0, "startIndex": 1, "Resources": [] } }
```

`malt_create_user` has no idempotency key. A create that times out may have worked anyway, and running it again gives you two Janes. The server never retries a POST for this reason, and the `malt_user_lifecycle` prompt makes the search step mandatory.

The filter grammar is `eq` only. No `co`, no `sw`, no `and`. Anything else comes back as a 400 with `scimType: invalidFilter`.

**Then create**

```json
{
  "name": "malt_create_user",
  "arguments": {
    "userName": "jane.doe@acme.com",
    "name": { "givenName": "Jane", "familyName": "Doe" },
    "externalId": "12345678"
  }
}
```

---

## Offboarding

**You ask**

> Offboard jane.doe@acme.com.

The model finds her id, then calls:

```json
{ "name": "malt_deactivate_user", "arguments": { "userId": "2819c223-7f76-453a-919d-413861904646" } }
```

Not `malt_delete_user`. Malt answers a delete with a 403 once the user has any activity on the platform, which is nearly everyone who has actually worked. When that happens the server says what to do instead:

> Malt refused the delete (403). This usually means the user still has activity on the platform that must be completed first. Deactivating with malt_deactivate_user is the supported way to offboard someone.

There is no reactivate operation. Deactivation is one-way through this API.

---

## Editing a user without wiping them

`malt_replace_user` is a PUT. Anything you leave out is cleared, so a one-field edit still means sending the whole record:

```json
{ "name": "malt_get_user", "arguments": { "userId": "2819c223-..." } }
```

```json
{
  "name": "malt_replace_user",
  "arguments": {
    "userId": "2819c223-...",
    "userName": "jane.doe@acme.com",
    "name": { "givenName": "Jane", "familyName": "Smith" },
    "externalId": "12345678"
  }
}
```

Drop `externalId` from that call and Jane loses it.

---

## Checking the server starts

Before wiring it into a client, run it by hand. It should sit there waiting for JSON-RPC on stdin:

```bash
MALT_API_TOKEN=your-token-here MALT_TOOLSETS=invoices npx -y @ialejandro/mcp-malt@1.1.0
```

Logs go to stderr, which is the only place they can go: stdout carries the protocol. `MALT_LOG_LEVEL=debug` shows each outbound request.

A server that starts and offers no tools is not broken. It means `MALT_TOOLSETS` is empty.
