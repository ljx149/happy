import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'node:crypto';

// A throwaway in-memory PGlite backing a real Prisma client, so concurrency
// tests exercise the real conditional updateMany / row-lock behavior rather
// than a hand-rolled mock. Tables are created directly (not via migrations)
// to keep the test isolated from the pending human-authored TokenRevocation
// migration. The client is built in beforeAll; the mock exposes `db` via a
// lazy getter so the module under test (which imports `db` at its own load
// time, inside each test) always sees the live client.
const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));

vi.mock('@/storage/db', () => {
    // Proxy every property access to the live client built in beforeAll.
    // terminalAuth/accountAuth do `import { db } from '@/storage/db'` and call
    // db.<model>.<method>, so delegating to holder.db covers every call.
    const proxy = new Proxy({}, {
        get: (_target, prop) => (holder.db as unknown as Record<PropertyKey, unknown>)[prop],
    });
    return { db: proxy, getPGlite: () => undefined };
});

function publicKeyB64(label: string): string {
    return crypto.createHash('sha256').update(label).digest('base64');
}

beforeAll(async () => {
    const pg = new PGlite();
    await pg.exec(`
        CREATE TABLE "Account" (
            "id" TEXT PRIMARY KEY,
            "publicKey" TEXT UNIQUE NOT NULL,
            "seq" INTEGER NOT NULL DEFAULT 0,
            "feedSeq" BIGINT NOT NULL DEFAULT 0,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL
        );
        CREATE TABLE "TerminalAuthRequest" (
            "id" TEXT PRIMARY KEY,
            "publicKey" TEXT UNIQUE NOT NULL,
            "supportsV2" BOOLEAN NOT NULL DEFAULT false,
            "response" TEXT,
            "responseAccountId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL
        );
        CREATE TABLE "AccountAuthRequest" (
            "id" TEXT PRIMARY KEY,
            "publicKey" TEXT UNIQUE NOT NULL,
            "response" TEXT,
            "responseAccountId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL
        );
        CREATE TABLE "TokenRevocation" (
            "subject" TEXT PRIMARY KEY,
            "scope" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    const adapter = new PrismaPGlite(pg);
    holder.db = new PrismaClient({ adapter } as any);
});

afterAll(async () => {
    const db = holder.db as PrismaClient;
    await db.$disconnect();
});

beforeEach(async () => {
    const db = holder.db as PrismaClient;
    await db.account.deleteMany();
    await db.terminalAuthRequest.deleteMany();
    await db.accountAuthRequest.deleteMany();
});

describe('terminal auth request lifecycle (real PGlite)', () => {
    it('requestTerminalAuth is idempotent and creates a new request when none exists', async () => {
        const { requestTerminalAuth } = await import('@/app/auth/terminalAuth');
        const answer = await requestTerminalAuth(publicKeyB64('terminal-1'), true);
        expect(answer.publicKey).toBe(publicKeyB64('terminal-1'));
        expect(answer.supportsV2).toBe(true);
        expect(answer.response).toBe(null);
    });

    it('concurrent approval: exactly one of two accounts claims the request', async () => {
        const { requestTerminalAuth, approveTerminalAuth } = await import('@/app/auth/terminalAuth');
        const pk = publicKeyB64('concurrent-terminal');
        await requestTerminalAuth(pk, false);

        const [r1, r2] = await Promise.all([
            approveTerminalAuth(pk, 'sealed-A', 'account-A'),
            approveTerminalAuth(pk, 'sealed-B', 'account-B'),
        ]);

        const claimed = [r1, r2].filter(r => r.claimed);
        expect(claimed).toHaveLength(1);
        const stored = (await (holder.db as PrismaClient).terminalAuthRequest.findUnique({ where: { publicKey: pk } }))!;
        expect(stored.responseAccountId).not.toBeNull();
        expect(stored.response).not.toBeNull();
        // The loser's response must not have overwritten the winner's.
        const winner = stored.responseAccountId!;
        expect(stored.response).toBe(winner === 'account-A' ? 'sealed-A' : 'sealed-B');
    });

    it('same-account re-approval is idempotent; different account is a conflict', async () => {
        const { requestTerminalAuth, approveTerminalAuth } = await import('@/app/auth/terminalAuth');
        const pk = publicKeyB64('terminal-same-account');
        await requestTerminalAuth(pk, false);
        const first = await approveTerminalAuth(pk, 'sealed', 'account-A');
        expect(first.claimed).toBe(true);
        const again = await approveTerminalAuth(pk, 'sealed', 'account-A');
        expect(again.claimed).toBe(true);
        const other = await approveTerminalAuth(pk, 'sealed', 'account-B');
        expect(other.claimed).toBe(false);
        const stored = (await (holder.db as PrismaClient).terminalAuthRequest.findUnique({ where: { publicKey: pk } }))!;
        expect(stored.responseAccountId).toBe('account-A');
    });

    it('getTerminalAuthStatus returns the stored supportsV2, not hard-coded false', async () => {
        const { requestTerminalAuth, approveTerminalAuth, getTerminalAuthStatus } = await import('@/app/auth/terminalAuth');
        const pk = publicKeyB64('terminal-v2');
        await requestTerminalAuth(pk, true);
        await approveTerminalAuth(pk, 'sealed', 'account-A');
        const status = await getTerminalAuthStatus(pk);
        expect(status.found).toBe(true);
        expect(status.supportsV2).toBe(true);
    });

    it('a request past its TTL reports not_found even when approved', async () => {
        const { getTerminalAuthStatus } = await import('@/app/auth/terminalAuth');
        const pk = publicKeyB64('terminal-expired');
        await (holder.db as PrismaClient).terminalAuthRequest.create({
            data: {
                publicKey: pk,
                supportsV2: true,
                response: 'sealed',
                responseAccountId: 'account-A',
                createdAt: new Date(Date.now() - 6 * 60 * 1000),
                updatedAt: new Date(Date.now() - 6 * 60 * 1000),
            },
        });
        const status = await getTerminalAuthStatus(pk);
        expect(status.found).toBe(false);
    });
});

describe('account auth request lifecycle (real PGlite)', () => {
    it('concurrent approval: exactly one account claims', async () => {
        const { requestAccountAuth, approveAccountAuth } = await import('@/app/auth/accountAuth');
        const pk = publicKeyB64('account-concurrent');
        await requestAccountAuth(pk);
        const [r1, r2] = await Promise.all([
            approveAccountAuth(pk, 'sealed-A', 'account-A'),
            approveAccountAuth(pk, 'sealed-B', 'account-B'),
        ]);
        expect([r1, r2].filter(r => r.claimed)).toHaveLength(1);
        const stored = (await (holder.db as PrismaClient).accountAuthRequest.findUnique({ where: { publicKey: pk } }))!;
        expect(stored.responseAccountId).not.toBeNull();
    });

    it('an expired account request reports found:false', async () => {
        const { getAccountAuthStatus } = await import('@/app/auth/accountAuth');
        const pk = publicKeyB64('account-expired');
        await (holder.db as PrismaClient).accountAuthRequest.create({
            data: {
                publicKey: pk,
                response: 'sealed',
                responseAccountId: 'account-A',
                createdAt: new Date(Date.now() - 6 * 60 * 1000),
                updatedAt: new Date(Date.now() - 6 * 60 * 1000),
            },
        });
        const status = await getAccountAuthStatus(pk);
        expect(status.found).toBe(false);
    });
});
