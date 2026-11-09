import { contentKeys, decryptRecord, unwrapKey } from './protocol.ts';
import type * as api from './api.ts';

export type Account = { token: string; keys: Awaited<ReturnType<typeof contentKeys>> };

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
  return label(content, 'text') ?? label(field(content, 'ev'), 'text') ?? label(data, 'text') ?? label(data, 'message') ?? label(field(data, 'message'), 'text') ?? '此消息类型暂不可显示。';
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
