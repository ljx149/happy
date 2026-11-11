# AgentPort 官方原版恢复 UI（主入口试运行）

本目录从上游 Git 提交 `b5acacffc` 恢复 Happy 官方旧版 UI，保留原布局、主题、组件及交互，将界面品牌替换为 AgentPort。工作区包名是 `agentport-classic-ui`；目录仍叫 `happy-app`，便于追溯历史和对比上游。

## 为什么有两个 UI

`../agentport-web` 是先前自建的 Vite + React 精简网页，已完成 AgentPort 配对、三 Agent 及消息展示适配。用户随后选择使用官方原版 UI，所以恢复了本目录，同时保留精简版作为备用入口和回滚基础。

- 本目录：原版恢复并换牌的 UI，主入口试运行目标 `https://agent.xcodex.vip/`。
- `../agentport-web`：自建精简 UI，备用入口 `https://agent.xcodex.vip/legacy/index.html#home`。

两套 UI 使用同一 API 和数据库，默认 API 为 `https://agent.xcodex.vip`。可通过 `EXPO_PUBLIC_AGENTPORT_SERVER_URL` 覆盖，兼容 `EXPO_PUBLIC_HAPPY_SERVER_URL`。品牌更名不修改加密派生上下文、协议字段或配对兼容逻辑。

## 构建与发布

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter agentport-classic-ui typecheck
corepack pnpm --filter agentport-classic-ui build:web
```

产物在 `dist/`，需要递归发布 `_expo/`、`assets/`、favicon 和公开资源，不是只复制首页。保留备用 UI 的哈希资源和 `legacy/index.html`。后端静态路由在启动时登记，新资源复制后仅重启 AgentPort 服务；无需改动共享 Nginx。

原版首次启动可从同源精简版 IndexedDB 自动沿用身份，迁移成功后保留原记录供备用 UI 使用。已有原版账户不被覆盖；原版主动退出后不会再次自动导入。两套界面的后续登录/退出各自独立。

这是可回滚的 UI 试运行，不代表历史原版全部能力已经接入 AgentPort。桌面应用、语音、订阅、云功能及额外 Agent 入口仍需单独确认；三 Agent 的完整对话、模型设置和审批不得只凭首页可打开就宣称全部通过。

实际部署状态以发布记录和线上 `SOURCE_COMMIT` 为准。历史来源、换牌范围和最初验收记录见 `AGENTPORT-RESTORE.md`。不要运行上游原生移动端/Expo 发布脚本。
