# Errors

A failed API call comes back as a normal tool result with `isError` set, not as a protocol fault. The model sees what went wrong and can react, which is usually more useful than the call simply vanishing.

## Malt returns two different error shapes

Worth knowing, because they look nothing alike and only one of them is documented.

The freelancer and auth endpoints return a Spring-style body:

```json
{
  "timestamp": "1970-01-01T00:00:00.000+00:00",
  "status": 401,
  "error": "Unauthorized",
  "path": "/exposed/endpoint"
}
```

The SCIM endpoints follow RFC 7644:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": 400,
  "scimType": "invalidFilter",
  "detail": "Unsupported operator"
}
```

`scimType` is only ever `invalidFilter` or `invalidValue`. This server reads both shapes and folds whichever detail it finds into one message.

A live 401 often has no body at all, so a message with no detail attached is normal rather than a sign something else broke.

## What each status means

**400.** Usually a malformed date. `since` and `until` want ISO 8601, so `2026-01-01` or `2026-01-01T00:00:00Z`, not `last tuesday`. On SCIM, a 400 with `invalidFilter` means the filter used an operator other than `eq`, which is the only one Malt supports.

**401.** The token is missing, expired, revoked, or being sent with a `Bearer` prefix it does not want. Malt expects the bare token. See [authentication.md](authentication.md).

**403.** The token is real but not allowed here, which almost always means it is the wrong type: a freelancer token cannot reach SCIM, and an organization token is not for billing.

On `DELETE /scim/v2/Users/{userId}` a 403 usually means something else entirely: the user still has activity on the platform that has to be completed first. Deactivating is the supported way to offboard, and the error message says so.

**404.** No such invoice or user. The message echoes the identifier so you can see what was actually sent, which catches a surprising number of copy-paste errors.

**429.** Malt declares no rate limits and no 429 anywhere in its spec, so if you see one it is undocumented behaviour. The client retries with backoff, honours `Retry-After` if it appears, and gives up after three attempts. Lower `MALT_RATE_LIMIT_RPS` if it recurs.

**5xx.** Retried with backoff on GET, PUT and DELETE. Never on POST, for the reason below.

## Why a failed create is not retried

`createUser` has no idempotency key. When a POST times out or returns a 502, there is no way to tell whether the user was created before the failure. Retrying can leave you with two.

So this server retries GET, PUT and DELETE, and never POST. When a create fails, the fix is to call `malt_find_users` with a `userName` filter and see what actually happened before trying again. The `malt_user_lifecycle` prompt builds that check in.

## Truncated lists are not errors

The billing endpoints return a bare array with no pagination, so a wide date range can return thousands of records. Results are capped at `MALT_MAX_LIST_ITEMS`, and a capped result says so in its text and sets `truncated: true` in its structured output.

This is a successful call with an incomplete answer, which is the dangerous kind. Narrow the date range rather than raising the cap, or you will push a large amount of invoice data through the context window to get one number.

## Debugging

```bash
MALT_LOG_LEVEL=debug npx mcp-malt
```

Logs the method, path, status and duration of every request, and request and response bodies at `debug`. Everything goes to stderr, never stdout, which on a stdio server carries the JSON-RPC protocol and would be corrupted by anything else.

The token is stripped from every log line before it is printed.
