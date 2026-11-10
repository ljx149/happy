import { useId } from 'react';
import { label } from '../lib/account';
import { effortChoices, reportedChoices, type ModelSettings } from '../lib/modelSettings';

export function ModelSettingsFields({ agent, metadata, value, onChange, starting = false }: {
  agent: string; metadata?: unknown; value: ModelSettings; onChange: (value: ModelSettings) => void; starting?: boolean;
}) {
  const listId = useId();
  const models = reportedChoices(metadata, 'models');
  const efforts = effortChoices(agent, metadata, value.model);
  const native = agent === 'claude' || agent === 'codex';
  const current = label(metadata, 'currentModelCode');
  const currentName = models.find(m => m.code === current)?.value ?? current;
  const source = label(metadata, 'modelCatalogSource');
  return <fieldset className="model-settings"><legend>模型设置</legend>
    <label>模型{!models.length && native ? <><input aria-label="模型" list={listId} value={value.model} onChange={e => onChange({ model: e.target.value, effort: '' })} placeholder="留空：使用本机配置" />
      <datalist id={listId} /></>
      : <select aria-label="模型" value={value.model} disabled={!models.length} onChange={e => onChange({ model: e.target.value, effort: '' })}>
        <option value="">{currentName ? `当前：${currentName}` : '保持运行器当前模型'}</option>
        {value.model && !models.some(m => m.code === value.model) && <option value={value.model}>{value.model}（未在列表中）</option>}
        {models.map(m => <option key={m.code} value={m.code}>{m.value}</option>)}
      </select>}</label>
    <label>推理强度<select aria-label="推理强度" value={value.effort} disabled={!efforts.length} onChange={e => onChange({ ...value, effort: e.target.value })}>
      <option value="">{label(metadata, 'currentThoughtLevelCode') && !value.model ? `当前：${label(metadata, 'currentThoughtLevelCode')}` : '沿用运行器配置'}</option>{efforts.map(e => <option key={e.code} value={e.code}>{e.value}</option>)}
    </select></label>
    <p className="hint">{starting ? '创建会话后读取该电脑运行器的模型列表；留空沿用运行器配置。' : '选择随下一条消息发送。'}
      {source === 'codex-app-server' && ` 模型列表由电脑上的 Codex 提供${label(metadata, 'modelProvider') ? `，当前服务商：${label(metadata, 'modelProvider')}` : ''}。自定义服务商不一定支持列表中的全部模型。`}
      {source === 'dsh-acp-profile' && ' 当前使用电脑上的 DSH acp 配置，它可能与日常使用的配置不同；请选择对应服务商的模型。'}
      {!starting && !models.length && ' 运行器尚未上报模型列表；Codex 请使用 CLI 1.2.9 或更新版本。'}
      {!starting && !efforts.length && ' 运行器尚未提供所选模型的推理强度选项。'}
    </p>
  </fieldset>;
}
