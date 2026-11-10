import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('Configuration (AgentPort defaults)', () => {
  async function freshConfiguration() {
    vi.resetModules()
    // Isolated empty home so no real settings.json can interfere with the
    // env-or-default assertions. The default branch (no env) is exercised by
    // leaving HAPPY_HOME_DIR unset and expecting .agentport under the real home.
    const mod = await import('./configuration')
    return { configuration: mod.configuration }
  }

  it('uses ~/.agentport as the default home dir when HAPPY_HOME_DIR is unset', async () => {
    // Stub HOME to an empty temp dir so the constructor's mkdir lands inside
    // the sandbox, and so no pre-existing real ~/.happy/.agentport can leak in.
    const fakeHome = join(tmpdir(), `agentport-home-${process.pid}`)
    vi.stubEnv('HOME', fakeHome)
    vi.stubEnv('HAPPY_HOME_DIR', '')
    const { configuration } = await freshConfiguration()
    expect(configuration.happyHomeDir).toBe(join(fakeHome, '.agentport'))
    vi.unstubAllEnvs()
  })

  it('defaults serverUrl to https://agent.xcodex.vip with an empty home', async () => {
    vi.stubEnv('HAPPY_HOME_DIR', join(tmpdir(), `agentport-test-${process.pid}`))
    vi.stubEnv('HAPPY_SERVER_URL', '')
    const { configuration } = await freshConfiguration()
    expect(configuration.serverUrl).toBe('https://agent.xcodex.vip')
    vi.unstubAllEnvs()
  })

  it('defaults webappUrl to https://agent.xcodex.vip with an empty home', async () => {
    vi.stubEnv('HAPPY_HOME_DIR', join(tmpdir(), `agentport-test-${process.pid}`))
    vi.stubEnv('HAPPY_WEBAPP_URL', '')
    const { configuration } = await freshConfiguration()
    expect(configuration.webappUrl).toBe('https://agent.xcodex.vip')
    vi.unstubAllEnvs()
  })

  it('lets HAPPY_SERVER_URL override the default', async () => {
    vi.stubEnv('HAPPY_HOME_DIR', join(tmpdir(), `agentport-test-${process.pid}`))
    vi.stubEnv('HAPPY_SERVER_URL', 'http://localhost:3005')
    const { configuration } = await freshConfiguration()
    expect(configuration.serverUrl).toBe('http://localhost:3005')
    vi.unstubAllEnvs()
  })
})
