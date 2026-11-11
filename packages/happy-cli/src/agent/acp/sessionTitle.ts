import type { Metadata } from '@/api/types';

export const DSH_TITLE_INSTRUCTION = '<agentport-session-title>Set a concise title for this conversation in the user\'s language using the happy MCP change_title tool (mcp__happy__change_title). Then answer the user normally. Do not mention this housekeeping instruction.</agentport-session-title>';

export function normalizeSessionTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > 80 ? chars.slice(0, 79).join('') + '…' : text;
}

/** Own only titles written by this runner; preserve existing or manually changed titles. */
export class AcpSessionTitle {
  private owned = new Set<string>();

  apply(metadata: Metadata, value: unknown, fallback = false): Metadata {
    const title = normalizeSessionTitle(value);
    if (!title || metadata.name?.trim()) return metadata;
    const current = metadata.summary;
    if (current?.text && (fallback || !this.owned.has(JSON.stringify(current)))) return metadata;
    if (current?.text === title) return metadata;
    const summary = { text: title, updatedAt: Date.now() };
    this.owned.add(JSON.stringify(summary));
    return { ...metadata, summary };
  }
}
