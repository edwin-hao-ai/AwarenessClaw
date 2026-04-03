# AwarenessClaw 项目规则

## ⚠️ 变更报告规则（必须遵守）

每次完成代码修改后，必须向用户报告以下信息：

1. **改了什么文件**：列出所有新增/修改/删除的文件路径
2. **改了什么内容**：每个文件的关键变更摘要（不要贴完整 diff，用人话说）
3. **影响面分析**：这个文件被哪些其他文件 import/依赖？改动可能影响哪些功能？
4. **测试情况**：是否对修改做了测试？测试了什么场景？测试结论是什么？如果没测试，说明原因
5. **格式示例**：
```
### 变更报告
| 文件 | 变更 | 影响面 |
|------|------|--------|
| `src/pages/Dashboard.tsx` | 新增 Agent 选择器下拉 | 聊天页面、chat:send IPC |
| `electron/main.ts` | chat:send 支持 agentId 参数 | 所有聊天功能 |

**测试**：✅ 手动测试创建 agent → 切换 → 发送消息，回复正确路由到选中 agent
```

## 项目概述
AwarenessClaw = OpenClaw（开源 AI Agent 框架）+ Awareness Memory（跨会话记忆），一键安装，超级傻瓜化。

## 核心原则

### 1. 套壳不复刻
- **绝不复刻 OpenClaw**：安装真正的 OpenClaw，不 fork、不重写
- OpenClaw 升级 = 用户升级，我们只维护安装器壳和记忆插件
- 利用 OpenClaw 已有的一切能力（Gateway、多通道、ClawHub、Web UI 等）

### 2. 复用优先，不重复造轮子
- Awareness 主仓库（`../`）中已有大量可复用代码，**必须优先复用**：
  - `../sdks/openclaw/` — OpenClaw 插件实现（tools、hooks、client、sync、auth）
  - `../sdks/local/` — 本地守护进程（daemon、MCP server、indexer）
  - `../sdks/setup-cli/` — IDE 安装逻辑（环境检测、配置写入、守护进程启动）
  - `../sdks/awareness-memory/` — ClawHub 技能脚本（recall、capture、search）
- **复用方式**：npm 依赖（`@awareness-sdk/openclaw-memory`、`@awareness-sdk/local`、`@awareness-sdk/setup`），不要复制代码
- 只有安装器壳、Electron 壳、桌面端 UI 是新写的代码
- 如果发现自己在写的功能在主仓库 SDK 中已经存在，**停下来，改为引用而不是重写**

### 3. 超级傻瓜化（10 岁小孩可用）
- **零命令行**：用户全程不需要打开终端/命令行
- **零技术知识**：不假设用户知道什么是 Node.js、npm、API Key、JSON
- **一键安装优先**：安装流程面向不写代码的商业用户设计，默认一路"下一步"即可完成，不要求用户做环境匹配、参数选择或依赖排查
- **所有配置全 UI 化**：模型选择、通道连接、记忆体管理全部图形化
- **用人话说话**：错误提示不要技术术语，用"网络连接有问题，请检查 Wi-Fi"而非"ECONNREFUSED 127.0.0.1:37800"
- **安全默认值**：所有配置都有合理的默认值，用户可以一路"下一步"完成安装

### 4. 跨平台是硬要求
- **产品必须兼容 Windows、Linux、macOS**：功能设计、安装流程、升级流程、路径处理、权限处理都要覆盖三端，不能只在单一平台可用
- 任何新增功能上线前，都要先检查三端是否存在命令、路径、权限、打包或 UI 行为差异

### 5. 记忆是差异化
- 安装器是入场券，记忆体是护城河
- UI 和功能优先投入在记忆相关特性（知识卡、感知信号、决策时间线）
- 竞品（ClawX、Butlerclaw 等）不提供跨会话记忆

## 技术栈
- **CLI 包**（Phase 0）：Node.js，零依赖（仅内置模块），ESM
- **桌面端**（Phase 1）：Electron + React + Tailwind + shadcn/ui
- **打包**：electron-builder（exe/dmg/deb/rpm/AppImage）
- **自动更新**：electron-updater

## 项目结构
```
AwarenessClaw/
├── packages/cli/          # @awareness-sdk/claw — npx 安装器
├── packages/desktop/      # Electron 桌面端
├── docs/                  # 项目文档
└── CLAUDE.md              # 本文件
```

## 主进程结构文档（必须遵守）
- 修改 `packages/desktop/electron/main.ts` 或其拆分文件前，必须先阅读 `docs/structures.md`
- `docs/structures.md` 是 Electron 主进程拆分的唯一施工规则，优先级高于临时想法
- 对 `main.ts` 的重构必须遵守“先 copy/paste 提取、后整理”的原则，不允许借重构顺手改行为
- `chat`、`channel`、`app lifecycle` 属于高风险区，没有明确验证时不要先动
- 新增主进程文件时，优先按 `docs/structures.md` 约定的目录和分层方式放置

## 与主仓库的关系
- 本项目位于 `Awareness/AwarenessClaw/`，使用独立 Git 仓库管理
- 主仓库 `.gitignore` 已排除本目录
- 通过 npm 依赖引用主仓库 SDK，不通过文件路径引用

## 任务管理
- **所有待做事项记录在 `TASKS.md`**，完成一项打 ✅ + 日期
- 开始新功能前先看 TASKS.md，避免遗漏和重复
- 每次重大改动后更新 TASKS.md 状态
- PRD 详细设计在 `Awareness/ops-docs/AWARENESS_AGENT_DESKTOP_PRD.md`

## 开发规则
- 中文推理和回复，英文写代码（与主仓库一致）
- 代码注释用英文
- 任何安装、升级、启动相关改动都必须同时验证 Windows、Linux、macOS 三端兼容性，不允许默认只按当前开发机平台处理
- UI 文案支持多语言（默认英文 + 中文），不要 hardcode 语言
- 所有用户可见的错误信息必须友好、非技术性、可操作
- 安装向导必须优先减少用户决策和手工操作；能自动检测的不要让用户选，能自动修复的不要让用户自己查文档
- **聊天 UI 不嵌入 OpenClaw 原生界面**——用我们自己的 Web UI，后端走 CLI 或 WebSocket 获取数据
- **模型选择器显示激活状态**：已配置 API Key 的显示 ✅，未配置的显示 🔑 提示
- **升级提醒分两级**：强提醒（弹窗，可选下次/永不）+ 弱提醒（顶部 tooltip 条）
- **streaming 必须支持**：用户发送消息后，AI 回复逐字显示，不能等完整回复才渲染

## 架构决策（已实施）

### OpenClaw verbose 输出解析
- OpenClaw CLI verbose 输出格式（来自 `acp-cli` 模块）：
  - `[tool] <title> (<status>)` — 工具调用开始
  - `[tool update] <toolCallId>: <status>` — 工具状态更新
  - `[permission auto-approved] <tool> (<kind>)` — 权限自动批准
  - `agent_message_chunk` 直接 `process.stdout.write(text)` — 流式文本（无前缀）
- 噪音行前缀：`[plugins]`、`[tools]`、`[agent/`、`[diagnostic]`、`[context-diag]`、`[info]`、`[warn]`、`[error]`、`[acp-client]`、`[commands]`、`[reload]`、`Registered plugin`
- `main.ts` 用 line buffer 机制处理 stdout，分离噪音行和实际内容

### 双层记忆架构（Awareness + OpenClaw Native）
- **Awareness Memory**：长期、云端/本地守护进程、跨项目/跨设备、结构化知识卡
- **OpenClaw Native Memory**：短期、本地 sqlite + markdown 快照、工作区级
- 两套系统零冲突，分别使用不同的 hook 时机和存储后端
- `tools.alsoAllow` 白名单已包含 `awareness_recall/lookup/record`，与 OpenClaw 原生 `memory_search/memory_get` 共存

### Token 优化
- `thinkingLevel` 配置项通过 `--thinking <level>` 传递给 OpenClaw CLI
- `recallLimit` 控制 auto-recall 注入的记忆数量
- Settings 页面显示 token 估算值（recall tokens + thinking tokens + base overhead）

### 流式输出实现
- `main.ts` 通过 `chat:stream` IPC 事件实时发送非噪音文本行到前端
- 前端在 `agentStatus !== 'idle'` 时直接渲染 streamingContent（ReactMarkdown），替代等待全文后的打字机效果
- 打字机效果保留作为 fallback（非流式场景或历史消息首次渲染）

### macOS 系统托盘
- `main.ts` 创建 Tray（18x18 template image），右键菜单：Show/New Chat/Dashboard/Quit
- macOS 下关窗口只 `hide()`，不退出应用；点击托盘图标恢复窗口
- `tray:new-chat` IPC 事件通知前端创建新会话

### 配置导入/导出
- `config:export` — 读 `~/.openclaw/openclaw.json`，包装为 `{ _exportVersion, openclawConfig }` 后通过原生 SaveDialog 写出
- `config:import` — 通过原生 OpenDialog 读入，深度合并 providers 字段后写回
- Settings 页底部 Export/Import 按钮

### 动态模型列表
- `models:read-providers` IPC 读 openclaw.json 的 `models.providers` 全量数据
- `useDynamicProviders()` hook 合并硬编码 MODEL_PROVIDERS + 动态 providers
- 已知 provider 保留 hardcoded emoji/tag/desc 等 UI 元素，动态模型列表覆盖 hardcoded
- CLI 自定义 provider 自动显示为 🔌 Custom
- Dashboard/Settings 全部使用 `allProviders` 替代 `MODEL_PROVIDERS`

### 安全审计
- `security:check` IPC — Unix 检查 openclaw.json 文件权限（非 600 警告）、alsoAllow 过多警告、第三方 extensions 检测
- Settings 页 Security Audit section — amber 背景警告 + fix 命令

### 费用统计
- `src/lib/usage.ts` — 纯前端 localStorage 跟踪，无 IPC
- 每次 chatSend 成功后 `trackUsage(provider, model, inputText, outputText)`
- Token 估算：CJK ~1.5 chars/token, English ~4 chars/token, 混合取平均
- 30 天滚动窗口，最多 5000 条，Settings 页展示 + 按模型分组
- `getUsageStats()` 返回 today + total + byModel 三层汇总

### 每日记忆摘要
- `memory:get-daily-summary` IPC — 组合 knowledge(limit=10) + tasks(limit=5, status=open)
- Memory 页顶部 Daily Summary panel — 仅在 daemon 连接且有数据时显示
- 知识卡片前 5 条 + 待办任务计数

### npm 升级安全网
- 升级前记录 `preSemver`，升级后验证 `openclaw --version` 响应
- npm prefix 不可写时自动 fallback `npx openclaw@latest`
- 自动检测 pnpm/yarn，`setup:install-openclaw` 和 `app:upgrade-component` 统一使用

### 图片理解
- 拖拽图片自动识别（.png/.jpg/.jpeg/.gif/.webp/.bmp/.svg）
- 图片以 `[Images to analyze: /path/to/img] (use exec tool to read or describe these image files)` 格式传给 agent
- OpenClaw agent 不支持 `--files` flag，图片信息通过消息文本传递

### 复用组件
- `PasswordInput.tsx` — 密码输入框 + 眼睛图标切换显隐，全局 4 处使用（Dashboard/Settings/Channels/Setup）

### 升级流程
- `app:check-updates` — 检测 openclaw + plugin 版本差异
- `app:upgrade-component` — 执行 `npm install -g xxx@latest`
- 检测到更新时自动弹出模态框（强提醒），显示版本对比 + 一键升级按钮
- 升级进度实时反馈（spinner / success / error）

### 测试
- 测试框架：vitest + @testing-library/react
- Mock Electron API 在 `src/test/setup.ts`，所有 IPC 方法都有 mock
- 当前 96 个测试（20 个文件），覆盖 Dashboard、Memory、Settings、Store、Channels、Automation、Skills、i18n、Chat Model/Files、Connection、Permissions、Workspace、UpdateBanner、FilePreview、Skills E2E、Automation Cron

## 踩坑记录（必读）

### IPC handler 必须用 async shell exec（严重踩坑，反复出现）
- **问题**：`main.ts` 中所有 IPC handler 最初用 `execSync` / `run()`（同步），导致每次调 `openclaw status`、`npm view`、`npm install -g` 等命令时阻塞 Electron 主线程数秒到数分钟，UI 完全冻结（切换页面、点按钮无响应、升级按钮卡死）
- **根因**：Electron 主线程同时负责 IPC 和渲染调度，`execSync` 阻塞主线程 = 阻塞一切
- **修复**：新增 `safeShellExecAsync()`（短命令）和 `runAsync()`（长命令，如 npm install），基于 `spawn` + Promise，将**所有** IPC handler 改为异步
- **规则**：**`ipcMain.handle` 中禁止使用 `execSync`、`safeShellExec`（同步版）、`run()`（同步版）**。一律用 `await safeShellExecAsync()` 或 `await runAsync()`。同步版本仅保留给 `getNodeVersion()` 等 app 启动前的一次性检测
- **已改造的 handler**：gateway:status/start/stop/restart、app:check-updates、app:upgrade-component、cron:list/add/remove、channel:test、logs:recent、app:get-dashboard-url、setup:install-nodejs、setup:install-openclaw、setup:install-plugin、setup:bootstrap

### OpenClaw 权限模型（调研结论）
- **Tools profile**：`coding`（广泛 shell + 文件读写），`tools.alsoAllow` 白名单额外工具
- **denied 命令**：`camera.snap/clip`, `screen.record`, `contacts.add`, `calendar.add`, `sms.send` 等（在 `openclaw.json → tools.denied`）
- **Gateway**：local 模式绑 loopback:18789，token 认证
- **已安装技能目录**：`~/.openclaw/workspace/skills/<slug>/`，lock 文件 `~/.openclaw/workspace/.clawhub/lock.json`
- **ClawHub REST API**：`GET /api/v1/search?q=...`、`GET /api/v1/skills`、`GET /api/v1/skills/<slug>` — 读操作不需认证
- **插件配置**：`openclaw.json → plugins.entries`（enabled/disabled）、`skills.<slug>.config`
- **工作区文件**：`~/.openclaw/workspace/` 下有 SOUL.md、USER.md、IDENTITY.md、TOOLS.md、MEMORY.md

### openclaw --version 输出含 commit hash
- `openclaw --version` 返回 `OpenClaw 2026.3.28 (f9b1079)`，不能用 `replace(/[^\d.]/g, '')` 提取版本（会把 hash 里的数字带上）
- 必须用 `match(/(\d+\.\d+\.\d+)/)` 精确提取 semver
- 踩坑：导致升级弹窗误判每次都有更新

### chatSend 必须传完整参数
- `chatSend(message, sessionId, options)` 中 options 需包含 `model`（modelId）和 `thinkingLevel`
- 当前只传了 `thinkingLevel`，模型选择器切模型不生效（永远用 openclaw.json 默认模型）
- 附件文件路径需要通过 options 或 `--files` 参数真正传给 OpenClaw agent

### 前端状态必须与 openclaw.json 同步
- Settings 里改了配置，`syncConfig()` 会写 openclaw.json — 但正在运行的 agent 不感知
- 通道连接后 `channelSave()` 写入了 openclaw.json，但前端通道列表没有重新读取状态
- 模型列表 `MODEL_PROVIDERS` 在 store.ts 硬编码了 12 个厂商，不读 openclaw.json 的实际 providers
- **规则**：写入 openclaw.json 后，必须也更新前端状态；涉及 agent 的配置改动需提示用户重启

### Heartbeat 和 Theme 是假功能
- `heartbeatEnabled` / `heartbeatInterval` 是纯 useState，未持久化也未实际启动服务
- 主题选择（Light/Dark/System）只存 localStorage，没有 `document.documentElement.classList.toggle('dark')` — UI 永远暗色
- **规则**：新增开关/配置项必须同时实现持久化 + 生效逻辑

### npm install -g 权限陷阱（跨平台）
- **macOS (Homebrew Node)**：prefix `/opt/homebrew` 或 `/usr/local`，Homebrew 管理权限，通常不需要 sudo
- **macOS (官方 pkg 安装)**：prefix `/usr/local`，npm global 需要 sudo → Electron GUI 环境无法弹 sudo 对话框
- **macOS (自定义 prefix)**：用户可能设了 `npm config set prefix ~/.npm-global`，需确保 `~/.npm-global/bin` 在 `getEnhancedPath()` 中
- **Linux (apt/dnf 安装)**：prefix `/usr`，npm global 一定需要 sudo → `runAsync` 中的 sudo 无法交互式输入密码
- **Windows**：prefix `%APPDATA%\npm`，通常不需要管理员权限，但杀毒软件可能拦截
- **规则**：安装/升级前必须 `npm config get prefix` 检查权限，EACCES 时给用户友好提示，不要静默失败

### Shell 执行必须用 --norc --noprofile（严重踩坑，反复出现）
- **问题**：`spawn(cmd, [], { shell: '/bin/bash' })` 会自动加载 `.bashrc`。如果 `.bashrc` 有 `source ~/.cargo/env` 等不存在的文件，整个命令报错——用户看到 "No such file or directory" 但以为是升级命令的问题
- **修复**：所有 `safeShellExec`、`safeShellExecAsync`、`runAsync` 改为 `spawn('/bin/bash', ['--norc', '--noprofile', '-c', cmd])`，手动 `export PATH=...` 注入增强路径
- **规则**：`main.ts` 中**禁止**用 `{ shell: '/bin/bash' }` 选项，必须显式 `--norc --noprofile`
- **跨平台**：Windows 用 `{ shell: 'cmd.exe' }` 没有此问题；Linux 同样需要 `--norc --noprofile`（用户可能有 `.bashrc` 加载 pyenv/rbenv/nvm 等）

### Embedded agent 工具调用格式与 [tool] 格式不同
- **实际格式**：`[agent/embedded] embedded run tool start: runId=... tool=exec toolCallId=call_xxx`
- **不是**：`[tool] Bash (running)` — 这个格式在 embedded agent 模式下不会出现
- `parseStatusLine` 必须同时支持两种格式（`[tool]` 前缀 + `embedded run tool start/end`）
- 工具名在 embedded 格式中是 `exec`（不是 `Bash`），前端 `getToolIcon` 需要匹配 `exec`
- `toolCallId` 格式为 `call_<hex>`，用于 start/end 配对

### 跨平台 shell 执行差异（必读）
- **macOS/Linux**：`/bin/bash --norc --noprofile -c "export PATH=...; cmd"` — 手动注入 PATH
- **Windows**：`spawn(cmd, [], { shell: 'cmd.exe' })` — cmd.exe 不加载 rc 文件，PATH 通过 env 传入即可
- **PATH 注入方式不同**：macOS/Linux 在 shell 命令中 `export PATH=...`；Windows 通过 `env: { PATH: ... }` 传入
- **路径分隔符**：macOS/Linux 用 `:`，Windows 用 `;` — 已用 `path.delimiter` 处理
- **PATH 顺序**：用户自定义路径 (`~/.npm-global/bin`) **必须排在** 系统路径 (`/usr/local/bin`) 之前，否则早期 `sudo npm install -g` 的残留版本会覆盖新版。踩坑：`/usr/local/bin/openclaw` (3.13) 优先于 `~/.npm-global/bin/openclaw` (3.28) 导致升级后版本不变
- **常见路径**（按优先级排序）：
  - macOS: `~/.npm-global/bin`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.nvm/versions/node/*/bin`
  - Linux: `/usr/local/bin`, `~/.npm-global/bin`, `~/.nvm/versions/node/*/bin`, `/snap/bin`, `~/.fnm/aliases/default/bin`
  - Windows: `%APPDATA%\npm`, `%ProgramFiles%\nodejs`

### openclaw plugins install 在 Electron 中路径丢失
- **问题**：打包后的 Electron 环境中 `openclaw plugins install` 找不到 workspace 路径，回退到根目录，导致 `mkdir '/skills'` ENOENT
- **修复**：plugin 升级优先用 `npx clawhub@latest install awareness-memory --force`（不依赖 OpenClaw workspace），fallback 到 `openclaw plugins install`
- **规则**：在 Electron 打包环境中，优先用 `clawhub` CLI 操作技能，避免依赖 OpenClaw 的 workspace 路径解析

### 升级流程修复记录（2026-03-30）
- plugin 升级：先 `rm -rf ~/.openclaw/extensions/openclaw-memory`，再 `openclaw plugins install`（避免 "already exists"），fallback `clawhub install`
- 版本提取用 `.match(/(\d+\.\d+\.\d+)/)` 而非 `.replace(/[^\d.]/g, '')`（后者会把 commit hash 数字混入）
- **plugin 版本检测优先读 `~/.openclaw/extensions/openclaw-memory/package.json`**（实际安装位置），不是 ClawHub lock.json
- `getEnhancedPath()` 中 `~/.npm-global/bin` 必须排在 `/usr/local/bin` **之前**
- 升级后必须重新 `checkUpdates` 验证版本变化

### openclaw agent 支持的参数（必须先 --help 确认）
- **支持**：`--local`、`--session-id`、`-m`、`--verbose on`、`--thinking <level>`、`--timeout`、`--agent`、`--channel`、`--deliver`
- **不支持**：`--model`（模型通过 `openclaw.json → agents.defaults.model` 配置）、`--files`（文件通过消息文本描述）
- **教训**：加了不存在的 flag（如 `--model`）会导致命令静默失败返回空 → "No response"，不会报错
- **规则**：修改 `chat:send` 命令拼接前，先运行 `openclaw agent --help` 确认参数存在

### OpenClaw 配置结构踩坑（必读）
- **`plugins.entries` 是对象不是数组**：`{ "feishu": { "enabled": true }, "openclaw-memory": { "enabled": true } }`，用 `Object.entries()` 遍历，**不能** `.map()`
- **`hooks` 是嵌套对象**：`{ "internal": { "enabled": true, "entries": { "boot-md": { "enabled": true } } } }`，不是 `Record<event, Array<cmd>>`
- **教训**：写 IPC handler 和前端代码前，必须先 `cat ~/.openclaw/openclaw.json | python3 -c "import json,sys; ..."` 看真实数据结构，不要猜

### 通道连接三大坑（严重踩坑，反复出现）

#### 1. OpenClaw 非 TTY 模式不输出（最致命）
- **问题**：`spawn` 或 `runAsync` 执行 `openclaw channels login` 时，OpenClaw 检测到 stdout 不是 TTY（终端），直接不输出 QR 码和任何交互内容。stdout/stderr 都是空的
- **根因**：OpenClaw CLI 用了类似 `ora`/`ink` 的 TTY 检测，非 TTY 模式下抑制输出
- **修复**：**必须加 `--verbose` 标志**。`openclaw channels login --channel xxx --verbose` 才会在 pipe 模式下输出完整内容（包括 QR 码和 URL）
- **规则**：所有 `openclaw channels login` 调用必须带 `--verbose`

#### 2. QR 链接被内部 URL 抢先匹配
- **问题**：stdout 中 `http://localhost:37800`（Awareness daemon URL）先于 QR 链接出现，正则 `https?://\S+` 先匹配到 localhost → `shell.openExternal` 打开了 localhost 而不是扫码页
- **修复**：URL 过滤跳过 `localhost`、`127.0.0.1`、`docs.openclaw`、`github.com`
- **规则**：URL 检测必须排除内部/文档 URL

#### 3. 通道配置成功但消息不回复（绑定缺失）
- **问题**：通道 login 成功后（`configured, enabled`），用户发消息无回复
- **根因**：Agent 的 `bindings` 为 0 — 通道没有绑定到任何 Agent，消息无法路由
- **修复**：`channel:setup` 成功后自动执行 `openclaw agents bind --agent main --bind <channel>`
- **规则**：**每个通道连接成功后必须自动绑定到 main agent**

#### 4. 微信通道 ID 是 `openclaw-weixin`（不是 `wechat`）
- **问题**：前端用 `wechat`，但 OpenClaw 的 channel ID 是 `openclaw-weixin`（插件 ID）
- 写 `channels.wechat` 到 openclaw.json 会导致 `unknown channel id: wechat` 错误，整个配置无效
- **正确**：openclaw.json 中用 `channels["openclaw-weixin"]`，CLI 用 `--channel openclaw-weixin`
- `channel:list-configured` 需要映射 `openclaw-weixin` → `wechat` 给前端

#### 7. WhatsApp QR 是 ASCII 块字符图形，不是 URL（最新发现）
- **问题**：`openclaw channels login --channel whatsapp --verbose` 调用 `createWaSocket(true, verbose)` → `qrcode-terminal` 输出 `▄▀█` 块字符 QR 到 stdout，**不是** HTTPS URL
- **Signal 类似**：Signal 输出的是 `sgnl://linkdevice?...` 深链接，不是 `https://`
- **WeChat**：插件输出 HTTPS URL → 我们的 URL 检测可以工作 ✅
- **修复**：
  - 按行解析 stdout，检测块字符行（`▄▀█` 占 60%+）构成 QR 块（≥5 行）
  - 将 ASCII QR 通过 IPC `channel:qr-art` 事件发送到前端，在白色背景 `<pre>` 中显示
  - 同时检测 `sgnl://` 深链接并 `shell.openExternal()` 唤起 Signal app
- **前端**：wizard 的 testing 步骤当检测到 `asciiQR` 时切换显示 QR 图形 + 等待扫码提示

#### 5. `runAsync` 超时错误字符串不匹配
- `runAsync` 抛 `"Command timed out"`，但检查用 `msg.includes('timeout')` — `"timed out"` 不包含连续的 `"timeout"`
- **必须**同时检查 `msg.includes('timed out')`

#### 6. `openclaw channels add --channel` 枚举
- 真实支持：`telegram|whatsapp|discord|irc|googlechat|slack|signal|imessage|line`
- **Matrix 不在枚举中**，需要直接写 openclaw.json
- **WeChat 是插件通道**，不在 `channels add` 枚举中

### Local Daemon 启动失败踩坑
- **npx 缓存损坏**（ENOTEMPTY）：`~/.npm/_npx/` 下的缓存目录损坏，`npx @awareness-sdk/local start` 报 `ENOTEMPTY: directory not empty, rename`
- **修复**：删除包含 `@awareness-sdk` 的 npx 缓存目录：`rm -rf ~/.npm/_npx/*/node_modules/@awareness-sdk/..` 对应的父目录
- **Doctor 已集成**：`fixDaemonStart` 自动清理坏缓存再启动
- **better-sqlite3 编译**：daemon 首次启动需要编译 C++ 原生模块，可能耗时 30s+，失败时 daemon 直接 crash 无错误信息

### electron-builder 用独立 tsconfig
- `npm run build:package` 先跑 `tsc -p tsconfig.electron.json`，这和前端的 `npx tsc --noEmit`（用默认 tsconfig.json）是**两个不同的编译**
- 前端 `npx tsc --noEmit` 通过不代表 Electron 端也通过！打包前必须确认 `npm run build` 也能通过
- 踩坑：编辑 `main.ts` 时多了一个 `});` 闭合括号，前端编译没报错但 electron 编译失败

### OpenClaw CLI 超时规则（必读，反复踩坑）
- **问题**：OpenClaw 每次 CLI 命令（`agents add`、`agents delete`、`agents bind` 等）都重新加载所有已安装插件（feishu、awareness-memory、device-pair 等），耗时 **15-30 秒**（低配机器或插件多的环境可能更长）
- **活动超时机制（idle timeout）**：`runAsync` 和 `runAsyncWithProgress` 已改为活动超时 — 每次 stdout/stderr 有输出就重置计时器。只有连续 N 秒无任何输出才判定超时。这样即使 OpenClaw 加载 50 个插件花 2 分钟，只要还在输出 `[plugins] Registered xxx` 就不会超时
- **超时参数的含义**：`runAsync(cmd, 30000)` = 30 秒内无任何输出才超时（不是总耗时 30 秒）
- **推荐超时值**：`agents:add` = 45s idle，`agents:delete/set-identity/bind/unbind` = 30s idle，`agents:list` = 15s idle（只读操作较快）
- **前端必须有状态提示**：长时间操作必须向用户实时显示当前步骤（"正在加载插件..."、"正在创建工作区..."），不能只显示一个 spinner 什么也不说
- **友好的超时错误提示**：如果超时了，不要显示原始的 "Command timed out"，而是告诉用户"OpenClaw 正在加载插件，请重试"

### Gateway 命令踩坑
- **正确命令**：`openclaw gateway start/stop/status/restart`
- **错误命令**：`openclaw up`（不存在）、`openclaw status`（加载全部插件 = 15s+，5s 超时必失败）
- `openclaw gateway status` 比 `openclaw status` 快得多（跳过完整插件加载）
- Gateway 操作超时至少 15s（插件多的环境加载慢）
- `openclaw gateway start` 如果已在运行会报错，需要检查 status 判断"already running"

### ASCII QR 码检测三大坑（WhatsApp/Signal，已修复）
- **坑 1: QR 只发前 5 行**：`isQrLine()` 检测到 5 行时立即发送 `channel:qr-art`，但完整 QR 有 30 行 → 前端只显示一条矮长条。**修复**：用 300ms debounce timer，等所有 QR 行到齐后一次性发送
- **坑 2: QR 永远不发送（原始 bug）**：原代码只在 `else` 分支（收到非 QR 行时）发送 QR 块，但 WhatsApp 输出完 QR 后进程挂起等待扫码，不再有新行 → `else` 永远不触发。**修复**：在 QR 行分支内用 setTimeout 延时发送
- **坑 3: ANSI 转义码干扰检测**：OpenClaw 输出可能含 ANSI 颜色码（`\x1b[...m`），会膨胀字符计数，降低块字符占比到阈值以下。**修复**：`isQrLine()` 先 `stripAnsi()` 再计算比例，阈值从 0.6 降到 0.55
- **坑 4: Config warnings 框的空行误判**：`│                    │` 这样的 box-drawing 空行被误判为 QR（空格占比高），但只有 1 行不会触发发送（≥5 行阈值保护）
- **规则**：QR 相关的 IPC 必须用 `webContents.send`（单向推送），不能放在 `ipcMain.handle` 的返回值里（因为 QR 在 await 中途产生）

### 通道插件未预装导致交互式提示挂起（重要）
- **问题**：对未安装插件的通道执行 `openclaw channels login`，OpenClaw 弹出 `@clack/prompts` 交互式 select（"Install plugin? npm/local/skip"），在非 TTY 的 `spawn` 环境下无法响应，直接挂起到超时
- **影响通道**：所有非预装通道（首次使用的 Telegram/Discord/Slack/Signal/LINE 等）
- **不影响**：WhatsApp（已配置）、WeChat（代码中预装 `@tencent-weixin/openclaw-weixin`）、iMessage（无需插件）
- **修复**：在 `channels login` 前先 `openclaw channels add --channel <id>`（非交互式），确保通道配置存在；如需插件安装，用 `openclaw plugins install @openclaw/<channel>` 代替交互式提示
- **注意**：Telegram/Discord/Slack 实际走 token 流程不走 QR，它们不在 `ONE_CLICK_CHANNELS` 中，但如果用户手动尝试 login 仍会卡住

### 内置通道插件未预编译到 dist（严重踩坑）
- **问题**：`openclaw` npm 包的 `dist/telegram/`（以及 whatsapp/discord/signal/slack/irc/googlechat）目录为空或只有 stub 文件（如 `audit.js`、`token.js`），缺少主入口 `index.js`
- **根因**：`BUNDLED_PLUGIN_METADATA` 中声明了 `dirName: "telegram"` 等，但 `resolveBundledPluginGeneratedPath()` 检测到 `index.js` 不存在时静默跳过，不报错
- **结果**：`channels add --channel telegram --token xxx` 能写入 config，但 Gateway 永远不加载该通道——`channels list` 为空，`agents bind --bind telegram` 报 "Unknown channel"
- **正确安装方式**：`openclaw plugins install @openclaw/<channel>`（如 `@openclaw/telegram`），OpenClaw 会从 bundled extensions 目录安装完整插件到 `~/.openclaw/extensions/telegram/`
- **安装后必须**：`openclaw gateway restart` + `openclaw agents bind --agent main --bind <channel>`
- **桌面端规则**：`channel:setup` IPC 必须在写入 config 前先执行 `plugins install @openclaw/<channel>`，否则通道永远不会被加载

### OpenClaw 每次 CLI 命令都重新加载所有插件（性能坑）
- **问题**：`openclaw channels login` 启动时加载 10+ 个插件（feishu_doc/chat/wiki/drive/bitable、device-pair、phone-control、talk-voice、awareness-memory 等），耗时 15-20 秒，用户看到长时间 spinner
- **无法跳过**：OpenClaw CLI 没有 `--no-plugins`/`--skip-plugins` 选项
- **缓解**：在 `channelLoginWithQR` 的 `processLine` 中检测 `[plugins] Registered` 等日志行，通过 `channel:status` IPC 实时推送加载进度到前端，让用户知道在做什么
- **未来优化**：OpenClaw Gateway 的 WebSocket API 理论上支持 `channels.login`（Gateway 已加载好所有插件），可以避免重复加载。但目前桌面端未实现 Gateway WS 客户端

### Windows Gateway 计划任务缺失（严重踩坑，影响普通用户）
- **现象**：前端只看到 `Gateway failed to start. Please check Settings → Gateway and try again.`，容易误以为是模型 API Key 或 Qwen 配置问题
- **真实含义**：这通常不是模型层问题，而是 OpenClaw Gateway 的 Windows Scheduled Task 没装好或没有权限创建
- `openclaw gateway status` 若显示 `Service: Scheduled Task (missing)`，说明本地服务根本不存在，`openclaw gateway start` 一定失败
- `openclaw gateway install` 若报 `schtasks create failed` / `Access is denied` / `拒绝访问`，说明需要管理员权限创建本地服务
- **产品规则**：桌面端检测到 Gateway 缺失时，必须先自动执行 `openclaw gateway install` 再 `openclaw gateway start`，不能直接报泛化错误
- **降级规则**：如果 Windows 拒绝创建计划任务，桌面端必须 fallback 到 `openclaw gateway run --force` 的当前用户会话模式，保证用户先能聊天，再提示后续可选的管理员修复
- **用户文案规则**：提示里必须明确“这是本地服务安装权限问题，不是 Qwen/OpenAI API Key 配置问题”
![alt text](<截屏2026-04-01 09.13.13.png>)

### 统一通道注册表架构（2026-04-01 实施）

**核心设计**：只有 `wechat` + `local` 是内置通道，其余全部从 OpenClaw 动态发现。

**数据源**：
- `<openclaw>/dist/channel-catalog.json` — 10 个通道的 label/blurb/npmSpec
- `<openclaw>/dist/cli-startup-metadata.json` — 22 个通道 ID 列表
- `openclaw channels add --help` — 动态解析 `--channel` 枚举（决定 CLI vs json-direct）

**KNOWN_OVERRIDES（增强层，不是 hardcode）**：
- 提供品牌色、多字段表单、one-click 流程等 UX 增强
- 新通道自动显示（首字母图标 + 通用 token 表单），无需代码改动
- OpenClaw 更新后新增通道 → 重启 app 自动出现

**CLI vs json-direct 规则**：
- `openclaw channels add --channel` 枚举中的通道（telegram/whatsapp/discord/irc/googlechat/slack/signal/imessage/line）→ 走 `channels add` CLI
- 不在枚举中的通道（msteams/nostr/tlon/mattermost 等）→ 直接写 `openclaw.json channels[id] = { ...config, enabled: true }`
- 通过运行时解析 `--help` 输出动态判断，不 hardcode

**通道配置 schema 来源**：
- OpenClaw 的 `openclaw.plugin.json` 中 `configSchema` 大多为空 `{}`
- 真实 schema 在运行时 Zod 定义中（如 `MSTeamsConfigSchema` 包含 `appId`, `appPassword`, `tenantId`）
- 无法在不执行 JS 的情况下读取 → 多字段通道仍需在 `KNOWN_OVERRIDES` 中维护配置表单
- 通用 token 通道（大多数）自动用默认 `--token` 表单

**文件结构**：
- `electron/channel-registry.ts` — 核心注册表（Electron 主进程用）
- `src/lib/channel-registry.ts` — re-export 给前端 React 组件用
- `src/components/ChannelIcon.tsx` — 12 个品牌 SVG + 动态首字母 fallback
- `src/pages/Channels.tsx` — `DynamicConfigForm` 组件从注册表 configFields 渲染表单

### 升级流程超时与进度反馈（深度踩坑）
- **问题**：升级流程（OpenClaw + Plugin + Daemon）最长可达 10+ 分钟（npm install 依赖 300s 超时 + 多层降级），前端只有一个 spinner，用户完全不知道进度
- **npm install 是黑盒**：npm 在非 TTY（spawn pipe）模式下不输出进度条，stdout 在命令完成后才一次性返回。`--loglevel verbose` 输出太嘈杂且不同 npm 版本格式不一，不推荐
- **超时 = 浪费已完成工作**：如果 npm install 在第 301 秒超时，前面已安装的 80% 依赖全部浪费（因为升级开始时 `rmSync` 了旧目录）
- **解决方案**：
  1. `runAsyncWithProgress(cmd, timeout, onLine)` — 带逐行 stdout/stderr 回调的 spawn 变体，不改动 `runAsync` 本身
  2. `sendUpgradeProgress()` — 主进程通过 `BrowserWindow.webContents.send('app:upgrade-progress')` 实时推送阶段信息到渲染进程
  3. `BrowserWindow.setProgressBar()` — 任务栏/Dock 进度条（>1 = 不确定，0-1 = 确定，-1 = 清除）
  4. 200ms 节流 — 防止 npm 输出行刷爆渲染进程
- **规则**：
  - 长时间命令（>30s）必须使用 `runAsyncWithProgress` 并推送阶段进度，不能让用户看着空白 spinner
  - IPC 进度推送用 `webContents.send`（单向推送），不能放在 `ipcMain.handle` 返回值里
  - 确定进度（如 daemon 健康检查 i/12）传 `progressFraction: 0-1`，不确定进度不传该字段
  - 复用已有模式：`skill:install-progress`（register-skill-handlers.ts）和 `app:startup-status`

### Electron dev 模式踩坑（monorepo）
- **问题**：`./node_modules/.bin/electron .` 在 monorepo 中找不到 electron 二进制（被 hoist 到根 node_modules）
- **`require('electron')` 返回字符串**：在非 Electron 进程中 `require('electron')` 返回的是 electron 可执行文件的路径字符串，不是 API 对象
- **正确方式**：在 `npm scripts` 中用 `electron .`（npm 自动加 PATH），或使用根 `node_modules/.bin/electron`
- **tsconfig.electron.json rootDir**：必须保持 `"electron"`，不能改成 `"."`（否则编译输出目录结构变化，`package.json main` 路径断裂）
- **共享文件**：需要被 Electron 和前端同时 import 的文件（如 channel-registry.ts）放在 `electron/` 目录，前端通过 `src/lib/` re-export