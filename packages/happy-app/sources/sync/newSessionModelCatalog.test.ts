import { describe, it, expect } from 'vitest';
import { findNewSessionModelCatalog } from './newSessionModelCatalog';
import { MetadataSchema } from './storageTypes';

const row = (machineId: string, path: string, flavor: string, updatedAt = 1, models = [{ code: 'private-model', value: 'Private model' }]) => ({
    updatedAt,
    metadata: MetadataSchema.parse({ machineId, path, host: 'computer', homeDir: '/home/me', flavor, models }),
});
describe('new session model catalog boundaries', () => {
    it('reads only the selected computer, harness and directory, resolving home paths', () => {
        const right = row('mine', '/home/me/project', 'codex');
        expect(findNewSessionModelCatalog([row('other', '/home/me/project', 'codex', 9), row('mine', '/elsewhere', 'codex', 10), row('mine', '/home/me/project', 'claude', 11), right], ['mine'], 'codex', '~/project/', '/home/me')).toEqual(right.metadata);
    });
    it('uses the latest matching report and does not revive a withdrawn catalog', () => {
        expect(findNewSessionModelCatalog([row('mine', '/work', 'codex'), row('mine', '/work', 'codex', 2, [])], ['mine'], 'codex', '/work')).toBeUndefined();
    });
    it('preserves opaque DSH provider codes and does not mix generic ACP sessions', () => {
        const dsh = row('mine', '/work', 'acp');
        dsh.metadata.agentName = 'dsh';
        dsh.metadata.models = [{ code: '["private","model"]', value: 'Mine' }];
        expect(findNewSessionModelCatalog([dsh, row('mine', '/work', 'acp', 3)], ['mine'], 'dsh', '/work')?.models?.[0].code).toBe('["private","model"]');
    });
    it('does not invent discovery before a computer and directory are chosen', () => {
        expect(findNewSessionModelCatalog([row('mine', '/work', 'codex')], [], 'codex', '/work')).toBeUndefined();
        expect(findNewSessionModelCatalog([row('mine', '/work', 'codex')], ['mine'], 'codex', null)).toBeUndefined();
    });
});
