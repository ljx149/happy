import { field, label } from './account';
export type ModelSettings = { model: string; effort: string };
export type Choice = { code: string; value: string };
export function reportedChoices(metadata: unknown, name: string): Choice[] {
  const values = field(metadata, name);
  return Array.isArray(values) ? values.flatMap(v => {
    const code = label(v, 'code');
    return code ? [{ code, value: label(v, 'value') ?? code }] : [];
  }) : [];
}
export function supportsAcpEffort(metadata: unknown): boolean {
  const v = (label(metadata, 'version') ?? '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return !!v && (Number(v[1]) > 1 || Number(v[1]) === 1 && (Number(v[2]) > 2 || Number(v[2]) === 2 && Number(v[3]) >= 8));
}
export function effortChoices(agent: string, metadata?: unknown, model = ''): Choice[] {
  if (agent === 'codex') {
    const code = model || label(metadata, 'currentModelCode') || '';
    return reportedChoices({ levels: field(field(metadata, 'modelReasoningEfforts'), code) }, 'levels');
  }
  const levels = agent === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : [];
  if (levels.length) return levels.map(code => ({ code, value: code }));
  if (model && label(metadata, 'currentModelCode') && model !== label(metadata, 'currentModelCode')) return [];
  return supportsAcpEffort(metadata) ? reportedChoices(metadata, 'thoughtLevels') : [];
}
export function messageModelMeta(agent: string, settings: ModelSettings, metadata?: unknown) {
  const model = settings.model.trim();
  const effort = settings.effort;
  if (effort && !effortChoices(agent, metadata, model).some(v => v.code === effort)) throw new Error('该 Agent 或模型尚不支持所选推理强度，请重新选择。');
  if (agent === 'codex' || agent === 'claude') return { model: model || null, effort: effort || null };
  if (model && !reportedChoices(metadata, 'models').some(v => v.code === model)) throw new Error('所选模型已不在运行器提供的列表中，请重新选择。');
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

export function loadModelSettings(id: string): ModelSettings {
  try {
    const value = JSON.parse(sessionStorage.getItem('agentport-model-settings:' + id) ?? '{}');
    return { model: typeof value.model === 'string' ? value.model : '', effort: typeof value.effort === 'string' ? value.effort : '' };
  } catch { return { model: '', effort: '' }; }
}
export function saveModelSettings(id: string, value: ModelSettings) {
  try { sessionStorage.setItem('agentport-model-settings:' + id, JSON.stringify(value)); } catch { /* Storage may be disabled. */ }
}
