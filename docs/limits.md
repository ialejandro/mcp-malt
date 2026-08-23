# Rate limits

Malt publishes none.

That is not an omission in this document. Malt's getting-started list tells you to understand "Rate Limiting Guidelines" and links to a section that does not exist anywhere in the published API documentation. There is no requests-per-second figure, no burst allowance, no per-key or per-account quota, and no documented 429 behaviour.

Live responses carry no rate limit signalling of any kind: no `X-RateLimit-*`, no RFC 9239 `RateLimit-*`, no `Retry-After`. Not one of the 13 operations declares a 429 response. So there is nothing to read and nothing to react to.

## What this server does instead

Since Malt gives no feedback to adapt to, the only option is to pace outbound calls and pick a number ourselves. `MALT_RATE_LIMIT_RPS` defaults to 5 requests per second, spaced evenly rather than burst-then-wait.

**That 5 is our choice, not Malt's.** It is a conservative guess at what an undocumented backend tolerates, nothing more. Tune it:

```bash
MALT_RATE_LIMIT_RPS=1     # cautious, for a long batch job
MALT_RATE_LIMIT_RPS=5     # default
MALT_RATE_LIMIT_RPS=20    # faster, if you have measured that Malt is fine with it
```

Setting it very high effectively turns pacing off. Nothing stops you, and nothing on Malt's side will tell you that you went too far until something starts failing.

If a 429 ever does appear, the client backs off, honours `Retry-After` if the response carries one, and gives up after three attempts. That path exists as insurance rather than because it has been seen.

## The limit that will actually bite you

Not the request rate. The response size.

The billing endpoints return a bare JSON array with no pagination, so `malt_find_invoices` over a multi-year range returns every invoice in one response. One HTTP call, no rate limit involved, and a very large amount of text heading for the context window.

`MALT_MAX_LIST_ITEMS` caps this at 200 by default. When a result is capped the tool says so and sets `truncated: true`, so a short answer never passes silently as a complete one.

Narrowing the date range is almost always better than raising the cap. Quarter by quarter costs four calls and keeps every answer complete and small.

Only SCIM paginates properly, through `startIndex` and `count`.
