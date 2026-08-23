# mcp-malt

An MCP server for the [Malt API](https://api.malt.com). It covers all 13 operations Malt publishes: the invoices you issue, the commission Malt bills you, the payments you receive, and SCIM user provisioning for organization accounts.

## What this does and does not cover

Malt's API is smaller than most people expect. It covers back office billing and enterprise user provisioning, and nothing else:

| Toolset | Tools | What it reaches |
|---|---|---|
| `invoices` | 3 | Invoices you issued to clients, including the PDF |
| `payments` | 1 | Payments received, with the invoices each one settles |
| `fee-invoices` | 3 | Malt's commission invoices to you, including the PDF |
| `scim` | 2 read, 4 write | SCIM 2.0 user provisioning for an organization account |

There is no talent search, no profiles, no missions, no offers, and no messaging. Those are what Malt is known for, and none of them are in the public API. If that is what you came for, this server cannot give it to you, and neither can anything else built on the documented API.

Two community MCP servers for Malt do reach that data, by driving the web app with browser automation and scraping the DOM. Their own documentation warns that automating profile edits may breach Malt's terms of service. This server only calls the documented API.

## Getting a token

1. Create an identity on the [signup page](https://www.malt.com/signup) if you do not have one.
2. Open [My Account, then API Keys](https://www.malt.com/account/tokens).
3. Create an access token with the permission scopes you need. Match them to the toolsets you plan to enable.
4. Copy the token straight away. It is shown once, at creation, and never again.

Freelancer account tokens are self served. Client team and organization tokens, which the `scim` toolset needs, come through your Malt representative.

There is no OAuth 2.0 here. Malt publishes no authorization server and no token endpoint, so the API token above is the only way in. [docs/authentication.md](docs/authentication.md) explains this in more detail, including the header detail that trips most people up.

## Install

### npx

```jsonc
// Claude Desktop: claude_desktop_config.json
// Cursor: .cursor/mcp.json
{
  "mcpServers": {
    "malt": {
      "command": "npx",
      "args": ["-y", "mcp-malt"],
      "env": {
        "MALT_API_TOKEN": "your-token-here",
        "MALT_TOOLSETS": "invoices,payments,fee-invoices"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add malt \
  --env MALT_API_TOKEN=your-token-here \
  --env MALT_TOOLSETS=invoices,payments,fee-invoices \
  -- npx -y mcp-malt
```

### Docker

The server speaks JSON-RPC over stdin and stdout, so `-i` is required and `-t` must be left off.

```bash
docker run -i --rm \
  -e MALT_API_TOKEN=your-token-here \
  -e MALT_TOOLSETS=invoices \
  ghcr.io/ialejandro/mcp-malt
```

```jsonc
{
  "mcpServers": {
    "malt": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MALT_API_TOKEN",
        "-e", "MALT_TOOLSETS",
        "ghcr.io/ialejandro/mcp-malt"
      ],
      "env": {
        "MALT_API_TOKEN": "your-token-here",
        "MALT_TOOLSETS": "invoices,payments,fee-invoices"
      }
    }
  }
}
```

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `MALT_API_TOKEN` | required | Your token from My Account, API Keys |
| `MALT_TOOLSETS` | empty | Comma list of `invoices`, `payments`, `fee-invoices`, `scim`, or `all` |
| `MALT_ALLOW_WRITES` | `false` | Exposes the four SCIM write tools. `scim` alone gives you reads only |
| `MALT_MAX_LIST_ITEMS` | `200` | Caps list results, since Malt does not paginate the billing endpoints |
| `MALT_RATE_LIMIT_RPS` | `5` | Outbound pacing. Our number, not Malt's, which publishes none |
| `MALT_TIMEOUT_MS` | `30000` | Per request timeout |
| `MALT_API_BASE_URL` | `https://api.malt.com` | Override, mostly for testing |
| `MALT_AUTH_SCHEME` | `raw` | `raw` or `bearer`. Leave it alone unless Malt changes |
| `MALT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. All logging goes to stderr |

With no `MALT_TOOLSETS` the server starts and offers nothing. That is deliberate, not a failure: you decide what a model gets to see. Add toolsets one at a time.

An unknown toolset name stops the server with an error rather than being ignored, because a typo that silently costs you three tools is miserable to debug.

## Common tasks

**Reconcile a quarter.** Enable `invoices,payments,fee-invoices` and run the `malt_reconcile_revenue` prompt. It pulls all three lists, matches payments to the invoices they settle, and reports gross billed, tax, Malt's commission, and cash received.

> Reconcile my Malt revenue for Q1 2026.

**Get an invoice PDF.** Malt returns PDFs base64-encoded inside a JSON body. The tools decode them and hand back a real PDF attachment.

> Download the PDF for invoice INV-123456.

**Offboard someone.** Enable `scim` with `MALT_ALLOW_WRITES=true` and use `malt_user_lifecycle`. It deactivates rather than deletes, which is the path Malt actually supports.

> Offboard jane.doe@acme.com from our Malt organization.

## Documentation

- [Getting and managing a token](docs/token.md)
- [Authentication, and why there is no OAuth](docs/authentication.md)
- [Toolsets: what to enable and when](docs/toolsets.md)
- [Every endpoint, with requests and responses](docs/endpoints.md)
- [Errors and what they mean](docs/errors.md)
- [Rate limits](docs/limits.md)
- [Extending the server](docs/extending.md)

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check-spec   # diff the live Malt spec against spec/malt-openapi.json
```

Tests mock `fetch` and never call the live API.

`spec/malt-openapi.json` is a committed snapshot of Malt's published document. A daily workflow diffs the live spec against it and opens a PR when anything moves. Malt has kept `info.version` at `0.0.1` throughout, so the check compares operations rather than trusting the version number.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Adding an endpoint or a toolset is described in
[docs/extending.md](docs/extending.md).

## License

MIT
