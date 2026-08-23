/**
 * Logging for a stdio MCP server.
 *
 * stdout carries the JSON-RPC wire. Anything written there corrupts the
 * protocol, so every line here goes to stderr and `console.log` appears
 * nowhere in this package.
 */

export const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type Level = (typeof LEVELS)[number];

export interface Logger {
    debug(msg: string, extra?: unknown): void;
    info(msg: string, extra?: unknown): void;
    warn(msg: string, extra?: unknown): void;
    error(msg: string, extra?: unknown): void;
}

/**
 * Replace every occurrence of the API token with `***`.
 *
 * A token can reach a log line through a URL, a header dump or an error
 * message thrown by fetch, so redaction runs on the rendered string rather
 * than on any single field.
 */
export function redact(text: string, token: string | undefined): string {
    if (!token || token.length < 4) return text;
    return text.split(token).join('***');
}

export function createLogger(level: Level, token?: string): Logger {
    const threshold = LEVELS.indexOf(level);

    const emit = (lvl: Level, msg: string, extra?: unknown) => {
        if (LEVELS.indexOf(lvl) < threshold) return;
        let line = `[mcp-malt] ${lvl} ${msg}`;
        if (extra !== undefined) {
            try {
                line += ` ${JSON.stringify(extra)}`;
            } catch {
                line += ' [unserialisable]';
            }
        }
        console.error(redact(line, token));
    };

    return {
        debug: (m, e) => emit('debug', m, e),
        info: (m, e) => emit('info', m, e),
        warn: (m, e) => emit('warn', m, e),
        error: (m, e) => emit('error', m, e)
    };
}
