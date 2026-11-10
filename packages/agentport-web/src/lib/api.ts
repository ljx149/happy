import { SessionMessageSchema } from '@slopus/happy-wire';
import { signedChallenge, terminalApproval, encode } from './protocol.ts';

export interface RecordSummary {
  id: string;
  active: boolean;
  metadata: string;
  dataEncryptionKey: string | null;
  agentState?: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super('服务请求失败（' + status + '）');
  }
}

async function request<T>(url: string, token?: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

export async function authenticate(master: Uint8Array) {
  const { token } = await request<{ token: string }>('/v1/auth', undefined, signedChallenge(master));
  if (!token) throw new Error('服务器未返回账户令牌');
  return token;
}

export function terminalStatus(key: Uint8Array) {
  return request<{ status: 'pending' | 'authorized' | 'not_found'; supportsV2: boolean }>(
    '/v1/auth/request/status?' + new URLSearchParams({ publicKey: encode(key) }),
  );
}

export function approveTerminal(token: string, key: Uint8Array, contentPublicKey: Uint8Array) {
  return request('/v1/auth/response', token, {
    publicKey: encode(key),
    response: encode(terminalApproval(contentPublicKey, key)),
  });
}

export function sessions(token: string) {
  return request<{ sessions: RecordSummary[] }>('/v1/sessions', token);
}

export function machines(token: string) {
  return request<RecordSummary[]>('/v1/machines', token);
}

export function removeMachine(token: string, id: string) {
  return fetch('/v1/machines/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  }).then(async response => {
    if (!response.ok) throw new ApiError(response.status);
    return response.json() as Promise<{ success: boolean }>;
  });
}

function messageUrl(id: string) {
  return '/v3/sessions/' + encodeURIComponent(id) + '/messages';
}

export async function messages(token: string, id: string, after: number) {
  const page = await request<{ messages: unknown[]; hasMore: boolean }>(messageUrl(id) + '?after_seq=' + after + '&limit=100', token);
  return { messages: SessionMessageSchema.array().parse(page.messages), hasMore: page.hasMore };
}

export function sendMessage(token: string, id: string, content: string, localId: string) {
  return request(messageUrl(id), token, { messages: [{ content, localId }] });
}
