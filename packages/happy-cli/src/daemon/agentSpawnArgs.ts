/**
 * Daemon spawn argv builder.
 *
 * Produces the `happy <agent> ...` argument list the daemon passes to
 * `spawnHappyCLI` for a remotely-spawned session. Standard agents (claude,
 * codex, gemini, openclaw, agy) use the conventional `--happy-starting-mode
 * remote --started-by daemon` argv the index.ts handlers already parse.
 *
 * DSH goes through the `acp` subcommand because the ACP runner is the
 * universal backend for ndJSON stdio agents. The `acp` parser extracts
 * `--started-by` and `--verbose` from the argv and feeds the remainder to
 * `resolveAcpAgentConfig`; `--happy-starting-mode` is not consumed there, so
 * DSH omits it. `resolveAcpAgentConfig(['dsh'])` resolves to command `dsh`
 * with args `['--profile', 'acp']`.
 *
 * Returns null for an unrecognized agent so the caller can surface
 * "unsupported agent" instead of silently falling back to Claude.
 */
export function buildDaemonSpawnArgs(agent: string | undefined): string[] | null {
  if (agent === 'dsh') {
    return ['acp', '--started-by', 'daemon', 'dsh'];
  }
  const command = agent ?? 'claude';
  switch (command) {
    case 'claude':
    case 'codex':
    case 'gemini':
    case 'openclaw':
    case 'agy':
      return [command, '--happy-starting-mode', 'remote', '--started-by', 'daemon'];
    default:
      return null;
  }
}
