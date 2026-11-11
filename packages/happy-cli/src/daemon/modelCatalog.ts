import { hasRequiredDshModel } from '@/agent/acp/dshEligibility';
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { Metadata } from '@/api/types';
import { CodexAppServerClient } from '@/codex/codexAppServerClient';
import { createAcpBackend } from '@/agent/acp/createAcpBackend';
import { resolveAcpAgentConfig } from '@/agent/acp/acpAgentConfig';
import { type AcpSessionConfigSnapshot, extractConfigOptionsFromPayload, extractModelStateFromPayload, mergeAcpSessionConfigIntoMetadata } from '@/agent/acp/sessionConfigMetadata';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const Request = z.object({ agent: z.enum(['claude', 'codex', 'dsh']), directory: z.string().min(1).max(4096) });
const Choice = z.object({ code: z.string(), value: z.string() });
// An explicit output whitelist: never serialize raw runtime config or account data.
export const PublicModelCatalog = z.object({
    models: z.array(Choice), currentModelCode: z.string().optional(),
    modelReasoningEfforts: z.record(z.string(), z.array(Choice)).optional(),
    thoughtLevels: z.array(Choice).optional(), currentThoughtLevelCode: z.string().optional(),
    modelProvider: z.string().optional(), modelCatalogSource: z.string(),
});
let running = false;
export async function queryMachineModelCatalog(input: unknown) {
    const parsed = Request.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: 'INVALID_REQUEST' };
    if (running) return { ok: false as const, error: 'BUSY' };
    const { agent } = parsed.data;
    const raw = parsed.data.directory;
    let directory = raw === '~' ? homedir() : raw.startsWith('~/') ? resolve(homedir(), raw.slice(2)) : raw;
    // A new DSH workspace inherits its nearest existing ancestor's configuration.
    // The daemon rechecks in the actual directory after approved creation.
    if (agent === 'dsh' && isAbsolute(directory)) {
        while (!(await stat(directory).catch(() => null)) && dirname(directory) !== directory) directory = dirname(directory);
    }
    if (!isAbsolute(directory) || !(await stat(directory).catch(() => null))?.isDirectory()) {
        return { ok: false as const, error: 'DIRECTORY_NOT_FOUND' };
    }
    if (running) return { ok: false as const, error: 'BUSY' };
    running = true;
    let cleanup: () => void | Promise<void> = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const work = async () => {
            if (agent === 'codex') {
                const client = new CodexAppServerClient(undefined, directory);
                cleanup = () => client.disconnect();
                await client.connect();
                const metadata = await client.getModelMetadata(directory, true);
                return PublicModelCatalog.parse(metadata);
            }
            if (agent === 'dsh') {
                const config = resolveAcpAgentConfig(['dsh']);
                const backend = createAcpBackend({ ...config, cwd: directory, mcpServers: {}, permissionHandler: { handleToolCall: async () => ({ decision: 'denied' }) } });
                cleanup = () => backend.dispose();
                let metadata = { path: directory, host: 'local', homeDir: homedir(), happyHomeDir: '', happyLibDir: '', happyToolsDir: '', modelCatalogSource: 'dsh-acp-profile', models: [] } as Metadata;
                const snapshot: AcpSessionConfigSnapshot = {};
                backend.onMessage(message => {
                    if (message.type !== 'event') return;
                    if (message.name === 'models_update') {
                        const models = extractModelStateFromPayload(message.payload);
                        if (models) snapshot.models = models;
                    }
                    if (message.name === 'config_options_update') {
                        const configOptions = extractConfigOptionsFromPayload(message.payload);
                        if (configOptions) snapshot.configOptions = configOptions;
                    }
                });
                // Initialize the same ACP profile used by normal sessions, without a prompt.
                await backend.startSession();
                metadata = mergeAcpSessionConfigIntoMetadata(metadata, snapshot);
                return PublicModelCatalog.parse(metadata);
            }
            let release!: () => void;
            const gate = new Promise<void>(r => { release = r; });
            async function* emptyPrompt(): AsyncGenerator<SDKUserMessage> { await gate; }
            const controller = new AbortController();
            const client = query({ prompt: emptyPrompt(), options: {
                cwd: directory, settingSources: ['user', 'project', 'local'],
                persistSession: false, tools: [], mcpServers: {}, strictMcpConfig: true,
                abortController: controller, canUseTool: async () => ({ behavior: 'deny', message: 'Model discovery only' }),
            } });
            cleanup = () => { release(); controller.abort(); client.close(); };
            const models = await client.supportedModels();
            return PublicModelCatalog.parse({
                modelCatalogSource: 'claude-sdk',
                models: models.map(model => ({ code: model.value, value: model.resolvedModel ? `${model.displayName} · ${model.resolvedModel}` : model.displayName })),
                modelReasoningEfforts: Object.fromEntries(models.map(model => [model.value,
                    (model.supportsEffort ? model.supportedEffortLevels ?? [] : []).map(code => ({ code, value: code })),
                ])),
            });
        };
        const catalog = await Promise.race([work(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('DISCOVERY_TIMEOUT')), 35_000);
        })]);
        if (!catalog.models.length) return { ok: false as const, error: 'NO_MODELS_REPORTED' };
        return { ok: true as const, agent, directory: raw, fetchedAt: Date.now(), catalog,
            ...(agent === 'dsh' ? { dshEligibility: { allowed: hasRequiredDshModel(catalog.models) } } : {}),
        };
    } catch (error) {
        return { ok: false as const, error: error instanceof Error && error.message === 'DISCOVERY_TIMEOUT' ? 'TIMEOUT' : 'RUNTIME_UNAVAILABLE' };
    } finally {
        if (timer) clearTimeout(timer);
        await Promise.resolve().then(cleanup).catch(() => {});
        running = false;
    }
}
