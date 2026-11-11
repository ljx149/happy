import { describe, it, expect } from 'vitest';
import { MetadataSchema, MachineMetadataSchema } from './storageTypes';
import { resolveMessageModeMeta } from './messageMeta';
import { getAvailableModels, getEffortLevelsForModel } from '@/components/modelModeOptions';
import { isHarnessAvailable, listAvailableHarnesses } from '@/utils/harnessCatalog';

describe('AgentPort classic compatibility', () => {
    const model = '["private-provider","my-model"]';
    const metadata = MetadataSchema.parse({ path: '/work', host: 'computer', flavor: 'acp', agentName: 'dsh', version: '1.2.9',
        modelCatalogSource: 'dsh-acp-profile', currentModelCode: model,
        models: [{ code: model, value: 'Private provider / My model' }],
        thoughtLevels: [{ code: 'enabled', value: 'Thinking' }], currentThoughtLevelCode: 'enabled',
    });
    it('preserves DSH discovery and only advertises installed DSH', () => {
        const machine = MachineMetadataSchema.parse({ host: 'computer', platform: 'darwin', happyCliVersion: '1.2.9',
            happyHomeDir: '/tmp/agentport', homeDir: '/tmp', cliAvailability: {
                claude: true, codex: true, dsh: true, gemini: false, openclaw: false, detectedAt: 1,
            },
        });
        expect(listAvailableHarnesses({ availability: machine.cliAvailability, happyAgentAvailable: false }).map(x => x.key))
            .toEqual(['claude', 'codex', 'dsh']);
        expect(isHarnessAvailable({ key: 'dsh', happyAgentAvailable: false })).toBe(false);
    });
    it('preserves the opaque DSH provider/model code and ACP effort on the wire', () => {
        expect(getAvailableModels('dsh', metadata, x => x)[0].key).toBe(model);
        expect(getEffortLevelsForModel('dsh', model, metadata)[0].key).toBe('enabled');
        expect(resolveMessageModeMeta({ metadata, modelMode: model, effortLevel: 'enabled' } as any))
            .toEqual({ model, effort: 'enabled' });
    });
    it('matches the compact UI by hiding unsupported or stale ACP effort', () => {
        expect(getEffortLevelsForModel('dsh', model, { ...metadata, thoughtLevels: undefined })).toEqual([]);
        expect(getEffortLevelsForModel('dsh', 'another-model', metadata)).toEqual([]);
        expect(getEffortLevelsForModel('dsh', model, { ...metadata, version: '1.2.7' })).toEqual([]);
    });

    it('does not apply Claude defaults to a DSH session or invent unsupported effort', () => {
        expect(resolveMessageModeMeta({ metadata } as any, { agentDefaultOverrides: { claude: { modelMode: 'wrong' } } }))
            .toEqual({});
        expect(resolveMessageModeMeta({ metadata, modelMode: model, effortLevel: 'ultra' } as any))
            .toEqual({ model });
    });
    it('retains Codex capabilities through schema validation and rejects stale effort after switching models', () => {
        const codex = MetadataSchema.parse({ path: '/work', host: 'computer', flavor: 'codex', currentModelCode: 'custom',
            modelReasoningEfforts: { custom: [{ code: 'high', value: 'High' }], other: [{ code: 'low', value: 'Low' }] },
        });
        expect(getEffortLevelsForModel('codex', 'default', codex).map(x => x.key)).toEqual(['high']);
        expect(resolveMessageModeMeta({ metadata: codex, modelMode: 'other', effortLevel: 'high' } as any)).toEqual({ model: 'other' });
        expect(resolveMessageModeMeta({ metadata: codex } as any)).toEqual({});
    });
});
