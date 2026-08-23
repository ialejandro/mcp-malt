#!/usr/bin/env node
/**
 * mcp-malt: an MCP server over the Malt public API.
 *
 * Nothing is exposed until it is asked for. Tools register only when their
 * toolset is named in MALT_TOOLSETS, so a disabled operation never reaches
 * tools/list and the model never sees it.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { ConfigError, loadConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { createClient } from './client.js';
import { registerPrompts } from './prompts.js';
import { describeToolsets, TOOLSETS } from './tools/registry.js';
import type { ToolContext } from './tools/shared.js';

const SERVER_INFO = { name: 'mcp-malt', version: '0.1.0' } as const;

export function buildServer(config: Config, log: Logger): McpServer {
    const server = new McpServer(SERVER_INFO);
    const ctx: ToolContext = { client: createClient(config, log), config, log };

    for (const toolset of TOOLSETS) {
        if (config.toolsets.has(toolset.name)) toolset.register(server, ctx);
    }
    registerPrompts(server, config);

    if (config.toolsets.size === 0) {
        serveEmptyLists(server);
        log.info(`No toolsets enabled, so no tools are exposed. Set MALT_TOOLSETS to any of:\n${describeToolsets()}`);
    } else {
        log.info(`Enabled toolsets: ${[...config.toolsets].join(', ')}. SCIM writes: ${config.allowWrites}.`);
    }

    return server;
}

/**
 * The SDK installs the tools/list and prompts/list handlers lazily, when the
 * first tool or prompt is registered. With everything disabled that never
 * happens, and a client asking for the list would get "Method not found"
 * rather than an empty one.
 */
function serveEmptyLists(server: McpServer): void {
    server.server.registerCapabilities({ tools: {}, prompts: {} });
    server.server.setRequestHandler('tools/list', () => ({ tools: [] }));
    server.server.setRequestHandler('prompts/list', () => ({ prompts: [] }));
}

async function main(): Promise<void> {
    let config: Config;
    try {
        config = loadConfig();
    } catch (err) {
        if (err instanceof ConfigError) {
            console.error(`[mcp-malt] configuration error: ${err.message}`);
            process.exit(1);
        }
        throw err;
    }

    const log = createLogger(config.logLevel, config.token);
    const server = buildServer(config, log);

    await serveStdio(() => server, {
        onerror: (err: Error) => log.error(`transport error: ${err.message}`)
    });
}

// Only run when executed directly, so tests can import buildServer.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => {
        console.error(`[mcp-malt] fatal: ${err instanceof Error ? err.stack : String(err)}`);
        process.exit(1);
    });
}
