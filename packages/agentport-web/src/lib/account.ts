import { contentKeys, decryptRecord, unwrapKey } from './protocol.ts';
import type * as api from './api.ts';

export type Account = { token: string; keys: Awaited<ReturnType<typeof contentKeys>> };

export interface DeviceAgentSupport {
  claude: boolean;
  codex: boolean;
  dsh: boolean;
}

export function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

export function label(value: unknown, name: string): string | undefined {
  const text = field(value, name);
  return typeof text === 'string' && text.trim() ? text : undefined;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

export function messageText(value: unknown): string {
  const content = field(value, 'content');
  const data = field(content, 'data');
  const event = field(content, 'ev');
  if (field(event, 't') === 'service' && !label(event, 'text')) return '';
  if (['turn-start', 'start', 'stop', 'tool-call-end'].includes(String(field(event, 't')))) return '';
  if (field(event, 't') === 'tool-call-start') return `工具：${label(event, 'title') ?? label(event, 'name') ?? '执行操作'}${label(event, 'description') ? '\n' + label(event, 'description') : ''}`;
  if (field(event, 't') === 'file') return `文件：${label(event, 'name') ?? label(event, 'ref') ?? '附件'}`;
  if (field(event, 't') === 'turn-end') return field(event, 'status') === 'failed' ? '本轮执行失败，请查看上方错误信息。' : field(event, 'status') === 'cancelled' ? '本轮已取消。' : '';
  if (['ready', 'usage', 'token_count'].includes(String(field(data, 'type')))) return '';
  if (field(data, 'type') === 'system' && ['init', 'status'].includes(String(field(data, 'subtype')))) return '';
  const blocks = field(field(data, 'message'), 'content');
  if (Array.isArray(blocks)) {
    const text = blocks.filter(block => field(block, 'type') === 'text').map(block => label(block, 'text') ?? '').join('\n');
    if (text) return text;
    const tools = blocks.filter(block => field(block, 'type') === 'tool_use').map(block => `工具：${label(block, 'name') ?? '执行操作'}`);
    if (tools.length) return tools.join('\n');
    if (blocks.every(block => ['thinking', 'redacted_thinking', 'tool_result'].includes(String(field(block, 'type'))))) return '';
  }
  return label(content, 'text') ?? label(field(content, 'ev'), 'text') ?? label(data, 'text') ?? label(data, 'message') ?? label(field(data, 'message'), 'text') ?? `未识别的事件：${label(event, 't') ?? label(data, 'type') ?? label(content, 'type') ?? 'unknown'}`;
}

async function decodeSessionTitle(record: api.RecordSummary, account: Account, fallback: string) {
  let title = fallback + ' · ' + record.id.slice(0, 8);
  if (record.dataEncryptionKey) {
    try {
      const metadata = await decryptRecord(record.metadata, unwrapKey(record.dataEncryptionKey, account.keys.secretKey));
      title = label(metadata, 'name') ?? label(metadata, 'host') ?? label(metadata, 'path') ?? title;
    } catch {
      // Keep corrupt or foreign records visible with their identifier.
    }
  }
  return { ...record, title };
}

export async function sessionSummaries(records: api.RecordSummary[], account: Account, fallback: string) {
  return Promise.all(records.map(record => decodeSessionTitle(record, account, fallback)));
}

/**
 * Decrypt a device's metadata and report which agents it advertises as
 * available. Legacy (no dataEncryptionKey) machines and anything that fails
 * to decrypt or parse are treated as supporting nothing rather than throwing,
 * so the caller can hide each agent option per-device instead of guessing.
 */
export async function deviceAgentSupport(record: api.RecordSummary, contentSecretKey: Uint8Array): Promise<DeviceAgentSupport> {
  const unsupported: DeviceAgentSupport = { claude: false, codex: false, dsh: false };
  if (!record.dataEncryptionKey) return unsupported;
  let metadata: unknown;
  try {
    const key = unwrapKey(record.dataEncryptionKey, contentSecretKey);
    metadata = await decryptRecord(record.metadata, key);
  } catch {
    return unsupported;
  }
  const availability = field(metadata, 'cliAvailability');
  if (!availability) return unsupported;
  return {
    claude: field(availability, 'claude') === true,
    codex: field(availability, 'codex') === true,
    dsh: field(availability, 'dsh') === true,
  };
}
