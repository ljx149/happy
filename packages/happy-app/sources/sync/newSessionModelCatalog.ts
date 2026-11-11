import type { Session, Metadata } from './storageTypes';
import { resolveAbsolutePath } from '@/utils/pathUtils';

// Never borrow model/provider configuration from another machine, harness or directory.
export function findNewSessionModelCatalog(
    sessions: readonly Pick<Session, 'metadata' | 'updatedAt'>[],
    machineIds: readonly string[],
    agent: string,
    path: string | null | undefined,
    homeDir?: string,
): Metadata | undefined {
    const normalize = (value: string, home?: string) => resolveAbsolutePath(value.trim(), home).replace(/[/\\]+$/, '') || '/';
    if (!path?.trim() || !machineIds.length) return undefined;
    const target = normalize(path, homeDir);
    const latest = sessions.filter(({ metadata: m }) => m && m.machineId && machineIds.includes(m.machineId)
        && (m.agentName === 'dsh' ? 'dsh' : m.flavor) === agent
        && normalize(m.path, m.homeDir ?? homeDir) === target)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.metadata;
    return latest?.models?.length ? latest : undefined;
}
