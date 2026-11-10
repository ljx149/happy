import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../standalone';

it('registers and reads machines with encrypted byte keys through the real PGlite adapter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentport-bytes-'));
    let pg: PGlite | undefined;
    let db: PrismaClient | undefined;
    try {
        await runMigrations({ pgliteDir: dir });
        pg = new PGlite(dir);
        db = new PrismaClient({ adapter: new PrismaPGlite(pg) } as any);
        const account = await db.account.create({ data: { publicKey: 'bytes-regression' } });
        const key = Uint8Array.from({ length: 105 }, (_, i) => (i * 31) % 256);
        const machine = await db.machine.create({ data: {
            id: 'encrypted-device', accountId: account.id,
            metadata: 'encrypted-metadata', dataEncryptionKey: key,
        } });
        expect(machine.dataEncryptionKey).toEqual(key);
        const machines = await db.machine.findMany({ where: { accountId: account.id } });
        expect(machines).toHaveLength(1);
        expect(machines[0].dataEncryptionKey).toEqual(key);
        await db.machine.update({ where: { id: machine.id }, data: { daemonState: 'online' } });
        expect((await db.machine.findUniqueOrThrow({ where: { id: machine.id } })).dataEncryptionKey).toEqual(key);
    } finally {
        await db?.$disconnect();
        await pg?.close();
        await rm(dir, { recursive: true, force: true });
    }
}, 20000);
