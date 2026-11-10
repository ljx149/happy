import { describe, expect, it } from 'vitest';
import { buildDaemonSpawnArgs } from './agentSpawnArgs';

describe('buildDaemonSpawnArgs', () => {
  it('spawns Claude with the standard remote-start argv', () => {
    expect(buildDaemonSpawnArgs('claude')).toEqual(['claude', '--happy-starting-mode', 'remote', '--started-by', 'daemon']);
    expect(buildDaemonSpawnArgs(undefined)).toEqual(['claude', '--happy-starting-mode', 'remote', '--started-by', 'daemon']);
  });

  it('spawns Codex, gemini, openclaw and agy with the standard argv', () => {
    for (const agent of ['codex', 'gemini', 'openclaw', 'agy']) {
      expect(buildDaemonSpawnArgs(agent)).toEqual([agent, '--happy-starting-mode', 'remote', '--started-by', 'daemon']);
    }
  });

  it('spawns DSH through the ACP subcommand without --happy-starting-mode', () => {
    // The `acp` subcommand parser extracts --started-by/--verbose and feeds the
    // remainder to resolveAcpAgentConfig; --happy-starting-mode is not consumed
    // there, so DSH omits it and names its agent after --started-by.
    expect(buildDaemonSpawnArgs('dsh')).toEqual(['acp', '--started-by', 'daemon', 'dsh']);
  });

  it('returns null for an unknown agent so the caller can report it', () => {
    expect(buildDaemonSpawnArgs('myspider')).toBeNull();
  });
});
