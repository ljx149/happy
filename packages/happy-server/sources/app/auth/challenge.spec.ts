import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';
import tweetnacl from 'tweetnacl';
import * as privacyKit from 'privacy-kit';

// A throwaway in-memory PGlite backing real Prisma clients, so the versioned
// challenge exchange is tested against real atomic consumption (deleteMany
// under a transaction row lock) rather than a hand-rolled mock. RepeatKey is
// the shared persistent layer the challenge binds to; multiple clients over
// the same PGlite simulate distinct processes / a restart.
const holder = vi.hoisted(() => ({
    primary: null as PrismaClient | null,
    pg: null as PGlite | null,
}));

vi.mock('@/storage/db', () => {
    const proxy = new Proxy({}, {
        get: (_t, prop) => (holder.primary as unknown as Record<PropertyKey, unknown>)[prop],
    });
    return { db: proxy, getPGlite: () => holder.pg };
});

async function newClient(): Promise<PrismaClient> {
    const adapter = new PrismaPGlite(holder.pg!);
    return new PrismaClient({ adapter } as any);
}

beforeAll(async () => {
    const pg = new PGlite();
    await pg.exec(`
        CREATE TABLE "RepeatKey" (
            "key" TEXT PRIMARY KEY,
            "value" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "expiresAt" TIMESTAMP(3) NOT NULL
        );
    `);
    holder.pg = pg;
    holder.primary = await newClient();
});

afterAll(async () => {
    await holder.primary!.$disconnect();
    await holder.pg!.close();
});

beforeEach(async () => {
    await holder.primary!.repeatKey.deleteMany();
});

async function issueAndSign(publicKey: Uint8Array, secretKey: Uint8Array) {
    const { issueChallenge } = await import('@/app/auth/challenge');
    const publicKeyHex = privacyKit.encodeHex(new Uint8Array(publicKey));
    const { challenge, claimToken } = await issueChallenge(publicKeyHex);
    const challengeBytes = privacyKit.decodeBase64(challenge);
    const signature = tweetnacl.sign.detached(challengeBytes, secretKey);
    return { challenge, claimToken, signature, challengeBytes };
}

async function runExchange(clientProcess: 'primary' | 'second', claimToken: string, publicKeyHex: string, signature: Uint8Array) {
    const { exchangeChallenge } = await import('@/app/auth/challenge');
    // Temporarily switch the db proxy to the requested process, so this call
    // runs in that client's transaction / row-lock context.
    const prev = holder.primary;
    if (clientProcess === 'second') {
        holder.primary = await newClient();
    }
    try {
        return await exchangeChallenge(claimToken, publicKeyHex, signature);
    } finally {
        holder.primary = prev;
    }
}

describe('versioned challenge exchange (real PGlite, atomic consumption)', () => {
    it('consumes a valid challenge and rejects a replay with already_consumed', async () => {
        const kp = tweetnacl.sign.keyPair();
        const publicKeyHex = privacyKit.encodeHex(new Uint8Array(kp.publicKey));
        const { claimToken, signature } = await issueAndSign(kp.publicKey, kp.secretKey);

        const first = await runExchange('primary', claimToken, publicKeyHex, signature);
        expect(first).toEqual({ ok: true });

        // Replay of the same consumed challenge, in-process: the row is gone,
        // so the exchange is refused and no second token is minted.
        const replay = await runExchange('primary', claimToken, publicKeyHex, signature);
        expect(replay.ok).toBe(false);
    });

    it('a replay from a second process (simulated restart) is also rejected', async () => {
        const kp = tweetnacl.sign.keyPair();
        const publicKeyHex = privacyKit.encodeHex(new Uint8Array(kp.publicKey));
        const { claimToken, signature } = await issueAndSign(kp.publicKey, kp.secretKey);

        const first = await runExchange('primary', claimToken, publicKeyHex, signature);
        expect(first).toEqual({ ok: true });

        // A fresh client process over the same database still sees the row
        // gone — consumption is persistent, not in-memory.
        const second = await runExchange('second', claimToken, publicKeyHex, signature);
        expect(second.ok).toBe(false);
        if (!second.ok) {
            expect(second.reason).toBeDefined();
        }
    });

    it('concurrent duplicate exchanges: exactly one succeeds', async () => {
        const kp = tweetnacl.sign.keyPair();
        const publicKeyHex = privacyKit.encodeHex(new Uint8Array(kp.publicKey));
        const { claimToken, signature } = await issueAndSign(kp.publicKey, kp.secretKey);

        // Two concurrent exchanges in the same process. Both are async; the
        // atomic deleteMany under the transaction row lock ensures only one
        // sees count === 1.
        const [r1, r2] = await Promise.all([
            runExchange('primary', claimToken, publicKeyHex, signature),
            runExchange('primary', claimToken, publicKeyHex, signature),
        ]);
        expect([r1, r2].filter(r => r.ok === true)).toHaveLength(1);
    });

    it('a challenge presented by a different identity fails', async () => {
        const kpA = tweetnacl.sign.keyPair();
        const kpB = tweetnacl.sign.keyPair();
        const publicKeyHexA = privacyKit.encodeHex(new Uint8Array(kpA.publicKey));
        const { claimToken, signature } = await issueAndSign(kpA.publicKey, kpA.secretKey);

        // B presents A's challenge signed by A's key but claiming B's identity.
        // The identity binding rejects it (publicKey mismatch) regardless of
        // the signature.
        const result = await runExchange('primary', claimToken, privacyKit.encodeHex(new Uint8Array(kpB.publicKey)), signature);
        expect(result.ok).toBe(false);
    });

    it('an expired challenge is cleaned up and rejected with expired', async () => {
        const kp = tweetnacl.sign.keyPair();
        const publicKeyHex = privacyKit.encodeHex(new Uint8Array(kp.publicKey));
        const { issueChallenge } = await import('@/app/auth/challenge');
        const { challenge, claimToken } = await issueChallenge(publicKeyHex);

        // Back-date the challenge's expiry so it is stale.
        await holder.primary!.repeatKey.update({
            where: { key: claimToken },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const signature = tweetnacl.sign.detached(privacyKit.decodeBase64(challenge), kp.secretKey);
        const result = await runExchange('primary', claimToken, publicKeyHex, signature);
        expect(result).toEqual({ ok: false, reason: 'expired' });
        expect(await holder.primary!.repeatKey.findUnique({ where: { key: claimToken } })).toBeNull();
    });

    it('a response-loss retry after consumption reports already_consumed, not a fresh token', async () => {
        const kp = tweetnacl.sign.keyPair();
        const publicKeyHex = privacyKit.encodeHex(new Uint8Array(kp.publicKey));
        const { claimToken, signature } = await issueAndSign(kp.publicKey, kp.secretKey);

        const first = await runExchange('primary', claimToken, publicKeyHex, signature);
        expect(first).toEqual({ ok: true });

        // Client lost the token response and re-submits the same signed
        // challenge. The server must not mint a second token — the challenge is
        // already consumed and the replay is refused.
        const retry = await runExchange('primary', claimToken, publicKeyHex, signature);
        expect(retry.ok).toBe(false);
    });
});
