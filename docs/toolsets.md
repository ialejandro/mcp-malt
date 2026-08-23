# Toolsets

Nothing is enabled by default. `MALT_TOOLSETS` starts empty, the server offers no tools, and you add what you need.

This is not caution for its own sake. Every tool you expose is text in the model's context on every single turn, and a tool the model can see is a tool it can decide to call. Thirteen tools for a question about last quarter's invoices is eight tools of noise and four tools of risk.

## Turning things on

```bash
MALT_TOOLSETS=invoices                          # 3 tools
MALT_TOOLSETS=invoices,payments,fee-invoices    # 7 tools
MALT_TOOLSETS=all                               # 9 tools, reads only
MALT_TOOLSETS=all MALT_ALLOW_WRITES=true        # all 13
```

Names are comma separated, case insensitive, and spacing does not matter. A name that is not a real toolset stops the server with an error rather than being quietly dropped, because a typo that silently costs you three tools is a bad afternoon.

## What each one gives you

### invoices, 3 tools

`malt_find_invoices`, `malt_get_invoice`, `malt_get_invoice_pdf`. What you billed clients. Needs a freelancer account token, which you can create yourself.

### payments, 1 tool

`malt_find_payments`. Cash received, each payment carrying the invoices it settles. Read-only, because Malt exposes no way to move money through this API. Pair it with `invoices` or it cannot tell you much.

### fee-invoices, 3 tools

`malt_find_fee_invoices`, `malt_get_fee_invoice`, `malt_get_fee_invoice_pdf`. Malt's commission invoices to you. Money in the opposite direction from `invoices`.

### scim, 2 or 6 tools

`malt_find_users` and `malt_get_user` come with the toolset. `malt_create_user`, `malt_replace_user`, `malt_deactivate_user`, and `malt_delete_user` also need `MALT_ALLOW_WRITES=true`.

Needs an organization token, which only a Malt representative can issue. A freelancer token will return 403 here.

## Why writes have their own switch

Reading your user directory and being able to delete from it are different levels of trust, and plenty of useful work needs only the first. Auditing who has access, checking whether someone is provisioned, exporting a user list: all reads.

So `scim` on its own is safe to leave enabled. `MALT_ALLOW_WRITES=true` is the deliberate second step, and the four tools it exposes are annotated so clients can prompt before running them: `malt_delete_user`, `malt_replace_user`, and `malt_deactivate_user` are marked destructive, and `malt_create_user` is marked non-idempotent because it genuinely is.

## Prompts follow the toolsets

Three workflow prompts register themselves when their dependencies are on:

| Prompt | Needs |
| --- | --- |
| `malt_reconcile_revenue` | `invoices` and `payments` and `fee-invoices` |
| `malt_get_invoice_document` | `invoices` or `fee-invoices` |
| `malt_user_lifecycle` | `scim` |

Reconciliation asks for all three billing toolsets because a reconciliation missing one of the three is wrong rather than partial, and quietly producing a wrong total is worse than not offering the prompt.

## Suggested setups

**Freelancer doing their own books.** `invoices,payments,fee-invoices`, no writes. Seven read-only tools and the reconciliation prompt. This is the common case.

**Just fetching invoice PDFs.** `invoices`. Three tools.

**IT running user provisioning.** `scim` with `MALT_ALLOW_WRITES=true`, and an organization token. Leave the billing toolsets off; they need a different token anyway.

**Trying it out.** Start with `invoices`, confirm the token works, then add more.
