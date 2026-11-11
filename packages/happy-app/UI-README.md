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

## AgentPort 适配核对（2026-11-11）

- 三 Agent：保留 Claude Code/Codex，补上 DSH 的机器能力解析、首页及新会话入口、持久化选择和 spawn RPC 类型。只有电脑上报安装 DSH 才显示它。
- 模型：新会话默认沿用电脑配置，不注入上游预设模型/推理强度。会话中优先使用 CLI 上报的模型列表；Codex 按模型读取 `modelReasoningEfforts`，未上报能力时不猜测。Claude/Codex 自定义模型可在 Settings → Agents 填写准确 ID。
- DSH：协议 flavor 仍为 `acp`，用 `agentName=dsh` 识别；保留 provider/model 的不透明 code，读取 ACP 的模型、当前模型及 thought levels。读取的是 DSH ACP profile，不能宣称自动继承普通 DSH profile。
- 审批：沿用原版加密 permission RPC 的 allow/deny；ACP 隐藏未承诺支持的“整次会话允许/全部编辑/全部放行”。
- 消息：原版已识别 `service`，usage-only 不生成正文；thinking 不混入最终回答，原版当前隐藏 thinking（精简版则可折叠查看）；工具有独立卡片及完成状态。
- 配对：支持现有 `/terminal/connect#key=…` 深链接，并补上粘贴同服务器 HTTPS CLI 授权链接；兼容旧 `happy://terminal?…` 协议。账户迁移见上文。

验证包括类型检查、协议/schema/模型/发送元数据/机器选择/授权链接回归，以及隔离后端浏览器检查。它们不等同于在用户 Mac 上完成三 Agent 的真实模型调用；实际账号权限、提供商支持和用户电脑在线状态仍需手机实测。未上报模型目录的 CLI 不会被网页伪造出“本机可用模型”。

## 原版能力补全（2026-11-11）

恢复源码不等于完成产品适配：旧版移动布局曾排除手机网页，目录分组和 harness 图标默认关闭，项目首页只展示最近会话，且上游不认识 DSH。此次让窄屏网页使用原版模型/推理强度按钮和选择面板；目录模式使用原有完整会话分组，展示机器及完整工作目录；列表显示 harness 名称并补上 DSH 图标。旧设置仅迁移一次启用目录分组与图标，之后保留用户选择。

模型仍读取与精简版相同的加密会话元数据，保留完整 provider/model code；DSH 未上报推理能力时不显示选项，切换模型后不沿用旧模型的能力列表。未上报且未指定的推理强度不冒充已选择的第一项。标题保留原版 summary 自动命名链路，并以已有 metadata.name 作为回退；本次没有新增手动重命名或保证每个 harness 自动生成标题。

隔离浏览器验证覆盖手机尺寸下的 Codex/DSH 模型列表、Codex 推理强度、DSH 无能力时隐藏按钮、同一会话在两套 UI 的模型代码一致、目录/标题/harness 展示，以及身份迁移和真实配对协议。会话消息和模型目录为测试夹具，不代表用户电脑上的真实模型调用已通过，也不能据此前端问题断言 DSH profile 是实际报错根因。

会话头像直接使用 Claude/GPT/DeepSeek 标识（DSH 为蓝鲸），不再叠加在随机头像上。目录标题不使用会话或项目头像；点击标题可展开/收起子会话，“＋”独立新建会话。

模型入口不再由简洁模式隐藏；宽屏网页与手机网页都直接提供模型/推理强度按钮，宽屏复用同一选择面板。已上报的模型目录依然来自用户会话，未上报的能力不补造。发布验收应检查普通/简洁模式、手机/宽屏布局，以及切换模型后刷新仍保留选择，不能仅检查菜单能否打开。

新建会话页单独展示模型行，只有一个默认选项时也保留入口。此前只使用默认模型列表且要求至少两个选项才显示，导致 Agent/CC 推理强度可选但模型入口消失。现读取所选电脑、目录、harness 最近会话的已上报模型目录，保留不透明 provider/model code，并按模型读取能力。此数据是历史上报，不是新建页实时扫描本机配置；没有匹配目录时明确提示先沿用电脑配置启动。不得把其他电脑/目录或通用 ACP 的目录当成 DSH 的可用模型。

## 新建会话实时模型查询（CLI 1.2.10）

新建页通过所选电脑的加密 `read-model-catalog` RPC，按工作目录查询运行器；不再用历史会话冒充实时配置。Codex 读取 app-server 的配置和模型目录；Claude SDK 返回可选模型及每个模型的强度能力，加载 user/project/local 配置；DSH 初始化正常运行时使用的 `--profile acp` 并读取模型/configOptions，不发送对话。返回值仅包含模型与能力白名单字段，不含原始配置或凭据。

电脑端必须升级至 1.2.10 并重启 daemon。旧版本、离线、目录不存在、初始化失败和超时会明确提示，可手动重新读取。切换电脑/目录/harness 会丢弃旧结果；没有有效列表时保留“沿用电脑配置”。模型目录不代表已验证每个模型的调用权限；Claude 当前默认模型没有可靠字段时不推测，默认选项仍由本机决定。DSH 不报告推理强度时不显示强度按钮。

精简版保持原来的先启动会话、再读取会话 metadata 的流程，本次不替换其线上静态文件。测试区分真实 Codex/Claude 查询、DSH ACP 协议夹具与用户电脑验收，不能混称全部真实运行通过。
