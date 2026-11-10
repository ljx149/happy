import { expect, test } from 'vitest';
import { messageModelMeta, effortChoices, reportedChoices } from './modelSettings';
test('empty native picks explicitly clear old CLI hard-coded model and effort overrides', () => {
  for (const agent of ['codex', 'claude']) expect(messageModelMeta(agent, { model: '', effort: '' })).toEqual({ model: null, effort: null });
});
test('custom model IDs and effort reach the message metadata without changing providers', () => {
  expect(messageModelMeta('codex', { model: ' my-local-model ', effort: 'high' }, { modelReasoningEfforts: { 'my-local-model': [{ code: 'high', value: 'high' }] } })).toEqual({ model: 'my-local-model', effort: 'high' });
});
test('ACP choices come from the runner and effort requires a compatible CLI', () => {
  const metadata = { version: '1.2.8', models: [{ code: 'p:m', value: 'My model' }], thoughtLevels: [{ code: 'deep', value: 'Deep' }] };
  expect(messageModelMeta('acp', { model: 'p:m', effort: 'deep' }, metadata)).toEqual({ model: 'p:m', effort: 'deep' });
  expect(() => messageModelMeta('acp', { model: 'not-advertised', effort: '' }, metadata)).toThrow();
  expect(effortChoices('acp', { ...metadata, version: '1.2.7' })).toEqual([]);
  expect(() => messageModelMeta('acp', { model: '', effort: 'deep' }, { ...metadata, version: '1.2.7' })).toThrow();
  expect(messageModelMeta('acp', { model: '', effort: '' }, metadata)).toEqual({});
  expect(reportedChoices({ models: [{ code: 3 }, null] }, 'models')).toEqual([]);
});

test('Codex effort options are model-specific and never invented for custom providers', () => {
  const metadata = { currentModelCode: 'a', modelReasoningEfforts: { a: [{ code: 'low', value: 'low' }], b: [{ code: 'high', value: 'high' }] } };
  expect(effortChoices('codex', metadata)).toEqual([{ code: 'low', value: 'low' }]);
  expect(effortChoices('codex', metadata, 'b')).toEqual([{ code: 'high', value: 'high' }]);
  expect(effortChoices('codex', metadata, 'custom')).toEqual([]);
  expect(() => messageModelMeta('codex', { model: 'b', effort: 'low' }, metadata)).toThrow();
});
