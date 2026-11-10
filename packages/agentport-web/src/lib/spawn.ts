import { encryptRecord, decryptRecord } from './protocol.ts';

export interface SpawnRequestOptions {
  directory: string;
  agent: string;
  approvedNewDirectoryCreation?: boolean;
  permissionMode?: string;
  modelMode?: string;
  effortLevel?: string;
}

export interface SpawnParams {
  directory: string;
  agent: string;
  approvedNewDirectoryCreation: boolean;
  permissionMode?: string;
  modelMode?: string;
  effortLevel?: string;
}

export type SpawnInterpretation =
  | { kind: 'success'; sessionId: string }
  | { kind: 'directory-approval'; directory: string }
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; raw: unknown };

export function buildSpawnParams(options: SpawnRequestOptions): SpawnParams {
  const params: SpawnParams = {
    directory: options.directory,
    agent: options.agent,
    approvedNewDirectoryCreation: options.approvedNewDirectoryCreation ?? true,
  };
  if (options.permissionMode) {
    params.permissionMode = options.permissionMode;
  }
  if (options.modelMode) {
    params.modelMode = options.modelMode;
  }
  if (options.effortLevel) {
    params.effortLevel = options.effortLevel;
  }
  return params;
}

export async function encodeSpawnParams(params: SpawnParams, machineKey: Uint8Array<ArrayBuffer>): Promise<string> {
  return encryptRecord(params, machineKey);
}

export async function decodeSpawnResult(encrypted: string, machineKey: Uint8Array<ArrayBuffer>): Promise<unknown> {
  return decryptRecord(encrypted, machineKey);
}

export function spawnRpcMethod(machineId: string): string {
  return `${machineId}:spawn-happy-session`;
}

export function interpretSpawnResult(result: unknown): SpawnInterpretation {
  if (result && typeof result === 'object') {
    const asRecord = result as Record<string, unknown>;
    if (asRecord.type === 'success' && typeof asRecord.sessionId === 'string') {
      return { kind: 'success', sessionId: asRecord.sessionId };
    }
    if (asRecord.type === 'requestToApproveDirectoryCreation' && typeof asRecord.directory === 'string') {
      return { kind: 'directory-approval', directory: asRecord.directory };
    }
    if (typeof asRecord.error === 'string') {
      return { kind: 'error', message: asRecord.error };
    }
  }
  return { kind: 'unknown', raw: result };
}
