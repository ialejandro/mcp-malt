#!/usr/bin/env node
/**
 * Compare the live Malt OpenAPI document against the snapshot in spec/.
 *
 * Malt does not announce API changes and the spec has sat at info.version
 * 0.0.1 since we started, so a version bump is not a reliable signal. This
 * diffs the operations themselves.
 *
 * Exit 0 when nothing changed, 1 when something did, 2 when the check itself
 * could not run. Writes a summary to stdout and, under GitHub Actions, to the
 * step summary and outputs.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'spec', 'malt-openapi.json');
const INDEX_URL = 'https://api.malt.com/specSummary.json';

/** The spec is not linked from the docs page; it is found through this index. */
async function fetchLiveSpec() {
    const index = await fetchJson(INDEX_URL);
    if (!Array.isArray(index) || index.length === 0) throw new Error('specSummary.json listed no specs');
    if (index.length > 1) {
        console.log(`Note: Malt now publishes ${index.length} specs: ${index.map(s => s.id).join(', ')}`);
    }
    const file = index[0].file;
    return { spec: await fetchJson(new URL(file, INDEX_URL).href), file };
}

async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
    return res.json();
}

/** operationId -> "METHOD /path", the shape a tool actually binds to. */
function operations(spec) {
    const out = new Map();
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
        for (const [method, op] of Object.entries(item)) {
            if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
            const id = op.operationId ?? `${method} ${path}`;
            out.set(id, {
                route: `${method.toUpperCase()} ${path}`,
                params: (op.parameters ?? []).map(p => `${p.name}${p.required ? '!' : ''}`).sort().join(','),
                body: Object.keys(op.requestBody?.content ?? {}).sort().join(','),
                responses: Object.keys(op.responses ?? {}).sort().join(',')
            });
        }
    }
    return out;
}

function diff(oldSpec, newSpec) {
    const a = operations(oldSpec);
    const b = operations(newSpec);
    const lines = [];

    for (const id of b.keys()) if (!a.has(id)) lines.push(`ADDED    ${id} (${b.get(id).route})`);
    for (const id of a.keys()) if (!b.has(id)) lines.push(`REMOVED  ${id} (${a.get(id).route})`);
    for (const [id, before] of a) {
        const after = b.get(id);
        if (!after) continue;
        for (const key of ['route', 'params', 'body', 'responses']) {
            if (before[key] !== after[key]) {
                lines.push(`CHANGED  ${id}.${key}: ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`);
            }
        }
    }

    const oldVersion = oldSpec.info?.version;
    const newVersion = newSpec.info?.version;
    if (oldVersion !== newVersion) lines.unshift(`VERSION  ${oldVersion} -> ${newVersion}`);

    return lines;
}

function report(lines, counts) {
    const body = lines.length
        ? `Malt's API changed.\n\n${lines.map(l => `- ${l}`).join('\n')}\n\nOperations: ${counts.before} -> ${counts.after}.`
        : `No change. ${counts.after} operations, unchanged.`;

    console.log(body);

    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Malt API spec drift\n\n${body}\n`);
    }
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `changed=${lines.length > 0}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `summary<<EOF\n${body}\nEOF\n`);
    }
}

async function main() {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    const { spec: live } = await fetchLiveSpec();

    const lines = diff(snapshot, live);
    report(lines, { before: operations(snapshot).size, after: operations(live).size });

    if (lines.length > 0) {
        writeFileSync(SNAPSHOT, `${JSON.stringify(live, null, 2)}\n`);
        console.log(`\nUpdated ${SNAPSHOT}. Review the tools against the changes above.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`Spec check failed: ${err.message}`);
    process.exit(2);
});
