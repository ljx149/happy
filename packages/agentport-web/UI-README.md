# AgentPort 精简版 UI（备用）

本仓库保留两套 UI，原因是早期为跑通 AgentPort 的 CLI 配对、设备管理和 Codex/Claude Code/DSH 会话，自建了轻量网页；后来希望恢复 Happy 官方原版的布局与交互，因此从 Git 历史恢复了另一套 UI。保留本目录便于回退和继续参考已完成的 AgentPort 适配，不是重复或废弃目录。

| 目录 | 身份 | 技术 | 用途 |
| --- | --- | --- | --- |
| `packages/agentport-web` | AgentPort 自建精简版 | Vite + React | 已验证的备用界面、回滚入口 |
| `packages/happy-app` | 官方原版恢复并换牌的 AgentPort UI | Expo / React Native Web | 主入口试运行版本，保留原版布局与交互 |

精简版已有浏览器配对、设备列表、三种 Agent 启动、加密会话、审批、模型设置，以及折叠思考/工具记录展示。它与原版使用同一 AgentPort 后端，但浏览器凭据保存格式不同。

## 访问与构建

- 主入口试运行目标：`https://agent.xcodex.vip/`（原版恢复 UI）。
- 精简版备用入口：`https://agent.xcodex.vip/legacy/index.html#home`。
- 构建：`corepack pnpm --filter agentport-web build`。
- 产物：本目录 `dist/`。它仍使用根路径下的已有哈希资源；发布原版时必须保留这些文件。

原版首次打开会尝试从同源 IndexedDB 中读取精简版身份，取得新 token 后保存到原版自己的凭据存储；不删除精简版身份，不覆盖已存在的原版账户。原版退出登录后不会重复自动导入。两套界面此后的切换账户/退出登录各自独立，使用时注意当前账户。

## 运维约束

不要因为恢复原版而删除本目录、浏览器 IndexedDB 或线上旧哈希资源。两套 UI 共用 API 和数据库，不需要重建数据库。

发布只更新 AgentPort 自己的静态目录并重启 `agentport.service` 使静态路由重新登记，不修改共享 Nginx、DNS、证书。每次先备份整个静态目录、记录入口文件校验值，并监测已有站点。回滚应恢复备份中被覆盖的静态文件和首页，然后仅重启 AgentPort。

更多原版来源和限制见 `../happy-app/UI-README.md` 和 `../happy-app/AGENTPORT-RESTORE.md`。实际部署状态以发布记录和线上 `SOURCE_COMMIT` 为准。
