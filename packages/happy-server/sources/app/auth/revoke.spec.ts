import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';

// Tests §4.3 against the REAL auth module (real persistent tokens, real jti)
// with the database mocked to an in-memory PGlite. This proves that a
// persistent revocation record — checked on every verifyToken, cache hit or
// miss — is what actually revokes access, and that clearing the in-memory
// cache does not undo a revocation (the token still fails re-verification).
// The three scopes (session / device / account) are exercised and shown to
// stay isolated: revoking one session must not revoke the others.

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

beforeAll(async () => {
    process.env.HANDY_MASTER_SECRET = 'test-master-secret-for-auth-revocation';
    const pg = new PGlite();
    await pg.exec(`
        CREATE TABLE "TokenRevocation" (
            "subject" TEXT PRIMARY KEY,
            "scope" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    holder.pg = pg;
    holder.primary = new PrismaClient({ adapter: new PrismaPGlite(pg) } as any);
});

afterAll(async () => {
    await holder.primary!.$disconnect();
    await holder.pg!.close();
});

beforeEach(async () => {
    await holder.primary!.tokenRevocation.deleteMany();
});

describe('persistent token revocation (real auth module)', () => {
    it('a session revocation kills that token but leaves other sessions working', async () => {
        const { auth } = await import('@/app/auth/auth');
        await auth.init();
        const { recordRevocation, RevocationScope } = await import('@/app/auth/revoke');

        const tokenA = await auth.createToken('user-A');
        const tokenB = await auth.createToken('user-A');
        const jtiA = (await auth.verifyToken(tokenA))!.jti!;

        // Both verify before any revocation.
        expect(await auth.verifyToken(tokenA)).not.toBeNull();
        expect(await auth.verifyToken(tokenB)).not.toBeNull();

        // Revoke only session A (its jti).
        await recordRevocation(jtiA, RevocationScope.session);

        // Token A is dead — even though it was cached (a cache hit must not
        // serve a revoked token). Token B (a different session) still works.
        expect(await auth.verifyToken(tokenA)).toBeNull();
        expect(await auth.verifyToken(tokenB)).not.toBeNull();
    });

    it('a device revocation kills tokens issued via that pairing session', async () => {
        const { auth } = await import('@/app/auth/auth');
        await auth.init();
        const { recordRevocation, RevocationScope } = await import('@/app/auth/revoke');

        const deviceTok = await auth.createToken('user-D', { session: 'pair-device-1' });
        const otherTok = await auth.createToken('user-D', { session: 'pair-other-1' });
        expect(await auth.verifyToken(deviceTok)).not.toBeNull();
        expect(await auth.verifyToken(otherTok)).not.toBeNull();

        await recordRevocation('pair-device-1', RevocationScope.device);

        expect(await auth.verifyToken(deviceTok)).toBeNull();
        expect(await auth.verifyToken(otherTok)).not.toBeNull();
    });

    it('an account revocation kills every token for the account', async () => {
        const { auth } = await import('@/app/auth/auth');
        await auth.init();
        const { recordRevocation, RevocationScope } = await import('@/app/auth/revoke');

        const t1 = await auth.createToken('user-E');
        const t2 = await auth.createToken('user-E', { session: 'pair-e-1' });
        expect(await auth.verifyToken(t1)).not.toBeNull();
        expect(await auth.verifyToken(t2)).not.toBeNull();

        await recordRevocation('user-E', RevocationScope.account);

        expect(await auth.verifyToken(t1)).toBeNull();
        expect(await auth.verifyToken(t2)).toBeNull();
    });

    it('clearing the cache does not undo a revocation (re-verify still fails)', async () => {
        const { auth } = await import('@/app/auth/auth');
        await auth.init();
        const { recordRevocation, RevocationScope } = await import('@/app/auth/revoke');

        const token = await auth.createToken('user-F');
        const jti = (await auth.verifyToken(token))!.jti!;
        await recordRevocation(jti, RevocationScope.session);

        // Simulate an operator clearing the in-memory cache. The revocation is
        // persistent, so a fresh cache miss must still reject the token — this
        // is the "cache-clear alone is not revocation" property from §4.3.
        auth.invalidateUserTokens('user-F');
        expect(await auth.verifyToken(token)).toBeNull();
    });

    it('cross-account isolation: revoking one user does not revoke another', async () => {
        const { auth } = await import('@/app/auth/auth');
        await auth.init();
        const { recordRevocation, RevocationScope } = await import('@/app/auth/revoke');

        const userG = await auth.createToken('user-G');
        const userH = await auth.createToken('user-H');
        await recordRevocation('user-G', RevocationScope.account);

        expect(await auth.verifyToken(userG)).toBeNull();
        expect(await auth.verifyToken(userH)).not.toBeNull();
    });
});
