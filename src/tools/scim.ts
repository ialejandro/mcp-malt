/**
 * SCIM 2.0 user provisioning for an organization account.
 *
 * Reads register whenever the `scim` toolset is on. The four writes need
 * MALT_ALLOW_WRITES as well, because reading your user directory and being
 * able to delete from it are very different levels of trust.
 */

import { z } from 'zod';
import { submittedUser, userPage, userResource } from '../schemas.js';
import { guard, toolName, type Toolset } from './shared.js';

const USERS_PATH = '/scim/v2/Users';
const PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/**
 * The spec's PATCH operation schema carries `op` and `value` and no `path`,
 * so the value object holds the attribute being changed.
 */
const DEACTIVATE_BODY = {
    schemas: [PATCH_OP_SCHEMA],
    Operations: [{ op: 'replace', value: { active: false } }]
} as const;

/**
 * Malt refuses a delete once the user has platform activity. Only this toolset
 * knows that, so it travels with the request rather than living in the client.
 */
const DELETE_HINTS = {
    403:
        'Malt refused the delete (403). This usually means the user still has activity on the ' +
        'platform that must be completed first. Deactivating with malt_deactivate_user is the ' +
        'supported way to offboard someone.'
} as const;

const userIdArg = z.object({ userId: z.string().describe('SCIM identifier of the user, from malt_find_users.') });

function userUrl(userId: string): string {
    return `${USERS_PATH}/${encodeURIComponent(userId)}`;
}

export const scimToolset: Toolset = {
    name: 'scim',
    summary: 'SCIM 2.0 user provisioning. Reads always; writes need MALT_ALLOW_WRITES.',

    register(server, ctx) {
        server.registerTool(
            toolName('find', 'users'),
            {
                title: 'Find users',
                description:
                    "Query users provisioned on your organization's Malt account. The filter grammar supports " +
                    'only the "eq" operator, for example: userName eq "jane.doe@acme.com". Paginated with ' +
                    'startIndex (1-based) and count.',
                inputSchema: z.object({
                    filter: z
                        .string()
                        .optional()
                        .describe('SCIM filter, "eq" only, e.g. userName eq "jane@acme.com".'),
                    startIndex: z.number().int().min(1).optional().describe('1-based index of the first result.'),
                    count: z.number().int().min(0).optional().describe('Maximum results per page.')
                }),
                outputSchema: userPage,
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async query =>
                guard(ctx.log, async () => {
                    const page = await ctx.client.request<Record<string, unknown>>(USERS_PATH, { query });
                    const matched = page?.totalResults ?? (page?.Resources as unknown[] | undefined)?.length ?? 0;
                    return { text: `Matched ${matched} user(s).`, structured: page };
                })
        );

        server.registerTool(
            toolName('get', 'user'),
            {
                title: 'Get a user',
                description: 'Fetch one provisioned user by SCIM identifier.',
                inputSchema: userIdArg,
                outputSchema: userResource,
                annotations: { readOnlyHint: true, openWorldHint: true }
            },
            async ({ userId }) =>
                guard(ctx.log, async () => {
                    const user = await ctx.client.request<Record<string, unknown>>(userUrl(userId));
                    return { text: `User ${userId}.`, structured: user };
                })
        );

        if (!ctx.config.allowWrites) {
            ctx.log.info('SCIM writes are disabled. Set MALT_ALLOW_WRITES=true to register them.');
            return;
        }

        server.registerTool(
            toolName('create', 'user'),
            {
                title: 'Create a user',
                description:
                    "Provision a new user on your organization's Malt account. This operation has no " +
                    'idempotency key, so a call that times out may still have succeeded. Never repeat it ' +
                    'blindly: call malt_find_users with a userName filter first and only create if nothing ' +
                    'comes back.',
                inputSchema: submittedUser,
                outputSchema: userResource,
                annotations: {
                    readOnlyHint: false,
                    destructiveHint: false,
                    idempotentHint: false,
                    openWorldHint: true
                }
            },
            async body =>
                guard(ctx.log, async () => {
                    const user = await ctx.client.request<Record<string, unknown>>(USERS_PATH, {
                        method: 'POST',
                        body
                    });
                    return { text: `Created user ${body.userName}.`, structured: user };
                })
        );

        server.registerTool(
            toolName('replace', 'user'),
            {
                title: 'Replace a user',
                description:
                    "Replace a provisioned user's attributes wholesale. Any attribute you omit is cleared, so " +
                    'read the user with malt_get_user first and send back the full record with your changes ' +
                    'applied.',
                inputSchema: submittedUser.extend(userIdArg.shape),
                outputSchema: userResource,
                annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
            },
            async ({ userId, ...body }) =>
                guard(ctx.log, async () => {
                    const user = await ctx.client.request<Record<string, unknown>>(userUrl(userId), {
                        method: 'PUT',
                        body
                    });
                    return { text: `Replaced user ${userId}.`, structured: user };
                })
        );

        server.registerTool(
            toolName('deactivate', 'user'),
            {
                title: 'Deactivate a user',
                description:
                    'Deactivate a provisioned user. This is the supported way to offboard someone on Malt. The ' +
                    'API accepts only setting active to false through PATCH, so this tool takes no other fields, ' +
                    'and there is no matching reactivate operation.',
                inputSchema: userIdArg,
                annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
            },
            async ({ userId }) =>
                guard(ctx.log, async () => {
                    await ctx.client.request<void>(userUrl(userId), { method: 'PATCH', body: DEACTIVATE_BODY });
                    return { text: `Deactivated user ${userId}.` };
                })
        );

        server.registerTool(
            toolName('delete', 'user'),
            {
                title: 'Delete a user',
                description:
                    'Permanently delete a provisioned user. Malt refuses this with a 403 when the user still ' +
                    'has activity on the platform, which is common. Prefer malt_deactivate_user for offboarding ' +
                    'and use this only when the account was created in error.',
                inputSchema: userIdArg,
                annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
            },
            async ({ userId }) =>
                guard(ctx.log, async () => {
                    await ctx.client.request<void>(userUrl(userId), {
                        method: 'DELETE',
                        errorHints: DELETE_HINTS
                    });
                    return { text: `Deleted user ${userId}.` };
                })
        );
    }
};
