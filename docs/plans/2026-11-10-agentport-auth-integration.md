# AgentPort Web 真实登录与鉴权接入方案

日期：2026-11-10。状态：待实施；本文件不是实现完成或上线验收报告。

## 目标与范围

将 `packages/agentport-web` 从演示身份切换为 Happy 兼容的真实密钥账户，完成创建、备份、恢复、刷新、退出、电脑授权和真实设备读取。保留现有视觉方向，删除生产流程中的虚拟账户、设备、会话。聊天执行、DSH、CLI 品牌改造与部署不在本次范围。

现有 `agentport-implementation-plan.md` 和 `agentport-phase2-plan.md` 仍作为整体计划。本文件补充登录实现顺序，并纠正先前协议分析；不宣称协议核对或兼容测试已经完成。

## 1. 分支与现有改动保护

编写本文时当前分支为 `main`，存在未跟踪的 AgentPort Web、三份计划和两份 Android 文件。不得直接开展 main 上的功能开发，不得执行清理、覆盖、整体暂存或自动提交这些文件。

实施时先运行：

```sh
git status --short
git branch --show-current
git fetch origin
git log --oneline --left-right HEAD...origin/main
git switch -c codex/agentport-auth-integration
```

这是在当前 HEAD 创建实现分支，保留现有工作区文件；不是默认已经与远端同步。若同名分支存在，先检查其内容，不覆盖或强制重置。fetch 失败时停止基线同步，不冒称基线最新。

逐文件审阅 `packages/agentport-web/` 与相关计划，将确认属于本任务的现有内容作为基线单独提交；Android 的 `ConnectClaudeScreen.kt` 和 `ConnectClaudeLayoutTest.kt` 不纳入本任务。只按具体路径暂存，不使用 `git add .`。随后在无阻碍 rebase 的改动时执行 `git rebase origin/main`；若未提交改动阻碍操作，先明确归属并保存，不盲目 stash 全仓库。出现基线冲突先逐项解决，不删除用户工作。

建议同一分支按以下单元提交：演示基线、协议兼容测试、Web 登录模块、登录 UI、配对接口与 Web 配对、集成测试。规模较大的防重放协议和 token 撤销可从共同基线另建 `codex/auth-protocol-hardening`，依赖明确后合并，避免夹带不兼容变更。

本任务不自动推送或发布。用户明确要求“sync to main”时，按根目录 AGENTS.md：fetch、rebase origin/main、正常 push HEAD:main，禁止 force push。所有发布必须先完整阅读 `.agents/skills/release/SKILL.md`，从刚 fetch 后与 origin/main 完全一致、干净的本地 main 发布，不从实现分支或 worktree 发布。

## 2. 先纠正协议理解

| 项目 | 正确规则与实施约束 |
| --- | --- |
| 身份 | 32 字节账户 secret；创建和现有恢复均调用签名认证接口。不是邮箱密码系统。 |
| 签名 | CLI `src/api/encryption.ts` 使用 `tweetnacl.sign.keyPair.fromSeed(secret)`，与 libsodium Ed25519 seed 派生对齐。不要把 32 字节 seed 传给 `sign.keyPair.fromSecretKey`，也不要另造派生步骤。 |
| 备份 | `SecretKeyBackup.format` 输出分组 Base32，而非 Base64URL；原始导入可接受 Base64URL。按原生实现核对格式判别、容错、长度，补含连字符的 Base64URL 边界测试，避免歧义解析。 |
| V2 配对 | 授权明文为 `0x00 || contentPublicKey`，总计 33 字节；legacy 才是 32 字节账户 secret。外层按现有临时密钥 box 协议封装。不得将账户 secret 当成 V2 载荷。 |
| 加密数据 | CLI 接收 contentPublicKey 后生成 machineKey；设备与会话的数据密钥按各自协议使用，不混用。派生路径和版本字节必须用源码及向量确认。 |
| token | 24 小时是 token 验证缓存 TTL，不是已证实的 token 过期时间。`invalidateUserTokens` 只删除缓存，不构成撤销。 |
| 本地存储 | Base64 编码和 IndexedDB 均不是加密保护。不能以换存储位置代替凭据保护设计。 |

权威参照：

- CLI：`packages/happy-cli/src/api/encryption.ts`、`src/ui/auth.ts`、`src/api/auth.ts`。
- Android：`packages/happy-android/crypto/src/main/kotlin/com/slopus/happy/crypto/` 下的 `AuthCrypto.kt`、`SecretKeyBackup.kt`、`AccountEncryption.kt`；`app/src/main/kotlin/com/slopus/happy/auth/AuthRepository.kt`、`AccountLinking.kt`。
- iOS：`packages/happy-ios/Sources/HappyCore/Auth/AuthService.swift`、`Credentials.swift`、`LegacyPairingService.swift` 和 `Sources/HappyCrypto/SecretKeyBackup.swift`。
- 向量：`packages/happy-android/crypto/src/test/kotlin/com/slopus/happy/crypto/TsVectorsTest.kt` 及其引用的实际 fixture/生成器。读取后定位文件，不能仅引用测试名称就声称验证通过。
- 服务端：`packages/happy-server/sources/app/api/routes/authRoutes.ts`、`sources/app/auth/auth.ts`。

产出：Web 自动化兼容测试，覆盖固定 seed 的公钥/签名、恢复格式往返、V2 授权解密、数据密钥解封及错误长度。只有测试实际通过才标记阶段完成。

## 3. Web 修改位置与步骤

### 3.1 工程与模块

现有 Web 只有静态文件，尚未列入 `pnpm-workspace.yaml`。在 `packages/agentport-web/package.json` 增加构建、类型检查与测试脚本；将包加入 pnpm workspace，更新锁文件。使用项目现有工具惯例与锁定依赖，不运行时从 CDN 加载密码库。

建议新增 `src/auth/crypto.ts`、`backup.ts`、`credentials.ts`、`authClient.ts`、`authStore.ts`、`pairing.ts` 和对应测试。统一 API 地址，默认同源；凭据按服务源隔离，切换服务器不能复用原 token 或静默复制身份。

### 3.2 创建、恢复与状态

修改 `app.js` 的入口、路由守卫和退出事件：移除以 `signedIn` 布尔变量作为认证依据的逻辑，使用 initializing、signedOut、authenticating、signedIn、error 等显式状态。获得 token 后调用实际受保护的账户或设备接口确认可用，再进入工作台。

创建：安全随机生成 32 字节 secret，展示备份和确认步骤，签名调用 `/v1/auth`。失败重试沿用本次身份，不重新生成 secret。

恢复：校验并规范化输入，用恢复的 secret 签名。现有接口 upsert 会让未知身份创建空账户，因此不能保证“恢复到原账户”。第一版明确该行为，成功文案使用“已登录此密钥对应的账户”；若要求严格恢复已有账户，应增加经过签名验证的 restore-only 模式，未知身份返回明确错误，不能通过未认证公钥查询暴露账户存在性。该问题与防重放独立。

401 进入重新认证处理；网络失败保留凭据并允许重试，不能当作密钥错误清空身份。并发请求共享认证操作，避免重复创建和重复提交。

### 3.3 UI 与存储

修改 `index.html` 的两个模板和 `style.css`：真实恢复输入、可访问的错误提示、等待状态、防重复按钮、备份确认、窄屏和键盘可用性。新账户显示空设备列表，不显示预置电脑和假会话。

默认身份仅存在内存，刷新需要重新恢复，UI 必须明确告知。要达到“刷新仍可恢复登录”的完整验收，实施显式的“记住此浏览器”：以用户提供的本地解锁口令派生密钥，对 secret 做认证加密后存 IndexedDB；保存版本、盐和必要参数，不保存口令。参数选择、解锁错误及迁移规则需专门测试。不得声称此方式可以抵御同源恶意脚本。若该能力未完成，禁用记住选项并报告刷新恢复尚未交付。

退出清理内存、持久化身份、待处理配对和连接，通知其他标签页同步退出。备份凭据不得写入 URL、日志或埋点。按钮称“退出此浏览器”，不暗示 token 已在服务端撤销。

### 3.4 真正配对

修改 `app.js` 的 `pairView` 与 pair 事件，逻辑移入 `pairing.ts`。核对并解析 CLI 实际生成的链接，验证公钥长度及目标服务器；读取请求状态，显示确认页，用户确认后加密 V2 载荷并调用 `/v1/auth/response`。

授权成功后读取真实设备，不能将本地数组元素标记 online 作为成功证据。请求不存在、已过期、已被其他账户授权、网络结果未知分别提示。CLI 命令使用仓库确实支持的 Happy 命令及隔离服务器配置，未经实现不显示 `agentport auth login`。

## 4. 服务端修改范围与优先级

### 4.1 配对闭环需要处理

位置：`sources/app/api/routes/authRoutes.ts` 和实际数据库 schema/迁移。修改前确认 PostgreSQL 与 self-host 使用的 schema 和迁移路径，不能只改一个 schema 就认为全环境生效。

- 授权采用带空 response 条件的原子更新，并检查影响行数。两个请求可以同时读到空值，现有后写覆盖才是竞态；重复同账户确认可以幂等，其他账户明确冲突。
- 定义请求有效期和过期清理，并在创建/轮询/状态/授权各入口执行。公钥公开不足以解密 response，但轮询接口同时返回 token，旧请求无限领取 token 仍有实际风险。
- 一次性消费必须与 CLI 轮询、响应丢失重试一起设计，不能简单首次读取后删除导致合法客户端永久丢失授权。可先限制短领取窗口，明确其仍非严格一次性；严格消费需确认/持有私钥证明及客户端协议配套。
- authorized 状态返回存储的 `supportsV2`。测试其一致性，不把未经证明的客户端解密错误当作既成事实。
- 对畸形 Base64、密钥/签名长度和过大载荷返回明确 4xx，不让密码库异常成为 500。
- 同时审查 `/v1/auth/account/request` 与 `/response` 的同类生命周期；避免只修 terminal 分支。

### 4.2 防重放：单独设计兼容升级

`/v1/auth` 当前允许重复提交有效签名。短 TTL 的已用 challenge 缓存到期后仍可重放，不能作为完整修复；`sources/storage/repeatKey.ts` 不能未经审计直接复用。

建议新增版本化认证交换：服务端签发短时随机 challenge，绑定身份和认证用途；验签后在共享持久化层原子消费，再签 token。测试跨进程、重启、并发重复和响应丢失。与 CLI/原生客户端制定迁移步骤；保留旧入口就仍保留旧入口重放风险，不能宣称风险已全局关闭。首次 Web 联调可以在隔离环境使用现有协议，正式开放前明确迁移或限制策略。

### 4.3 token 撤销：不是加 logout 路由就完成

位置：`sources/app/auth/auth.ts`、实际 HTTP 认证入口、`sources/app/api/socket.ts` 及持久化会话模型。

如要交付服务端撤销，需要可持久化的会话标识/版本或撤销记录，验证器与缓存都检查该状态，并覆盖已有 Socket 及重连。清缓存后重新验签仍通过不算撤销。区分退出当前会话、撤销某台设备和退出全部设备；不得为了一个浏览器退出顺手撤销整账户。

此项可独立交付。未完成时 Web 只提供本地退出，不提供“已撤销访问”的承诺。

## 5. 验收与完成报告

1. 自动化：Web 兼容向量、恢复格式、身份存储加密往返、认证状态转换；服务端签名错误、并发授权、到期、跨账号和重放测试。避免只测试实现函数自洽，必须有原生/CLI 参考输入输出。
2. 服务端运行针对性 Vitest 测试和 `pnpm --filter happy-server typecheck`；涉及 CLI 时运行相关测试与检查。Web 新增的 test/typecheck/build 脚本必须实际运行。数据库改动用可丢弃数据库验证迁移，不接生产数据。
3. 浏览器实测：创建→备份→真实受保护接口→授权隔离 CLI→真实设备出现→刷新解锁→退出→恢复同一账户。桌面和窄屏均检查，不以静态源码检查替代交互验证。
4. 双账号负向测试：另一账户不能读取设备/会话或覆盖已批准请求；无效 token、超时、断网、双标签页和重复点击不能产生错误成功状态。
5. CLI 使用独立 `HAPPY_HOME_DIR`，Server/Web 指向同一隔离实例。不得改变已有用户身份或线上服务。

完成报告列出提交、实际运行的检查、浏览器和 CLI 验证结果、未完成能力及已知协议限制。无服务环境或依赖时明确阻断项，不把 mock 测试计作真实联调。验收通过后再讨论合并和发布。
