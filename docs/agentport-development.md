# AgentPort 开发记录与待办

更新日期：2026-11-11。本文记录当前分支的开发状态和验证边界；历史设计不等于现状，线上版本以发布记录及静态目录 `SOURCE_COMMIT` 为准。

## 当前结构与版本

- 仓库：`ljx149/happy`，工作分支 `main`，本机发布 remote 是 `agentport`；不要推送上游 `slopus/happy`。
- 主网页：`packages/happy-app`，包名 `agentport-classic-ui`；恢复官方历史 UI 后换牌并补 AgentPort 适配。访问 `https://agent.xcodex.vip/`。
- 备用网页：`packages/agentport-web`，保留精简 UI 和 `/legacy/index.html#home`；两套 UI 共用 API，但后续登录/退出独立。不要删除旧静态资源或身份数据。
- CLI：`packages/happy-cli`，包名 `agentport-cli`，命令 `agentport`，最新发布 1.2.11。通过 GitHub release 的 `.tgz` 安装。
- 网页版本与 CLI 独立：网页当前版本 1.0.2，自 1.0.1 起以 `happy-app/package.json` 为来源，Expo 配置读取它，并记录构建所用 Git SHA 及提交时间。旧版显示的 1.8.0 是上游遗留标识，不能用作 AgentPort 发布依据。
- 当前服务配置沿用已有部署。网页更新只发布静态文件并按现有流程重启 AgentPort；不得变更共享 Nginx、DNS、证书、其他服务或数据库。

## 开发历程

| 日期 | 变更与依据 | 状态与验证边界 |
| --- | --- | --- |
| 2026-11-08～10 | P0 设计、自建网页、配对与三 Agent 接入；见历史计划 | 历史阶段，不能把当时的待实施状态理解为当前状态 |
| 2026-11-11 | 恢复官方 UI，保留自建精简版；见两目录的 UI-README | 两个 UI 保留，协议/身份修复需同时核对 |
| 2026-11-11 | harness 图标、目录折叠、模型按钮补全；含 `1e7900928`、`4102f07dd` | 浏览器验证，不代表所有用户环境验收完毕 |
| 2026-11-11 | `21b9be45a`，CLI 1.2.10，实时 `read-model-catalog` | 按电脑/目录/Agent 查询；读取 ACP profile，不冒充普通 DSH profile |
| 2026-11-11 | `ce05f11da`，移动布局及长模型列表滚动 | 浏览器模拟 320/390/700/1024 宽度及可见高度缩小通过；真实手机键盘待补验 |
| 2026-11-11 | `a82b7ede3`，模型搜索焦点修复 | 前次布局把输入框放进点击关闭容器，产生回归；已用触摸模拟与桌面点击、输入过滤、滚动保焦点验证 |
| 2026-11-11 | `7c2fe4c8a`，CLI 1.2.11，DSH 自动命名 | 1029 项测试；包外安装、真实加密服务、ACP/MCP 协议测试通过；实际 DSH/模型由用户电脑复验 |
| 2026-11-11 | 网页 1.0.1，设置页精简、独立更新日志和版本来源（清理 Metro 缓存避免旧版本信息） | 本次交付；保留账户、Agent、更新日志、版本，“报告问题”待官网地址确认 |
| 2026-11-11 | 网页 1.0.2，手机导航精简 | 隐藏收件箱入口；移除手机页头装饰 Logo 和更新日志标题小白鼠；保留收件箱底层页面及数据 |

## 已完成

- [x] 主、备用 UI 保留且说明各自用途。
- [x] 新建会话读取电脑模型；模型与推理强度按实际报告显示。
- [x] 移动网页模型长列表可滚动，发送区域独立；搜索框点击/输入/滚动回归修复。
- [x] DSH 首条消息标题兜底、ACP 标题事件和 MCP 命名同步；保护手动名称。
- [x] 设置主页仅保留账户、Agent、更新日志和版本；隐藏其他入口和版本连点开发模式入口。
- [x] 独立 AgentPort 发布记录，区分网页与 CLI 更新；保留上游日志用于追溯。
- [x] 网页版本来自包版本，构建提交由构建配置自动注入。

## 未完成与待办

### 待补验或待定位

- [ ] 用户 Mac 上的真实 DSH 1.2.11 自动命名、实际模型回复与审批；协议测试程序不等于真实模型验收。
- [ ] iOS Safari/Android Chrome 真机键盘、模型搜索、发送按钮及横竖屏回归；当前为 Chromium 模拟验证。
- [ ] 用户报告的 `404 model_not_found`：尚未对上电脑、模型 ID 和渠道，不能直接归责上游或宣称已修复。
- [ ] 服务器试运行 Codex 的启动路径差异：`/usr/local/bin/codex` 包装脚本注入失效代理导致 407，而当前工作进程使用其他入口。已定位，尚未在此任务中修改全局或试运行配置。
- [ ] 三个真实 harness 的启动、允许/拒绝及断线重连继续按实际用户环境记录，不能由静态网页检查代替。

### 暂缓或需要输入

- [ ] 官网反馈地址确认后再开放“报告问题”。目前隐藏，不回退到上游链接，也不猜测官网路由。
- [ ] npm 简短安装路径暂缓：npmjs 的 `agentport-cli` 属于另一项目。用户明确保留包名，继续 GitHub `.tgz`；不得提示直接安装 npmjs 同名包。
- [ ] `registry.xcodex.vip` 发布与匿名下载能力尚未由本次任务验证。
- [ ] `install.sh`、原生客户端、语音、订阅等没有纳入当前交付；隐藏设置入口不等于功能已完成或配置已删除。

## 后续开发与发布约定

1. 开始前读 `AGENTS.md`，发布读 `.agents/skills/release/SKILL.md`。遵守用户指定的 AgentPort fork 和发布渠道，发布从刚 fetch 的远端 main 对齐的干净工作区完成。
2. 网页发版修改 `packages/happy-app/package.json` 的版本，并编辑 `packages/happy-app/AGENTPORT-CHANGELOG.md`；执行 `pnpm --filter agentport-classic-ui changelog:generate`，提交生成的 `agentport-changelog.json`。`build:web` 也执行生成步骤，并使用 `expo export --clear` 清理 Metro 缓存，避免发布记录、内嵌版本和 Git 提交信息沿用旧构建。不要把上游 `CHANGELOG.md` 重新导入产品日志。
3. 运行类型检查及与变更相关的测试。移动交互需用真实点击/触摸模拟验证，不能只用 JavaScript `.click()` 或截图判定输入可用。模型搜索必须包含输入、筛选和滚动后的焦点检查。
4. 发布前备份静态目录、记录校验值；保留 legacy 入口和旧哈希资源。监测已有站点，验证页面、资源、配对、认证 Socket.IO；异常按预案回滚。共享入口及其他服务不得更改。
5. CLI 改版本后构建 happy-wire，再跑 CLI `prepublishOnly`，用 `pnpm pack`。包外试装通过后发布同一 tarball，核对公开下载的 SHA-256 和版本。重启 daemon 不会让已有会话进程自动升级，需新建会话。
6. 每次更新本文的开发历程和待办；区分实现、自动测试、协议夹具、真实用户环境和生产监测，不在文档中记录凭据或用户对话。

## 关联文档

- [主 UI 说明](../packages/happy-app/UI-README.md)
- [备用 UI 说明](../packages/agentport-web/UI-README.md)
- [网页发布记录](../packages/happy-app/AGENTPORT-CHANGELOG.md)
- [P0 历史计划](plans/agentport-implementation-plan.md)
- [第二阶段历史计划](plans/agentport-phase2-plan.md)
