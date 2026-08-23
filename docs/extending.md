# Extending the server

Malt's API is small today and will not stay that way. This is how to add to it.

## The shape of the code

```
src/client.ts             one HTTP call: auth, pacing, retries, error messages
src/schemas.ts            zod types for inputs and responses
src/tools/operations.ts   the reusable endpoint operations
src/tools/registry.ts     the list of toolsets, and the only place they are listed
src/tools/<name>.ts       one toolset: what it is called and which tools it registers
src/prompts.ts            workflow prompts, gated on the toolsets they need
```

Two rules hold the design together. A toolset describes itself, so nothing outside its module
needs to know it exists beyond the one line in the registry. And a tool never talks to
`fetch`; it goes through `ctx.client.request`, which is where auth, pacing, retries and error
translation already live.

## Adding an endpoint to an existing toolset

If the endpoint is a search over a date range, a fetch by id, or a PDF, the logic already
exists in `operations.ts`. Declare the resource once and register the tools:

```ts
const CREDIT_NOTES: ResourceFamily = {
    path: '/freelancer/credit-notes',
    label: 'credit notes',
    singular: 'Credit note'
};

server.registerTool(
    toolName('find', 'credit', 'notes'),
    {
        title: 'Find credit notes',
        description: 'List credit notes within a date range. "since" is required.',
        inputSchema: dateRange,
        outputSchema: listEnvelope(creditNoteResource),
        annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async range => guard(ctx.log, () => findInDateRange(ctx, CREDIT_NOTES, range))
);
```

That gets you date validation, the unpaged-list cap, the truncation message, and error
handling, because all of it lives in `findInDateRange` and `guard`.

For anything that is not one of those three shapes, write the body inline and keep it wrapped
in `guard`:

```ts
async ({ id }) =>
    guard(ctx.log, async () => {
        const result = await ctx.client.request<Record<string, unknown>>(`/some/path/${encodeURIComponent(id)}`);
        return { text: `Did the thing to ${id}.`, structured: result };
    })
```

If the same body appears a third time, move it into `operations.ts`. Twice is a coincidence;
three times is duplication.

## Adding a toolset

One new file and one line in the registry. Nothing in `config.ts` or `index.ts` changes.

```ts
// src/tools/projects.ts
import { guard, toolName, type Toolset } from './shared.js';

export const projectsToolset: Toolset = {
    name: 'projects',
    summary: 'Projects and missions.',

    register(server, ctx) {
        server.registerTool(toolName('find', 'projects'), { /* ... */ }, async args =>
            guard(ctx.log, async () => ({ text: '...' }))
        );
    }
};
```

```ts
// src/tools/registry.ts
import { projectsToolset } from './projects.js';

export const TOOLSETS: readonly Toolset[] = [
    invoicesToolset,
    paymentsToolset,
    feeInvoicesToolset,
    scimToolset,
    projectsToolset
];
```

`MALT_TOOLSETS=projects` now works, `all` includes it, an unknown-name error lists it, and the
empty-config startup message describes it. `test/registry.test.ts` checks all of that and will
fail if a step is missed.

Gate anything destructive behind `ctx.config.allowWrites`, the way `scim.ts` does, and return
early so the write tools are never registered rather than registered and refused.

## Endpoint-specific error messages

The client does not recognise individual endpoints, and should not start. When a status means
something particular to one operation, the caller supplies the wording:

```ts
const DELETE_HINTS = {
    403: 'Malt refused the delete (403). The user still has activity that must be completed first.'
} as const;

await ctx.client.request<void>(userUrl(userId), { method: 'DELETE', errorHints: DELETE_HINTS });
```

Hints override the defaults in `STATUS_EXPLANATIONS` for that one call. Malt's own detail
string is still appended, so you keep whatever the API said.

## Schemas

Input schemas are strict. Rejecting a bad argument locally is free; discovering it through a
400 costs a round trip and gives a worse message.

Response schemas are permissive, `.partial().loose()`. The SDK validates `structuredContent`
against `outputSchema` and turns a mismatch into a tool error, so a schema that demands every
field the spec marks required will break the day Malt omits one. They are there to tell the
model what shape to expect, not to police a payload we did not produce.

List tools return `listEnvelope(...)` rather than a bare array, because MCP structured content
must be an object and the truncation flag needs somewhere to live.

## When Malt changes the API

`npm run check-spec` diffs the live document against `spec/malt-openapi.json` and reports
added, removed and changed operations. A daily workflow runs it and opens a PR. Malt has kept
`info.version` at `0.0.1` throughout, so operations are compared rather than the version
number trusted.

When it reports something new:

1. Decide which toolset it belongs to, or whether it needs its own.
2. Check whether `operations.ts` already covers the shape.
3. Add the tool, and a test that its input schema rejects what Malt rejects.
4. Commit the updated snapshot with the change, so the next run is clean.

## Checks before opening a PR

```bash
npm run typecheck
npm test
npm run build
```

CI also checks that nothing writes to stdout, which on a stdio server carries the JSON-RPC
protocol. Log through `ctx.log`, which writes to stderr and strips the token. A stray
`console.log` breaks every client, and it will not be obvious that you were the cause.
