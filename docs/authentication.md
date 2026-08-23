# Authentication

Malt authenticates with a single API token sent on every request. That is the whole model.

## Why there is no OAuth 2.0

Malt's OpenAPI document declares two security schemes:

- `ApiKeyAuth`, an opaque token in the `Authorization` header. Every SCIM operation names it explicitly, and it is what the documentation's own examples use.
- `BearerAuth`, described as a JWT. No operation references it, and nothing in the docs explains how to obtain one.

There is no authorization endpoint, no token endpoint, and no discovery document. Both `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` return 404. Nothing on Malt's side implements an OAuth flow, so there is no flow for this server to take part in.

If Malt ships an authorization server later, the change here is small: the token would be acquired rather than configured, and `MALT_AUTH_SCHEME=bearer` already sends the header in the right shape.

## The header detail that catches people

Malt wants the bare token:

```http
GET /freelancer/invoices?since=2026-01-01T00:00:00Z HTTP/1.1
Host: api.malt.com
Authorization: your-token-here
```

Not this:

```http
Authorization: Bearer your-token-here
```

That is unusual enough that most HTTP clients get it wrong by default, and Malt's answer is a 401 with an empty body, which tells you nothing about why. This server sends the bare token unless you set `MALT_AUTH_SCHEME=bearer`.

```bash
curl -H "Authorization: your-token-here" \
     "https://api.malt.com/freelancer/invoices?since=2026-01-01T00:00:00Z"
```

## Token types and what they reach

| Token | How to get it | Toolsets it serves |
| --- | --- | --- |
| Freelancer account | Self served at [My Account, API Keys](https://www.malt.com/account/tokens) | `invoices`, `payments`, `fee-invoices` |
| Client team | Through your Malt representative | Depends on granted scopes |
| Organization | Through your Malt representative | `scim` |

A freelancer token will not open the SCIM endpoints, and an organization token is not what you want for billing. If a tool returns 403 while the token is otherwise valid, this mismatch is usually why.

## Handling the token

The token is shown once, when you create it. There is no way to read it back, so if you lose it you create a new one and revoke the old.

Pass it through the environment, never on a command line, where it lands in shell history and in the process list. If your client config file holds the token, treat that file the way you would treat a private key.

This server never writes the token to its output. Logging goes to stderr, and every line is scanned for the token and has it replaced with `***` before printing. The one thing it cannot protect you from is pasting the token into a chat.

Rotate on a schedule you are comfortable with, and immediately if a config file with the token in it ever reaches a repository.

## Verifying a token works

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: your-token-here" \
  "https://api.malt.com/freelancer/invoices?since=2026-01-01T00:00:00Z"
```

`200` means you are set. `401` means the token is wrong, expired, revoked, or being sent with a `Bearer` prefix it does not want. `403` means the token is real but lacks the scope for this endpoint, which usually means it is the wrong type of token.
