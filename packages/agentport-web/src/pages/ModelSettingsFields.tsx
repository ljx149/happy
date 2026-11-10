import { useId } from 'react';
import { label } from '../lib/account';
import { effortChoices, reportedChoices, type ModelSettings } from '../lib/modelSettings';

export function ModelSettingsFields({ agent, metadata, value, onChange, starting = false }: {
  agent: string; metadata?: unknown; value: ModelSettings; onChange: (value: ModelSettings) => void; starting?: boolean;
}) {
  const listId = useId();
  const models = reportedChoices(metadata, 'models');
  const efforts = effortChoices(agent, metadata);
  const native = agent === 'claude' || agent === 'codex';
  return <fieldset className="model-settings"><legend>模型设置</legend>
    <label>模型{native ? <><input aria-label="模型" list={listId} value={value.model} onChange={e => onChange({ model: e.target.value, effort: '' })} placeholder="留空：不额外指定模型" />
      <datalist id={listId}>{models.map(m => <option key={m.code} value={m.code}>{m.value}</option>)}</datalist></>
      : <select aria-label="模型" value={value.model} disabled={!models.length} onChange={e => onChange({ model: e.target.value, effort: '' })}>
        <option value="">保持运行器当前模型</option>{models.map(m => <option key={m.code} value={m.code}>{m.value}</option>)}
      </select>}</label>
    <label>推理强度<select aria-label="推理强度" value={value.effort} disabled={!efforts.length} onChange={e => onChange({ ...value, effort: e.target.value })}>
      <option value="">不额外指定</option>{efforts.map(e => <option key={e.code} value={e.code}>{e.value}</option>)}
    </select></label>
    <p className="hint">{starting ? '默认沿用电脑上 Agent 的配置；自定义模型须与该电脑配置的服务商匹配。' : '选择随下一条消息发送；恢复本机默认配置请新建会话。'}
      {!native && (starting ? ' DSH 启动后可选择运行器上报的模型。' : ' DSH 推理强度需要 CLI 1.2.8 及运行器提供选项。')}
      {label(metadata, 'currentModelCode') && ` 当前上报模型：${label(metadata, 'currentModelCode')}。`}
    </p>
  </fieldset>;
}
