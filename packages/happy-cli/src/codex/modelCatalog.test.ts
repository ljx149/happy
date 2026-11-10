import { expect, test } from 'vitest';
import { codexModelMetadata } from './modelCatalog';

test('retains local provider model and publishes only public settings', () => {
    const result = codexModelMetadata({ config: { model: 'local-model', model_provider: 'private-gateway', model_reasoning_effort: 'high', api_key: 'SECRET', model_providers: { private: { bearer: 'SECRET' } } } }, { data: [{ model: 'catalog-model', displayName: 'Catalog', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] });
    expect(result.currentModelCode).toBe('local-model');
    expect(result.modelProvider).toBe('private-gateway');
    expect(result.currentThoughtLevelCode).toBe('high');
    expect(result.models?.map(m => m.code)).toEqual(['local-model', 'catalog-model']);
    expect(result.modelReasoningEfforts?.['local-model']).toEqual([]);
    expect(result.modelReasoningEfforts?.['catalog-model']).toEqual([{ code: 'low', value: 'low' }]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
});
test('uses the runtime default and handles unavailable/older discovery APIs', () => {
    expect(codexModelMetadata(null, { data: [{ model: 'native', isDefault: true, defaultReasoningEffort: 'medium' }] }).currentModelCode).toBe('native');
    expect(codexModelMetadata(null, null).models).toEqual([]);
    expect(codexModelMetadata({}, { data: [{ model: 'hidden', hidden: true }, null, {}] }).models).toEqual([]);
});
