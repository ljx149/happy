import { field, label, messageText } from './account';

export type ChatRow = { id: string; kind: 'user' | 'agent' | 'thinking' | 'tool' | 'event'; text: string; detail?: string; call?: string; ended?: boolean };
export type ChatUpdate = ChatRow | { kind: 'tool-end'; call: string };
const generic = (v: string | undefined) => !v || /^(other|unknown|unknown tool|running other)$/i.test(v);
const details = (v: unknown) => v && typeof v === 'object' && Object.keys(v).length ? JSON.stringify(v, null, 2) : undefined;

export function conversationUpdates(id: string, value: unknown): ChatUpdate[] {
  const content = field(value, 'content');
  const event = field(content, 'ev');
  const t = label(event, 't');
  const call = [label(content, 'turn') ?? '', label(content, 'subagent') ?? '', label(event, 'call') ?? id].join(':');
  if (t === 'service' && !label(event, 'text')) return [];
  if (t === 'text' && field(event, 'thinking') === true) {
    const text = label(event, 'text');
    return text ? [{ id, kind: 'thinking', text }] : [];
  }
  if (t === 'tool-call-end') return [{ kind: 'tool-end', call }];
  if (t === 'tool-call-start') {
    const title = label(event, 'title');
    const name = label(event, 'name');
    const description = label(event, 'description');
    return [{ id, kind: 'tool', call, text: !generic(title) ? title! : !generic(name) ? name! : '工具调用',
      detail: [!generic(description) ? description : undefined, details(field(event, 'args'))].filter(Boolean).join('\n') || undefined }];
  }
  const blocks = field(field(field(content, 'data'), 'message'), 'content');
  if (Array.isArray(blocks) && field(value, 'role') !== 'user') {
    return blocks.flatMap((block, index): ChatUpdate[] => {
      const type = label(block, 'type');
      const rowId = `${id}:${index}`;
      if (type === 'thinking') return label(block, 'thinking') ? [{ id: rowId, kind: 'thinking', text: label(block, 'thinking')! }] : [];
      if (type === 'text') return label(block, 'text') ? [{ id: rowId, kind: 'agent', text: label(block, 'text')! }] : [];
      if (type === 'tool_use') return [{ id: rowId, kind: 'tool', call: label(block, 'id'), text: label(block, 'name') ?? '工具调用', detail: details(field(block, 'input')) }];
      if (type === 'redacted_thinking') return [];
      return [];
    });
  }
  const role = field(value, 'role') === 'session' ? field(content, 'role') : field(value, 'role');
  const text = messageText(value);
  return text ? [{ id, kind: role === 'user' ? 'user' : t === 'service' || t === 'turn-end' ? 'event' : 'agent', text }] : [];
}

export function mergeChatUpdates(rows: ChatRow[], updates: ChatUpdate[]): ChatRow[] {
  const next = [...rows];
  for (const update of updates) {
    if (update.kind === 'tool-end') {
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === 'tool' && next[i].call === update.call) { next[i] = { ...next[i], ended: true }; break; }
      }
    } else if (!next.some(row => row.id === update.id)) next.push(update);
  }
  return next;
}
