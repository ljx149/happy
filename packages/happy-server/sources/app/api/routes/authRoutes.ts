import { z } from "zod";
import { type Fastify } from "../types";
import * as privacyKit from "privacy-kit";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { log } from "@/utils/log";
import {
    requestTerminalAuth,
    getTerminalAuthStatus,
    approveTerminalAuth,
} from "@/app/auth/terminalAuth";
import {
    requestAccountAuth,
    approveAccountAuth,
} from "@/app/auth/accountAuth";
import { issueChallenge, exchangeChallenge } from "@/app/auth/challenge";
import { recordRevocation, RevocationScope } from "@/app/auth/revoke";
import { eventRouter } from "@/app/events/eventRouter";

// A legitimate auth input is tiny: a 32-byte box key or 64-byte Ed25519
// signature encodes to under 100 base64 characters. Anything wildly larger is
// malformed and must be a 4xx, not a 500 from the crypto library.
const MAX_AUTH_FIELD_CHARS = 4 * 1024;

async function loadTweetnacl() {
    return (await import("tweetnacl")).default;
}

// Decode a base64 field, mapping malformed input to a 400 instead of letting
// privacyKit's throw become a 500. Returns privacyKit's Bytes type (not plain
// Uint8Array) so the value stays compatible with the crypto library's signature
// and box key arguments.
function decodeBase64Field(value: string): privacyKit.Bytes | null {
    if (value.length > MAX_AUTH_FIELD_CHARS) return null;
    try {
        return privacyKit.decodeBase64(value);
    } catch {
        return null;
    }
}

export function authRoutes(app: Fastify) {
    // Issue a server-signed, short-lived challenge bound to an identity. The
    // client signs it and presents it back with the claimToken for the versioned
    // exchange below.
    app.post('/v1/auth/challenge', {
        schema: {
            body: z.object({ publicKey: z.string() }),
            response: {
                200: z.object({ challenge: z.string(), claimToken: z.string() }),
                400: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        const tweetnacl = await loadTweetnacl();
        const publicKey = decodeBase64Field(request.body.publicKey);
        if (!publicKey || tweetnacl.box.publicKeyLength !== publicKey.length) {
            return reply.code(400).send({ error: 'Invalid public key' });
        }
        const { challenge, claimToken } = await issueChallenge(privacyKit.encodeHex(publicKey));
        return reply.send({ challenge, claimToken });
    });

    // Exchange a signed challenge for a token. Two paths:
    //   - claimToken present: versioned exchange — the signature must match the
    //     server-issued challenge, which is atomically consumed in the shared
    //     persistent layer. A token is issued only after consumption.
    //   - claimToken absent: legacy client-issued challenge. Kept for the initial
    //     Web integration; it has replay risk (a captured valid signature can be
    //     re-submitted) and is not a full replay fix.
    app.post('/v1/auth', {
        schema: {
            body: z.object({
                publicKey: z.string(),
                challenge: z.string(),
                signature: z.string(),
                claimToken: z.string().nullish()
            }),
            response: {
                200: z.object({ success: z.literal(true), token: z.string() }),
                400: z.object({ error: z.string() }),
                401: z.object({ error: z.string() }),
                410: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        const tweetnacl = await loadTweetnacl();
        const publicKey = decodeBase64Field(request.body.publicKey);
        const challengeBytes = decodeBase64Field(request.body.challenge);
        const signature = decodeBase64Field(request.body.signature);
        if (!publicKey || !challengeBytes || !signature) {
            return reply.code(400).send({ error: 'Malformed base64 input' });
        }
        if (tweetnacl.box.publicKeyLength !== publicKey.length) {
            return reply.code(400).send({ error: 'Invalid public key' });
        }
        if (tweetnacl.sign.signatureLength !== signature.length) {
            return reply.code(400).send({ error: 'Invalid signature length' });
        }
        const publicKeyHex = privacyKit.encodeHex(publicKey);

        if (request.body.claimToken) {
            const result = await exchangeChallenge(request.body.claimToken, publicKeyHex, signature);
            if (!result.ok) {
                const code = result.reason === 'invalid_signature' ? 401 : 410;
                return reply.code(code).send({ error: `Challenge ${result.reason}` });
            }
            const user = await db.account.upsert({
                where: { publicKey: publicKeyHex },
                update: { updatedAt: new Date() },
                create: { publicKey: publicKeyHex }
            });
            return reply.send({ success: true, token: await auth.createToken(user.id) });
        }

        // Legacy path: client-issued challenge.
        const isValid = tweetnacl.sign.detached.verify(challengeBytes, signature, publicKey);
        if (!isValid) {
            return reply.code(401).send({ error: 'Invalid signature' });
        }
        const user = await db.account.upsert({
            where: { publicKey: publicKeyHex },
            update: { updatedAt: new Date() },
            create: { publicKey: publicKeyHex }
        });
        return reply.send({ success: true, token: await auth.createToken(user.id) });
    });

    // Terminal auth request: create or refresh a device's pairing request.
    // Idempotent — the CLI re-POSTs every poll. If a prior response is still
    // inside its claim window it is handed out; otherwise a fresh request.
    app.post('/v1/auth/request', {
        schema: {
            body: z.object({
                publicKey: z.string(),
                supportsV2: z.boolean().nullish()
            }),
            response: {
                200: z.union([z.object({
                    state: z.literal('requested'),
                }), z.object({
                    state: z.literal('authorized'),
                    token: z.string(),
                    response: z.string()
                })]),
                400: z.object({ error: z.string() }),
                401: z.object({ error: z.literal('Invalid public key') })
            }
        }
    }, async (request, reply) => {
        const tweetnacl = await loadTweetnacl();
        const publicKey = decodeBase64Field(request.body.publicKey);
        if (!publicKey || tweetnacl.box.publicKeyLength !== publicKey.length) {
            return reply.code(400).send({ error: 'Invalid public key' });
        }

        const publicKeyHex = privacyKit.encodeHex(publicKey);
        log({ module: 'auth-request' }, `Terminal auth request - publicKey hex: ${publicKeyHex}`);

        const answer = await requestTerminalAuth(publicKeyHex, request.body.supportsV2 ?? false);

        if (answer.response && answer.responseAccountId) {
            const token = await auth.createToken(answer.responseAccountId!, { session: answer.id });
            return reply.send({
                state: 'authorized',
                token: token,
                response: answer.response
            });
        }

        return reply.send({ state: 'requested' });
    });

    // Terminal auth request status. Returns the stored supportsV2 (not a
    // hard-coded false) so the approver and device agree on the protocol.
    app.get('/v1/auth/request/status', {
        schema: {
            querystring: z.object({ publicKey: z.string() }),
            response: {
                200: z.object({
                    status: z.enum(['not_found', 'pending', 'authorized']),
                    supportsV2: z.boolean()
                }),
                400: z.object({ error: z.string() })
            }
        }
    }, async (request, reply) => {
        const tweetnacl = await loadTweetnacl();
        const publicKey = decodeBase64Field(request.query.publicKey);
        if (!publicKey || tweetnacl.box.publicKeyLength !== publicKey.length) {
            return reply.send({ status: 'not_found', supportsV2: false });
        }

        const status = await getTerminalAuthStatus(privacyKit.encodeHex(publicKey));
        if (!status.found) {
            return reply.send({ status: 'not_found', supportsV2: false });
        }
        if (status.response && status.responseAccountId) {
            return reply.send({ status: 'authorized', supportsV2: status.supportsV2 });
        }
        return reply.send({ status: 'pending', supportsV2: status.supportsV2 });
    });

    // Approve a terminal auth request. Atomic — exactly one of two concurrent
    // approvers writes the response; the other gets a conflict. Repeated
    // approval by the same account is idempotent.
    app.post('/v1/auth/response', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({ response: z.string(), publicKey: z.string() }),
            response: {
                200: z.object({ success: z.literal(true) }),
                400: z.object({ error: z.string() }),
                401: z.object({ error: z.literal('Invalid public key') }),
                404: z.object({ error: z.literal('Request not found') }),
                409: z.object({ error: z.literal('Request already claimed') })
            }
        }
    }, async (request, reply) => {
        log({ module: 'auth-response' }, `Auth response endpoint hit - user: ${request.userId}, publicKey: ${request.body.publicKey.substring(0, 20)}...`);
        const tweetnacl = await loadTweetnacl();
        const publicKey = decodeBase64Field(request.body.publicKey);
        if (!publicKey || tweetnacl.box.publicKeyLength !== publicKey.length) {
            return reply.code(400).send({ error: 'Invalid public key' });
        }
        const publicKeyHex = privacyKit.encodeHex(publicKey);

        const result = await approveTerminalAuth(publicKeyHex, request.body.response, request.userId);
        if (!result.claimed) {
            return reply.code(409).send({ error: 'Request already claimed' });
        }
        return reply.send({ success: true });
    });

    // Account auth request: create or refresh an account pairing request.
    app.post('/v1/auth/account/request', {
        schema: {
            body: z.object({ publicKey: z.string() }),
            response: {
                200: z.union([z.object({
                    state: z.literal('requested'),
                }), z.object({
                    state: z.literal('authorized'),
                    token: z.string(),
                    response: z.string()
                })]),
                400: z.object({ error: z.string() }),
                401: z.object({ error: z.literal('Invalid public key') })
            }
        }
    }, async (request, reply) => {
        const tweetnacl = await loadTweetnacl();
        const publicKey = decodeBase64Field(request.body.publicKey);
        if (!publicKey || tweetnacl.box.publicKeyLength !== publicKey.length) {
            return reply.code(400).send({ error: 'Invalid public key' });
        }

        const answer = await requestAccountAuth(privacyKit.encodeHex(publicKey));

        if (answer.response && answer.responseAccountId) {
            const token = await auth.createToken(answer.responseAccountId!);
            return reply.send({
                state: 'authorized',
                token: token,
                response: answer.response
            });
        }

        return reply.send({ state: 'requested' });
    });

    // Approve an account auth request. Atomic, idempotent for the same account.
    app.post('/v1/auth/account/response', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({ response: z.string(), publicKey: z.string() }),
            response: {
                200: z.object({ success: z.literal(true) }),
                400: z.object({ error: z.string() }),
                401: z.object({ error: z.literal('Invalid public key') }),
                404: z.object({ error: z.literal('Request not found') }),
                409: z.object({ error: z.literal('Request already claimed') })
            }
        }
    }, async (request, reply) => {
        const tweetnacl = await loadTweetnacl();
        const publicKey = decodeBase64Field(request.body.publicKey);
        if (!publicKey || tweetnacl.box.publicKeyLength !== publicKey.length) {
            return reply.code(400).send({ error: 'Invalid public key' });
        }

        const result = await approveAccountAuth(privacyKit.encodeHex(publicKey), request.body.response, request.userId);
        if (!result.claimed) {
            return reply.code(409).send({ error: 'Request already claimed' });
        }
        return reply.send({ success: true });
    });

    // Exit this session: revoke only this token (its jti). Other sessions and
    // devices for the account keep working.
    app.post('/v1/auth/revoke/session', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const subject = request.jti;
        if (!subject) {
            return reply.code(400).send({ error: 'Token has no session identity' });
        }
        await recordRevocation(subject, RevocationScope.session);
        await eventRouter.disconnectRevoked(request.userId);
        auth.invalidateUserTokens(request.userId);
        return reply.send({ success: true });
    });

    // Revoke this device: kill the token(s) issued via this pairing session.
    // Other devices are unaffected.
    app.post('/v1/auth/revoke/device', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const subject = request.session;
        if (!subject) {
            return reply.code(400).send({ error: 'Token has no pairing session' });
        }
        await recordRevocation(subject, RevocationScope.device);
        await eventRouter.disconnectRevoked(request.userId);
        auth.invalidateUserTokens(request.userId);
        return reply.send({ success: true });
    });

    // Revoke all devices: kill every token for the account.
    app.post('/v1/auth/revoke/account', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        await recordRevocation(request.userId, RevocationScope.account);
        await eventRouter.disconnectRevoked(request.userId);
        auth.invalidateUserTokens(request.userId);
        return reply.send({ success: true });
    });

}
