# Contributing to mcp-malt

This is an MCP server over the [Malt API](https://api.malt.com). Thanks for taking a look.

## Before you start

Malt's public API is smaller than people expect: 13 operations covering invoices, payments,
service charges and SCIM user provisioning. There is no talent search, no profiles, no
missions, and no messaging, so a feature request for any of those cannot be built here. See
the [README](README.md#what-this-does-and-does-not-cover) for why.

## How can I contribute?

### Did you find a bug?

* **Check it has not already been reported** by searching the
  [issues](https://github.com/ialejandro/mcp-malt/issues).
* If nothing matches, [open a new one](https://github.com/ialejandro/mcp-malt/issues/new).
  Include a clear title and description, the toolsets you had enabled, the tool you called,
  and what came back.
* Never paste your `MALT_API_TOKEN`, or a log line containing it, into an issue. If you
  think you have leaked one, revoke it at
  [My Account, API Keys](https://www.malt.com/account/tokens) and create a new one.
* `MALT_LOG_LEVEL=debug` gives request method, path, status and timing on stderr, with the
  token redacted. That output is usually what an issue needs.

### Do you want to add or change a feature?

* Please [open an issue](https://github.com/ialejandro/mcp-malt/issues) before starting
  anything substantial, so you do not spend time on something that will not be merged.
* Read [docs/extending.md](docs/extending.md) first. Adding an endpoint or a toolset is meant
  to be a small, well-shaped change, and that document describes the shape.
* New capability stays off by default. Anything destructive goes behind `MALT_ALLOW_WRITES`
  as well, the way the SCIM writes do.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check-spec   # diff the live Malt spec against spec/malt-openapi.json
```

Tests mock `fetch` and never call the live API, so you can run the suite without a token.

To try the server against real data, use the MCP Inspector:

```bash
npm run build
MALT_API_TOKEN=your-token MALT_TOOLSETS=invoices \
  npx @modelcontextprotocol/inspector node dist/index.js
```

### Set up pre-commit

Hooks run formatting, secret scanning, the typecheck and the tests before a commit lands, and
CI runs the same set on every pull request. Install them once:

```bash
pipx install pre-commit          # or: brew install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg
```

The second command is what enables the commit message check, and it is easy to forget.

To run everything by hand without committing:

```bash
pre-commit run --all-files
```

`no-commit-to-branch` will refuse a commit made directly on `main`. That is the point: work on
a branch and open a pull request.

## Project rules that are easy to trip over

**Never write to stdout.** On a stdio transport, stdout carries the JSON-RPC protocol and
anything else on it corrupts the stream for every client. Log through `ctx.log`, which writes
to stderr and strips the token. CI fails the build if the server prints anything to stdout.

**Input schemas are strict, response schemas are permissive.** Rejecting a bad argument
locally is free. Validating a response you did not produce turns a working call into a tool
error the day Malt omits a field, so response schemas use `.partial().loose()`.

**Never retry a POST.** `createUser` has no idempotency key, so a retried create can make a
second user. The client retries GET, PUT and DELETE only, and that is deliberate.

**Keep endpoint knowledge out of the client.** When a status code means something specific to
one operation, pass `errorHints` with the request rather than teaching `client.ts` to
recognise paths.

**Commit the spec snapshot with the change.** `spec/malt-openapi.json` is the drift baseline.
When an API change prompts your work, update the snapshot in the same PR so the next
scheduled check comes back clean.

## Styleguides

### TypeScript

Match the surrounding code. It is consistent, so reading a neighbouring file answers most
questions.

* 4 spaces for indentation, semicolons, single quotes.
* Lines up to roughly 120 characters.
* Explicit types on exported functions and public interfaces. No `any` at a boundary; prefer
  `unknown` and narrow.
* Named constants instead of literals for anything with meaning, e.g. `MAX_ATTEMPTS`.
* No `I` prefix on interfaces, and no type or scope encoded into a name.
* Comments explain why, not what. Delete a comment rather than let it go stale, and never
  commit commented-out code.

### YAML

Used for GitHub Actions workflows and Dependabot.

* 2 spaces for indentation, no trailing whitespace, hyphens for list items.
* Keep the key names GitHub defines. Do not restyle `runs-on` or `working-directory`.
* Pin every action to a full commit SHA with the version in a trailing comment:
  `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`. A moving tag
  is a supply chain risk, and Dependabot updates the pins for you.
* Start each workflow with `permissions: {}` and grant what each job needs, at the job.

### Tests

* Test what could break, and boundaries in particular: empty, one under the limit, exactly
  the limit, one over.
* One idea per test, and a name that says what the behaviour is rather than which function
  it calls.
* No `.skip` or `.only` in committed code. A skipped test is an unanswered question, so fix
  it or delete it.
* Keep them fast. The whole suite runs in a couple of seconds today and should stay that way.

### Commit messages

Checked by gitlint, so a message that breaks these rules stops the commit.

* [Conventional Commits](https://www.conventionalcommits.org): `type(scope): description`,
  for example `feat: add the payments toolset` or `fix(client): stop retrying POST`.
* Present tense, imperative mood: "add the payments toolset", not "added" or "adds".
* First line 72 characters or less, body lines 100 or less. Reference issues and pull
  requests in the body.

### Documentation

* Write prose plainly. No marketing tone, no filler, no padding a short answer into a long
  one. Say what something does and what it costs.
* Prettier formats TypeScript only. The YAML and Markdown here are hand-wrapped, and a
  formatter would reflow them into a large and pointless diff.

## Releases

Releases are cut automatically. Merging to `main` runs semantic-release, which reads the
conventional commits since the last tag, works out the next version, publishes to npm,
creates the tag and publishes a GitHub release with generated notes.

| Commit type | Effect |
| --- | --- |
| `fix:` | patch release, 1.2.3 to 1.2.4 |
| `feat:` | minor release, 1.2.3 to 1.3.0 |
| `feat!:` or a `BREAKING CHANGE:` footer | major release, 1.2.3 to 2.0.0 |
| `chore:`, `docs:`, `test:`, `refactor:`, `style:` | no release |

So the commit type you choose decides the version. A bug fix labelled `chore:` never ships.

The tag then triggers `docker-build.yml`, which builds and pushes the image to GHCR. So one
merge produces an npm package and a container image from the same commit.

### Where the version lives

`package.json` on `main` is deliberately never bumped, and no CHANGELOG is committed, so a
release changes nothing in the repository. The git tag is the record of what shipped.

That has one consequence worth knowing, because it is easy to get wrong when editing the
build. The version a client sees over MCP comes from the manifest at runtime, never from a
literal in the source:

* **npm.** `@semantic-release/npm` writes the version into `package.json` before packing, so
  the published package reports it correctly.
* **Docker.** The image builds from the repository, where `package.json` still holds the
  starting version, so `docker-build.yml` passes the tag through as a `VERSION` build
  argument and the Dockerfile applies it with `npm pkg set`.

If you ever hardcode a version string in `src/`, both of those stop being true.

To see what the next release would be without cutting one, run the workflow manually from the
Actions tab with **dry run** ticked.

## Pull request checklist

* `pre-commit run --all-files` passes.
* `npm run typecheck`, `npm test` and `npm run build` all pass.
* New behaviour has a test, and a new endpoint has one that rejects what Malt rejects.
* Documentation updated when behaviour changed, including the env table in the README if you
  added a variable.
* `spec/malt-openapi.json` updated if the API changed.
* No token, real identifier, or customer name anywhere in the diff.
