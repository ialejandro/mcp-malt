/**
 * Configuration, read from the environment.
 *
 * Nothing is enabled by default. `MALT_TOOLSETS` starts empty, which is a
 * valid state: the server boots, serves an empty tool list, and logs what is
 * available to turn on.
 */

import { LEVELS, type Level } from './logger.js';
import { TOOLSET_NAMES } from './tools/registry.js';

const ENABLE_EVERYTHING = 'all';

const DEFAULTS = {
    baseUrl: 'https://api.malt.com',
    rateLimitRps: 5,
    maxListItems: 200,
    timeoutMs: 30_000
} as const;

const AUTH_SCHEMES = ['raw', 'bearer'] as const;
type AuthScheme = (typeof AUTH_SCHEMES)[number];

export interface Config {
    token: string;
    baseUrl: string;
    /** `raw` sends the bare token, which is what Malt documents. */
    authScheme: AuthScheme;
    toolsets: ReadonlySet<string>;
    allowWrites: boolean;
    rateLimitRps: number;
    maxListItems: number;
    timeoutMs: number;
    logLevel: Level;
}

export class ConfigError extends Error {}

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number): number {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < minimum) {
        throw new ConfigError(`${name} must be a number >= ${minimum}, got ${JSON.stringify(raw)}`);
    }
    return parsed;
}

function readBoolean(env: NodeJS.ProcessEnv, name: string): boolean {
    const raw = (env[name] ?? '').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
}

function readChoice<T extends string>(
    env: NodeJS.ProcessEnv,
    name: string,
    allowed: readonly T[],
    fallback: T
): T {
    const raw = (env[name] ?? fallback).trim().toLowerCase();
    if (!(allowed as readonly string[]).includes(raw)) {
        throw new ConfigError(`${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(raw)}`);
    }
    return raw as T;
}

/**
 * Parse `MALT_TOOLSETS`. Empty enables nothing; `all` enables every toolset in
 * the registry.
 *
 * An unknown name is an error rather than a silent no-op, because the failure
 * mode otherwise is a server that starts fine and is mysteriously missing
 * tools.
 */
export function parseToolsets(raw: string | undefined): ReadonlySet<string> {
    const requested = (raw ?? '')
        .split(',')
        .map(name => name.trim().toLowerCase())
        .filter(Boolean);

    if (requested.length === 0) return new Set();
    if (requested.includes(ENABLE_EVERYTHING)) return new Set(TOOLSET_NAMES);

    const unknown = requested.filter(name => !TOOLSET_NAMES.includes(name));
    if (unknown.length > 0) {
        throw new ConfigError(
            `Unknown toolset(s): ${unknown.join(', ')}. ` +
                `Valid values are ${TOOLSET_NAMES.join(', ')}, or "${ENABLE_EVERYTHING}".`
        );
    }
    return new Set(requested);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const token = (env.MALT_API_TOKEN ?? '').trim();
    if (!token) {
        throw new ConfigError(
            'MALT_API_TOKEN is required. Create one at https://www.malt.com/account/tokens ' +
                '(My Account > API Keys). It is shown only once, when you create it.'
        );
    }

    return {
        token,
        baseUrl: (env.MALT_API_BASE_URL ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
        authScheme: readChoice(env, 'MALT_AUTH_SCHEME', AUTH_SCHEMES, 'raw'),
        toolsets: parseToolsets(env.MALT_TOOLSETS),
        allowWrites: readBoolean(env, 'MALT_ALLOW_WRITES'),
        rateLimitRps: readNumber(env, 'MALT_RATE_LIMIT_RPS', DEFAULTS.rateLimitRps, 0.01),
        maxListItems: readNumber(env, 'MALT_MAX_LIST_ITEMS', DEFAULTS.maxListItems, 1),
        timeoutMs: readNumber(env, 'MALT_TIMEOUT_MS', DEFAULTS.timeoutMs, 1),
        logLevel: readChoice(env, 'MALT_LOG_LEVEL', LEVELS, 'info')
    };
}
