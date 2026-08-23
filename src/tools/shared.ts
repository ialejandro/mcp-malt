/**
 * Types and plumbing shared by every toolset.
 *
 * See docs/extending.md for how to add an endpoint or a toolset.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { MaltApiError, type MaltClient } from '../client.js';

/** Every tool name starts with this, so they stay distinguishable in a client holding many servers. */
export const TOOL_PREFIX = 'malt';

export interface ToolContext {
    client: MaltClient;
    config: Config;
    log: Logger;
}

/**
 * A group of tools the user turns on by name through MALT_TOOLSETS.
 *
 * Toolsets describe themselves rather than being listed elsewhere: the registry
 * collects them, and config validates names against that collection. Adding one
 * means writing a module and adding it to the registry, and nothing else.
 */
export interface Toolset {
    /** The name users type in MALT_TOOLSETS. */
    name: string;
    /** One line, shown when the server starts with nothing enabled. */
    summary: string;
    register(server: McpServer, ctx: ToolContext): void;
}

export function toolName(...parts: string[]): string {
    return [TOOL_PREFIX, ...parts].join('_');
}

export interface ToolOutcome {
    /** Human-readable summary shown to the model. */
    text: string;
    /** Machine-readable payload, matched against the tool's outputSchema. */
    structured?: Record<string, unknown>;
    /** Extra content blocks, used for PDF attachments. */
    extra?: unknown[];
}

/**
 * Run a tool body and convert failures into `isError` results.
 *
 * MCP draws a line between protocol errors and tool errors: a failed API call
 * is a normal outcome the model should see and react to, not a transport
 * fault. Everything from the client surfaces here as text.
 */
export async function guard(log: Logger, fn: () => Promise<ToolOutcome>) {
    try {
        const out = await fn();
        return {
            content: [{ type: 'text' as const, text: out.text }, ...((out.extra ?? []) as never[])],
            ...(out.structured ? { structuredContent: out.structured } : {})
        };
    } catch (err) {
        const message =
            err instanceof MaltApiError
                ? err.message
                : `Unexpected failure: ${err instanceof Error ? err.message : String(err)}`;
        log.error(message);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
}
