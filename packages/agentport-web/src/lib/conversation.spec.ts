import { expect, test } from 'vitest';
import { conversationUpdates, mergeChatUpdates } from './conversation';
const envelope = (ev: unknown, extra = {}) => ({ role: 'session', content: { role: 'agent', turn: 'turn-1', ev, ...extra } });
test('usage-only services disappear but service errors remain visible', () => {
 expect(conversationUpdates('1', envelope({ t: 'service', text: '' }, { usage: { input_tokens: 1 } }))).toEqual([]);
 expect(conversationUpdates('2', envelope({ t: 'service', text: 'Provider error' }))[0]).toMatchObject({ kind: 'event', text: 'Provider error' });
});
test('DSH thinking and answer remain distinct', () => {
 expect(conversationUpdates('1', envelope({ t: 'text', text: 'reasoning', thinking: true }))[0]).toMatchObject({ kind: 'thinking' });
 expect(conversationUpdates('2', envelope({ t: 'text', text: 'answer' }))[0]).toMatchObject({ kind: 'agent' });
});
test('generic tools get a neutral title; completion merges across pages without implying success', () => {
 const first = conversationUpdates('1', envelope({ t: 'tool-call-start', call: 'c', title: 'other', name: 'other', description: 'Running other', args: {} }));
 const rows = mergeChatUpdates([], first);
 expect(rows[0]).toMatchObject({ kind: 'tool', text: '工具调用' });
 expect(rows[0].detail).toBeUndefined();
 const done = mergeChatUpdates(rows, conversationUpdates('2', envelope({ t: 'tool-call-end', call: 'c' })));
 expect(done).toHaveLength(1); expect(done[0].ended).toBe(true);
 expect(mergeChatUpdates(done, first)).toHaveLength(1);
});
test('tool arguments are retained and same call IDs in other turns do not collide', () => {
 const start = { t: 'tool-call-start', call: 'c', title: '检查目录', args: { command: 'pwd' } };
 const rows = mergeChatUpdates([], [...conversationUpdates('1', envelope(start)), ...conversationUpdates('2', envelope(start, { turn: 'turn-2' }))]);
 const done = mergeChatUpdates(rows, conversationUpdates('3', envelope({ t: 'tool-call-end', call: 'c' })));
 expect(done[0].detail).toContain('pwd');expect(done[0].ended).toBe(true);expect(done[1].ended).toBeUndefined();
});
test('mixed Claude thinking/text/tool blocks become separate rows', () => {
 const rows = conversationUpdates('1', { role: 'agent', content: { data: { message: { content: [{ type: 'thinking', thinking: 'reasoning' }, { type: 'text', text: 'answer' }, { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'pwd' } }] } } } });
 expect(rows.map(r => r.kind)).toEqual(['thinking', 'agent', 'tool']);
});
