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

## 与原版 UI 的适配同步（2026-11-11）

原版 `../happy-app` 已补上 DSH 入口、能力字段、运行时模型/推理强度、沿用电脑配置、HTTPS 配对链接和 ACP 单次审批限制。本目录继续保留，功能差异与验收边界详见 `../happy-app/UI-README.md` 的适配核对表。原版隐藏 thinking，本目录允许折叠查看；不要为了统一外观把 thinking 合并进最终回答。后续涉及协议、模型、审批或身份的修复必须同时核对两套 UI。

原版补全记录：手机网页直接展示模型/能力按钮、完整目录会话列表、harness 标识；已用同一个隔离会话对照两套 UI 的模型 code。精简版此次不改动，继续作为配置读取行为的参考。详见原版文档的“原版能力补全”。

CLI 1.2.10 为原版新建页新增加密 `read-model-catalog` RPC，允许会话启动前读取电脑运行器的模型目录。本精简版继续在会话启动后读取 metadata，本次无须改动其协议或线上产物。详见原版 UI 文档“新建会话实时模型查询”。

## 设置页精简范围（2026-11-11）

本次网页 1.0.1 设置页精简只修改主 UI `../happy-app`；本备用 UI 的页面和产物保留。主 UI 的日志已换成 AgentPort 自己的发布记录，反馈入口暂时隐藏。CLI 1.2.11 的 DSH 自动标题写入共用会话 metadata，两套 UI 均继续读取原有 summary 字段。开发历程、版本对应关系与待办统一维护在 [AgentPort 开发记录](../../docs/agentport-development.md)。

### 网页 1.0.2 导航调整（2026-11-11）

主 UI 手机导航仅保留会话和设置，隐藏收件箱入口；移除手机页头装饰 Logo 与更新日志标题旁的小白鼠图片。收件箱底层页面和数据保留；备用精简 UI 不受此显示调整影响。CLI 无需更新。

### DSH 配置门槛（网页 1.0.3 / CLI 1.2.12）

主 UI 在创建 DSH 会话前检查 ACP 实际模型目录，未配置 xmodels/Xcoder1.0 时展示教程与重试并禁用启动。配置后可选其他模型。备用 UI 通过新版 CLI 的 daemon 检查获得拒绝提示，不包含主 UI 的配置引导面板；两者都需要电脑更新 CLI。登录二维码在 CLI 终端展示，复用同一个浏览器授权链接。
