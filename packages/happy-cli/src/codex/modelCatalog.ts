import type { Metadata } from '@/api/types';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const text = (v: unknown): string | undefined => typeof v === 'string' && v.length > 0 ? v : undefined;

/** Whitelist public model settings; never publish raw config/provider credentials. */
export function codexModelMetadata(configResponse: unknown, modelsResponse: unknown): Partial<Metadata> {
    const config = record(record(configResponse).config);
    const data = record(modelsResponse).data;
    const models: NonNullable<Metadata['models']> = [];
    const modelReasoningEfforts: NonNullable<Metadata['modelReasoningEfforts']> = {};
    for (const value of Array.isArray(data) ? data : []) {
        const model = record(value);
        const code = text(model.model);
        if (!code || model.hidden === true || models.some(m => m.code === code)) continue;
        models.push({ code, value: text(model.displayName) ?? code });
        modelReasoningEfforts[code] = (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []).flatMap(e => {
            const code = text(record(e).reasoningEffort);
            return code ? [{ code, value: code }] : [];
        });
    }
    const fallback = (Array.isArray(data) ? data : []).map(record).find(m => m.isDefault === true);
    const currentModelCode = text(config.model) ?? text(fallback?.model);
    // A custom provider may configure a model absent from Codex's own catalog.
    if (currentModelCode && !models.some(m => m.code === currentModelCode)) {
        models.unshift({ code: currentModelCode, value: `${currentModelCode} · 本机配置` });
        modelReasoningEfforts[currentModelCode] = [];
    }
    return { models, modelReasoningEfforts, currentModelCode,
        modelProvider: text(config.model_provider),
        currentThoughtLevelCode: text(config.model_reasoning_effort) ?? (currentModelCode === text(fallback?.model) ? text(fallback?.defaultReasoningEffort) : undefined),
        modelCatalogSource: 'codex-app-server' };
}
