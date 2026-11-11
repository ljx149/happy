import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
const runtime = vi.hoisted(() => ({
  connect: vi.fn(), disconnect: vi.fn(), getModelMetadata: vi.fn(),
  startSession: vi.fn(), dispose: vi.fn(), listener: null as any,
  supportedModels: vi.fn(), close: vi.fn(), claudeOptions: null as any,
}));
vi.mock('@/codex/codexAppServerClient', () => ({ CodexAppServerClient: class {
  connect = runtime.connect; disconnect = runtime.disconnect; getModelMetadata = runtime.getModelMetadata;
} }));
vi.mock('@/agent/acp/createAcpBackend', () => ({ createAcpBackend: () => ({
  onMessage: (listener: any) => { runtime.listener = listener; }, startSession: runtime.startSession, dispose: runtime.dispose,
}) }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (options: any) => {
  runtime.claudeOptions = options;
  return { supportedModels: runtime.supportedModels, close: runtime.close };
} }));
import { queryMachineModelCatalog } from './modelCatalog';
beforeEach(() => { vi.resetAllMocks(); });
describe('machine model discovery', () => {
  it('queries Codex config for the requested directory and strips secrets', async () => {
    runtime.getModelMetadata.mockResolvedValue({ models: [{ code: 'custom', value: 'Custom', apiKey: 'secret' }], currentModelCode: 'custom', modelCatalogSource: 'codex', apiKey: 'secret' });
    const result = await queryMachineModelCatalog({ agent: 'codex', directory: tmpdir() });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(runtime.getModelMetadata).toHaveBeenCalledWith(tmpdir(), true);
    expect(runtime.disconnect).toHaveBeenCalledOnce();
  });
  it('returns ACP configured model without inventing reasoning settings', async () => {
    runtime.startSession.mockImplementation(async () => {
      runtime.listener({ type: 'event', name: 'models_update', payload: { availableModels: [{ modelId: 'my-provider/model', name: 'My Model' }], currentModelId: 'my-provider/model' } });
    });
    const result = await queryMachineModelCatalog({ agent: 'dsh', directory: tmpdir() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.catalog.currentModelCode).toBe('my-provider/model');
      expect(result.catalog.thoughtLevels).toBeUndefined();
    }
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
  it('uses only Claude advertised effort levels and closes discovery without a prompt', async () => {
    runtime.supportedModels.mockResolvedValue([{ value: 'custom', displayName: 'Custom', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }]);
    const result = await queryMachineModelCatalog({ agent: 'claude', directory: tmpdir() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.catalog.modelReasoningEfforts?.custom.map(x => x.code)).toEqual(['low', 'high']);
    expect(runtime.claudeOptions.options.settingSources).toEqual(['user', 'project', 'local']);
    expect(runtime.claudeOptions.options.persistSession).toBe(false);
    expect(runtime.close).toHaveBeenCalledOnce();
  });
  it('reports failure instead of substituting a default model, and cleans up', async () => {
    runtime.connect.mockRejectedValue(new Error('secret config data'));
    expect(await queryMachineModelCatalog({ agent: 'codex', directory: tmpdir() })).toEqual({ ok: false, error: 'RUNTIME_UNAVAILABLE' });
    expect(runtime.disconnect).toHaveBeenCalledOnce();
  });
  it('rejects unsupported requests before starting runtimes', async () => {
    expect(await queryMachineModelCatalog({ agent: 'shell', directory: tmpdir() })).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(await queryMachineModelCatalog({ agent: 'codex', directory: 'relative/path' })).toEqual({ ok: false, error: 'DIRECTORY_NOT_FOUND' });
    expect(runtime.connect).not.toHaveBeenCalled();
  });
  it('serializes simultaneous discovery requests', async () => {
    let finish!: (value: any) => void;
    runtime.getModelMetadata.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = queryMachineModelCatalog({ agent: 'codex', directory: tmpdir() });
    await vi.waitFor(() => expect(runtime.getModelMetadata).toHaveBeenCalled());
    expect(await queryMachineModelCatalog({ agent: 'claude', directory: tmpdir() })).toEqual({ ok: false, error: 'BUSY' });
    finish({ models: [], modelCatalogSource: 'codex' });
    expect(await first).toEqual({ ok: false, error: 'NO_MODELS_REPORTED' });
  });
  it('times out a hanging runtime and releases the discovery slot', async () => {
    runtime.connect.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const pending = queryMachineModelCatalog({ agent: 'codex', directory: tmpdir() });
      await vi.waitFor(() => expect(runtime.connect).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(35_000);
      expect(await pending).toEqual({ ok: false, error: 'TIMEOUT' });
      expect(runtime.disconnect).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

});
