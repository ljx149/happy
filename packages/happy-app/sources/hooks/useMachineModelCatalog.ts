import * as React from 'react';
import { z } from 'zod';
import { apiSocket } from '@/sync/apiSocket';
import { MetadataSchema, type Metadata } from '@/sync/storageTypes';
import { compareVersionsWithPrerelease, isWellFormedVersion } from '@/utils/versionUtils';

const Reply = z.object({ ok: z.literal(true), agent: z.string(), directory: z.string(), fetchedAt: z.number(), catalog: MetadataSchema.pick({
    models: true, currentModelCode: true, modelReasoningEfforts: true, thoughtLevels: true,
    currentThoughtLevelCode: true, modelProvider: true, modelCatalogSource: true,
}) });
const errors: Record<string, string> = {
    BUSY: '电脑正在读取另一组配置，请稍后重试。',
    DIRECTORY_NOT_FOUND: '电脑上不存在所选目录，请先选择已有目录。',
    NO_MODELS_REPORTED: '运行器没有返回模型列表，请检查电脑端的配置。',
    TIMEOUT: '读取超时，请确认电脑端运行器能够正常启动后重试。',
    RUNTIME_UNAVAILABLE: '无法初始化运行器，请检查电脑端的安装、登录和配置后重试。',
};
export function useMachineModelCatalog(machineId: string | undefined, directory: string | null, agent: string, cliVersion: string | undefined, online: boolean) {
    const [attempt, retry] = React.useReducer(n => n + 1, 0);
    const key = JSON.stringify([machineId, directory, agent, cliVersion, online, attempt]);
    const [state, setState] = React.useState<{ key: string; loading: boolean; metadata?: Metadata; error?: string }>({ key: '', loading: false });
    React.useEffect(() => {
        let active = true;
        if (!['claude', 'codex', 'dsh'].includes(agent) || !machineId || !directory) {
            setState({ key, loading: false }); return;
        }
        if (!online) { setState({ key, loading: false, error: '电脑离线，请先启动 agentport daemon。' }); return; }
        if (!cliVersion || !isWellFormedVersion(cliVersion) || compareVersionsWithPrerelease(cliVersion, '1.2.10') < 0) {
            setState({ key, loading: false, error: '实时读取需要电脑端 AgentPort CLI 1.2.10 或更新版本；升级后重启 daemon。' }); return;
        }
        setState({ key, loading: true });
        const timer = setTimeout(async () => {
            try {
                const raw = await apiSocket.machineRPC<any, { agent: string; directory: string }>(machineId, 'read-model-catalog', { agent, directory });
                if (!active) return;
                if (raw?.ok !== true) {
                    setState({ key, loading: false, error: errors[raw?.error] ?? '读取失败，请升级 CLI 并重启 daemon 后重试。' }); return;
                }
                const result = Reply.parse(raw);
                if (result.agent !== agent || result.directory !== directory) throw new Error('Mismatched discovery target');
                setState({ key, loading: false, metadata: {
                    ...result.catalog, path: directory, host: '', machineId,
                    flavor: agent === 'dsh' ? 'acp' : agent, agentName: agent, version: cliVersion,
                } });
            } catch {
                if (active) setState({ key, loading: false, error: '无法连接电脑的配置读取接口，请确认已升级 CLI 并重启 daemon，再重试。' });
            }
        }, 500);
        return () => { active = false; clearTimeout(timer); };
    }, [key, machineId, directory, agent, cliVersion, online]);
    return { ...(state.key === key ? state : { key, loading: !!machineId && !!directory, metadata: undefined, error: undefined }), retry };
}
