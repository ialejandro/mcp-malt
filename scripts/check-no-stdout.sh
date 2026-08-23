#!/usr/bin/env bash
# Fail if anything in src/ writes to stdout.
#
# On a stdio MCP server stdout is the JSON-RPC wire. A stray console.log breaks
# every client, and the symptom looks like a connection problem rather than a
# logging mistake. Log through ctx.log, which writes to stderr.
set -euo pipefail

# Comment lines are skipped so that prose mentioning console.log does not trip
# the check.
offenders=$(
    grep -rnE 'console\.log|process\.stdout\.write' src --include='*.ts' |
        grep -vE ':[[:space:]]*(\*|//)' || true
)

if [ -n "$offenders" ]; then
    echo "A write to stdout was found in src/. On stdio, stdout is the JSON-RPC wire,"
    echo "so this breaks every client. Use ctx.log, which writes to stderr."
    echo
    echo "$offenders"
    exit 1
fi
