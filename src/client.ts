/**
 * HTTP client for the Malt API.
 *
 * Handles auth, outbound pacing, retries, and turning Malt's two different
 * error bodies into one message a person can act on.
 */

import type { Config } from './config.js';
import type { Logger } from './logger.js';

const MAX_ATTEMPTS = 3;
const FIRST_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4_000;
const MAX_RETRY_AFTER_MS = 30_000;
const NO_CONTENT = 204;

/** Statuses worth trying again. Everything else in the 4xx range is a client mistake. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/**
 * `createUser` has no idempotency key, so a retried POST that actually
 * succeeded the first time creates a second user. Only methods that are safe
 * or idempotent by definition get retried.
 */
const RETRYABLE_METHODS: ReadonlySet<string> = new Set(['GET', 'PUT', 'DELETE']);

/**
 * What each status means on this API, absent anything more specific from the
 * caller. A toolset that knows better passes `errorHints`.
 */
const STATUS_EXPLANATIONS: Readonly<Record<number, string>> = {
    400:
        'Malt rejected the request (400). Check that "since" and "until" are ISO 8601 date-times, ' +
        'for example 2026-01-01T00:00:00Z.',
    401:
        'Malt rejected the API token (401). It may be missing, expired or revoked. Create a new one ' +
        'at https://www.malt.com/account/tokens.',
    403: 'Malt refused this request (403). The token lacks the permission scope this endpoint needs.',
    429:
        `Malt rate-limited the request (429) and it did not recover after ${MAX_ATTEMPTS} attempts. ` +
        'Lower MALT_RATE_LIMIT_RPS.'
};

/** SCIM tells us why a 400 happened; these are the only two values it uses. */
const SCIM_TYPE_EXPLANATIONS: Readonly<Record<string, string>> = {
    invalidFilter:
        'Malt rejected the SCIM filter (400). The filter grammar here supports only the "eq" operator, ' +
        'for example: userName eq "jane.doe@acme.com".',
    invalidValue:
        'Malt rejected a field value (400). Check userName is non-blank and phoneNumbers has at most ' +
        '3 entries.'
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** An error carrying a message meant to be shown to the user. */
export class MaltApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly body?: unknown
    ) {
        super(message);
        this.name = 'MaltApiError';
    }
}

export interface RequestOptions {
    method?: HttpMethod;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    /**
     * Per-status messages that override the defaults, for endpoints where a
     * status means something specific. Keeping these with the caller stops the
     * client from having to recognise individual endpoints.
     */
    errorHints?: Readonly<Partial<Record<number, string>>>;
}

/**
 * Malt's freelancer and auth errors are Spring-shaped; SCIM errors follow
 * RFC 7644. Both may also be entirely empty, which is what a live 401
 * actually returns.
 */
interface MaltErrorBody {
    timestamp?: string;
    status?: number | string;
    error?: string;
    path?: string;
    schemas?: string[];
    scimType?: string;
    detail?: string;
}

export interface MaltClient {
    request<T>(path: string, options?: RequestOptions): Promise<T>;
}

/** Spaces outbound calls so we never burst at an API with no published ceiling. */
class Pacer {
    private earliestNextCall = 0;

    constructor(private readonly intervalMs: number) {}

    async wait(): Promise<void> {
        if (this.intervalMs <= 0) return;

        const now = Date.now();
        const callAt = Math.max(now, this.earliestNextCall);
        this.earliestNextCall = callAt + this.intervalMs;

        if (callAt > now) await delay(callAt - now);
    }
}

export function createClient(config: Config, log: Logger): MaltClient {
    const pacer = new Pacer(config.rateLimitRps > 0 ? 1000 / config.rateLimitRps : 0);

    function buildUrl(path: string, query: RequestOptions['query']): URL {
        const url = new URL(config.baseUrl + path);
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
        }
        return url;
    }

    function buildHeaders(hasBody: boolean): Record<string, string> {
        const headers: Record<string, string> = {
            // Malt documents a bare token, not `Bearer <token>`.
            Authorization: config.authScheme === 'bearer' ? `Bearer ${config.token}` : config.token,
            Accept: 'application/json'
        };
        if (hasBody) headers['Content-Type'] = 'application/json';
        return headers;
    }

    async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
        const method = options.method ?? 'GET';
        const url = buildUrl(path, options.query);
        const headers = buildHeaders(options.body !== undefined);
        const canRetry = RETRYABLE_METHODS.has(method);

        let lastError: MaltApiError | undefined;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            await pacer.wait();
            const startedAt = Date.now();

            let response: Response;
            try {
                response = await fetch(url, {
                    method,
                    headers,
                    body: options.body === undefined ? undefined : JSON.stringify(options.body),
                    signal: AbortSignal.timeout(config.timeoutMs)
                });
            } catch (cause) {
                lastError = new MaltApiError(0, `Could not reach the Malt API: ${messageOf(cause)}`);
                if (!canRetry || attempt === MAX_ATTEMPTS) throw lastError;
                await delay(backoffFor(attempt));
                continue;
            }

            log.debug(`${method} ${path} -> ${response.status} in ${Date.now() - startedAt}ms`);

            if (response.ok) return readBody<T>(response);

            const body = await readErrorBody(response);
            lastError = new MaltApiError(response.status, explain(response.status, path, body, options.errorHints), body);
            log.warn(`${method} ${path} failed`, { status: response.status });

            const worthRetrying = canRetry && RETRYABLE_STATUSES.has(response.status);
            if (!worthRetrying || attempt === MAX_ATTEMPTS) throw lastError;

            await delay(retryDelayFor(response, attempt));
        }

        throw lastError ?? new MaltApiError(0, 'Request failed for an unknown reason.');
    }

    return { request };
}

async function readBody<T>(response: Response): Promise<T> {
    if (response.status === NO_CONTENT) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
}

async function readErrorBody(response: Response): Promise<MaltErrorBody> {
    const text = await response.text().catch(() => '');
    if (!text) return {}; // Malt returns an empty body on 401.
    try {
        return JSON.parse(text) as MaltErrorBody;
    } catch {
        return { detail: text };
    }
}

function explain(
    status: number,
    path: string,
    body: MaltErrorBody,
    hints: RequestOptions['errorHints']
): string {
    const detail = body.detail ?? body.error;
    const suffix = detail ? ` Malt said: ${detail}.` : '';

    const base =
        hints?.[status] ??
        (body.scimType ? SCIM_TYPE_EXPLANATIONS[body.scimType] : undefined) ??
        STATUS_EXPLANATIONS[status] ??
        (status === 404
            ? `Malt found nothing at ${path} (404). Check the identifier.`
            : `Malt returned HTTP ${status} for ${path}.`);

    return `${base}${suffix}`;
}

/** Malt declares no 429 and sends no Retry-After, but honour it if it appears. */
function retryDelayFor(response: Response, attempt: number): number {
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
    }
    return backoffFor(attempt);
}

function backoffFor(attempt: number): number {
    return Math.min(FIRST_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
