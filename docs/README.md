# AgentPort 文档入口

优先阅读 [开发记录、当前状态与待办](agentport-development.md)、[主 UI 说明](../packages/happy-app/UI-README.md)、[备用 UI 说明](../packages/agentport-web/UI-README.md)。AgentPort 已恢复 `happy-app` 作为主网页；下文关于旧 Expo 网页移除等描述属于上游历史，不代表当前分支。

# Happy Docs

This folder documents how Happy works internally, with a focus on protocol, backend architecture, deployment, and the CLI tool. Start here.

Mobile clients are native [iOS](../packages/happy-ios) and
[Android](../packages/happy-android), with shared
[JSON translations](../packages/happy-i18n). The React Native/Expo
app and expo-tailcat have been removed. Older plans and porting notes that
mention their paths describe historical implementations available in Git.

## Index
- protocol.md: Wire protocol (WebSocket), payload formats, sequencing, and concurrency rules.
- realtime-sync-and-rpc.md: High-level overview of realtime socket management and RPC control flow.
- api.md: HTTP endpoints and authentication flows.
- encryption.md: Encryption boundaries and on-wire encoding.
- backend-architecture.md: Internal backend structure, data flow, and key subsystems.
- deployment.md: How to deploy the backend and required infrastructure.
- cli-architecture.md: CLI and daemon architecture and how they interact with the server.
- multi-process.md: Deeper multi-replica Socket.IO + Redis streams behavior, failure modes, and integration-test history.
- dev-environments.md: Local `packages/dev-environments/data/` workflow, lab-rat project provisioning, `env:cli` passthrough behavior, and daemon usage.
- session-protocol.md: Unified encrypted chat event protocol.
- session-protocol-claude.md: Claude-specific session-protocol flow (local vs remote launchers, dedupe/restarts).
- plans/provider-envelope-redesign.md: Proposed replacement for the current provider/session envelope design.
- permission-resolution.md: State-based permission mode resolution across app and CLI (including sandbox behavior).
- happy-wire.md: Shared wire schemas/types package and migration notes.
- voice-architecture.md: ElevenLabs voice assistant integration, session routing, context batching, and VAD detection.
- research/: general research notes and exploratory writeups.
- competition/: competitor research, protocol analysis, and comparison notes.
- competition/AGENTS.md: structure and rules for storing competitor research results without committing raw checkouts.

## Conventions
- Paths and field names reflect the current implementation in `packages/happy-server`.
- Examples are illustrative; the canonical source is the code.
