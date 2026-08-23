/**
 * Drives a built server over an in-memory transport with real JSON-RPC.
 *
 * Gating is the central promise of this package, so it is worth testing the
 * way a client actually sees it: through tools/list, rather than by reaching
 * into the server's private registry.
 */

import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { buildServer } from '../src/index.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const PROTOCOL_VERSION = '2025-06-18';

export interface Session {
    send(method: string, params?: Record<string, unknown>): Promise<any>;
    close(): Promise<void>;
}

export async function startSession(env: NodeJS.ProcessEnv): Promise<Session> {
    const config = loadConfig({ MALT_API_TOKEN: 'tok_test', ...env });
    const server = buildServer(config, createLogger('error', config.token));

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);

    let nextId = 1;
    const pending = new Map<number, (msg: any) => void>();

    clientSide.onmessage = (msg: JSONRPCMessage) => {
        const m = msg as any;
        if (typeof m.id === 'number' && pending.has(m.id)) {
            pending.get(m.id)!(m);
            pending.delete(m.id);
        }
    };
    await clientSide.start();

    const send = (method: string, params: Record<string, unknown> = {}) => {
        const id = nextId++;
        return new Promise<any>((resolve, reject) => {
            pending.set(id, msg => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
            void clientSide.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage);
        });
    };

    await send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test', version: '0' }
    });
    await clientSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);

    return { send, close: () => clientSide.close() };
}

export async function toolNames(env: NodeJS.ProcessEnv): Promise<string[]> {
    const session = await startSession(env);
    try {
        const result = await session.send('tools/list');
        return (result.tools as { name: string }[]).map(t => t.name).sort();
    } finally {
        await session.close();
    }
}

export async function promptNames(env: NodeJS.ProcessEnv): Promise<string[]> {
    const session = await startSession(env);
    try {
        const result = await session.send('prompts/list');
        return (result.prompts as { name: string }[]).map(p => p.name).sort();
    } finally {
        await session.close();
    }
}
