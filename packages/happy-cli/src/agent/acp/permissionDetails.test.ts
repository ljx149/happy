import { expect, test } from 'vitest';
import { PermissionDetails, permissionOption } from './permissionDetails';

test('resolves reference-only DSH approvals against streamed tool details', () => {
  const details = new PermissionDetails();
  details.remember({ sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Write file', rawInput: { path: '/tmp/review.txt', content: 'review' } });
  details.remember({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'pending', rawInput: null });
  expect(details.resolve({ toolCall: { toolCallId: 'call-1' } }, 'random')).toEqual({ id: 'call-1', toolName: 'Write file', input: { path: '/tmp/review.txt', content: 'review' } });
});
test('preserves canonical details and separates concurrent tool calls', () => {
  const details = new PermissionDetails();
  details.remember({ sessionUpdate: 'tool_call', toolCallId: 'other', title: 'Other', rawInput: { path: '/other' } });
  expect(details.resolve({ toolCall: { toolCallId: 'new', title: 'Read', rawInput: { path: '/new' } } }, 'random')).toEqual({ id: 'new', toolName: 'Read', input: { path: '/new' } });
});
test('retains legacy permission fields without guessing missing details', () => {
  const details = new PermissionDetails();
  expect(details.resolve({ toolCall: { id: 'old', kind: 'read', input: { file: 'a' } } }, 'random')).toEqual({ id: 'old', toolName: 'read', input: { file: 'a' } });
  expect(details.resolve({ toolCall: { toolCallId: 'missing' } }, 'random')).toEqual({ id: 'missing', toolName: 'Unknown tool', input: {} });
});

test('chooses canonical permission kinds even when deny is first or names are localized', () => {
  const options = [{ optionId: 'no', kind: 'reject_once' }, { optionId: 'yes', kind: 'allow_once' }];
  expect(permissionOption(options, true)).toBe('yes');
  expect(permissionOption(options, false)).toBe('no');
  expect(permissionOption([{ optionId: 'no', kind: 'reject_once' }], true)).toBeUndefined();
  expect(permissionOption([{ optionId: 'proceed_once' }], true)).toBe('proceed_once');
});
