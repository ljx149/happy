# AgentPort 原版 UI 恢复版

来源：上游提交 `b5acacffc` 的 `packages/happy-app`，即移除旧 Expo / React Native UI 之前的版本。

两套 UI 并存：

- `packages/agentport-web`：自建精简网页，作为备用和回滚入口保留。
- `packages/happy-app`：恢复的官方布局和交互，工作区包名 `agentport-classic-ui`。

## 本次调整

界面中的 Happy 品牌文案、首页字标、页头图标、设置页字标、浏览器标题及 favicon 替换为 AgentPort。保留原始组件组织、主题及交互。

默认 API 地址为 `https://agent.xcodex.vip`，可用 `EXPO_PUBLIC_AGENTPORT_SERVER_URL` 覆盖，兼容旧 `EXPO_PUBLIC_HAPPY_SERVER_URL`。设置页的用户自定义地址优先。

保留加密派生上下文、内部协议字段、旧链接 scheme 和存储键，避免品牌更名破坏配对和历史数据。保留原版权和许可证。移除上游 Expo 更新项目绑定及默认 ElevenLabs agent，Web 构建默认关闭分析上报。

历史依赖合并进根锁文件；安装使用锁定版本：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter agentport-classic-ui typecheck
corepack pnpm --filter agentport-classic-ui build:web
```

开发预览：

```sh
corepack pnpm --filter agentport-classic-ui web
```

Web 导出产物为 `packages/happy-app/dist`。开发预览不是生产发布命令。

## 已验证与边界

已通过类型检查、Web 导出、390×844 手机尺寸浏览器首页检查；首页显示 AgentPort，浏览器无未捕获运行错误。

本次尚未验收完整登录/恢复/配对、生产账户迁移、Codex/Claude Code/DSH 会话创建与审批。原版内的桌面应用、语音、订阅、云服务及其他 Agent 入口不代表 AgentPort 已实现这些能力。上线前需要逐项确认或适配。

以上为首次恢复时的验收记录。后续两套 UI 的分工、试运行入口和迁移说明见 `UI-README.md`；实际上线状态以发布记录为准。不要运行历史原生移动端或 Expo 发布脚本；本恢复版仅验证 Web 构建。
