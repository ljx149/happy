import { encryptRecord } from './protocol.ts';

export interface PermissionOptions {
  id: string;
  approved: boolean;
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

export interface PermissionPayload {
  id: string;
  approved: boolean;
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

export function buildPermissionPayload(options: PermissionOptions): PermissionPayload {
  const payload: PermissionPayload = { id: options.id, approved: options.approved };
  if (options.decision) payload.decision = options.decision;
  return payload;
}

export async function encodePermissionPayload(payload: PermissionPayload, sessionKey: Uint8Array<ArrayBuffer>): Promise<string> {
  return encryptRecord(payload, sessionKey);
}

export function permissionRpcMethod(sessionId: string): string {
  return `${sessionId}:permission`;
}

export function extractPendingRequests(agentState: unknown): Array<{ id: string; tool?: string; arguments?: unknown; createdAt?: number }> {
  if (!agentState || typeof agentState !== 'object') return [];
  const requests = (agentState as Record<string, unknown>).requests;
  if (!requests || typeof requests !== 'object') return [];
  return Object.entries(requests as Record<string, unknown>).map(([id, req]) => ({
    id,
    ...(req as Record<string, unknown>),
  }));
}
