# Getting a token

## The four steps

1. **Create an identity.** If you do not already have a Malt account, sign up at [malt.com/signup](https://www.malt.com/signup).
2. **Open the access token page.** It lives under [My Account, then API Keys](https://www.malt.com/account/tokens).
3. **Create a token with the scopes you need.** Match them to the toolsets you plan to enable. Granting more than you will use costs you nothing today and costs you a lot the day the token leaks.
4. **Copy it immediately.** The token is displayed once, at creation, and is never retrievable afterwards. Lose it and your only option is to create a new one and revoke the old.

## Which token type you need

| You want | Token type | How to get it |
| --- | --- | --- |
| Invoices, payments, service charges | Freelancer account | Self served, on the page above |
| SCIM user provisioning | Organization | Through your Malt representative |
| Client team access | Client team | Through your Malt representative |

Only freelancer tokens are self served. If you need SCIM, the token request goes through Malt, so start that conversation before planning around it.

The mismatch to watch for: a freelancer token against a SCIM endpoint returns 403, not 401. The token is perfectly valid, it just does not open that door. Same in reverse.

## Using it

```bash
export MALT_API_TOKEN='your-token-here'
export MALT_TOOLSETS='invoices'
npx -y @ialejandro/mcp-malt@1.1.0
```

Check it works before wiring it into a client:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: $MALT_API_TOKEN" \
  "https://api.malt.com/freelancer/invoices?since=2026-01-01T00:00:00Z"
```

`200` and you are done. `401` means the token is wrong or is being sent with a `Bearer` prefix, which Malt does not want. `403` means it is the wrong type of token for that endpoint.

## Keeping it safe

Put the token in the environment, not on a command line, where it ends up in shell history and in the process list for anyone on the machine.

If your MCP client config holds the token inline, that file now carries a credential. Keep it out of version control and give it the permissions you would give a private key.

Rotate on whatever schedule you are comfortable with, and immediately if a file containing the token ever reaches a repository, a screenshot, or a chat window.

This server never prints the token. Logging goes to stderr and every line is scanned and has the token replaced with `***` first. That protects the logs, not you: pasting a token into a conversation is still pasting a token into a conversation.
