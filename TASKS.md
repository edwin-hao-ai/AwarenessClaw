# AwarenessClaw 任务清单

> 完成一项就打 ✅，附上完成日期。未完成的保持 ⬜。

---

## P1 — 基础骨架（✅ 已完成 2026-03-29）

- [x] Electron + React + Tailwind 项目初始化
- [x] 5 步安装向导（欢迎→安装→模型→记忆→完成）
- [x] 侧边栏导航（聊天/记忆/通道/技能/设置）
- [x] 13 个模型厂商卡片选择器（API 信息已验证）
- [x] 设置页模型切换弹窗
- [x] 设置页所有开关持久化（localStorage + openclaw.json 同步）
- [x] macOS arm64 打包 + 自动启动
- [x] 自动检测/安装 Node.js
- [x] Awareness 插件自动安装
- [x] 本地守护进程自动启动
- [x] 设备认证流程（可选云端）
- [x] Awareness logo (icns) 生成
- [x] GitHub 仓库初始化 + 推送

---

## P2 — 核心功能

### P2.7 — 兼容性架构治理（规划中）
- [ ] 建立统一执行层（ProcessRunner + CommandResolver + EnvProvider），收敛所有 shell/spawn 路径，禁止新增分散执行入口
- [ ] 建立 Capability Snapshot（CLI 参数、channel 枚举、plugin 形态）并在启动时落盘，频道流程仅依赖快照能力判断
- [ ] 建立 GatewaySupervisor + LocalDaemonSupervisor，把主进程内分散的预热/修复逻辑收敛为统一状态机
- [ ] 将 channel 一键连接重构为显式状态机（preflight/install/login/bind/confirm/recover），失败优先自动补救再报错
- [ ] 建立统一错误码与用户文案映射，替换当前零散字符串匹配；前端接入一键修复动作
- [ ] 建立“SDK 复用优先”门禁：新增能力默认复用 Awareness SDK，禁止复制主仓库已有实现
- [ ] 建立“零命令行体验”门禁：用户可见错误必须非技术化 + 一键修复，禁止把终端命令作为主路径
- [ ] 建立“记忆护城河”KPI 看板：记忆可用率、跨会话召回命中率、记忆驱动回复占比纳入每周评审
- [ ] 增加三端 Smoke Matrix（Windows/macOS/Linux）并接入发版门禁，未全绿禁止发布
- [ ] 增加 OpenClaw latest nightly 兼容流水线，自动输出能力差异报告并创建修复任务
- [ ] 建立诊断包导出（traceId + capability snapshot + 最近日志 + 环境信息）用于快速归因
- [ ] 设定兼容性 KPI：频道首连成功率、自动修复成功率、用户可感知等待时长，并在 Dashboard 持续观测
- [ ] 按 docs/structures.md 红线推进主进程拆分，优先低风险抽离，不在同一 PR 混合行为改动和重构

### 聊天（最高优先级）
- [x] 聊天气泡 UI（用户蓝色/AI 深色）
- [x] 后端接通 `openclaw agent --local --session-id ... -m ...`
- [x] 过滤 [plugins]/[tools] 日志噪音
- [x] **流式输出**：CLI 不支持真正 streaming，改用打字机效果（typewriter），视觉上逐字显示（2026-03-30）
- [x] **Thinking 状态展示**：解析 `--verbose on` 的 `[agent/embedded]` 日志，显示 "🤔 思考中..." / "✍️ 生成中..."（2026-03-30）
- [x] **工具调用状态展示**：解析 [tool]/[tool update]/[permission] 日志，实时显示工具名和状态；支持 Awareness Memory 特有事件（recalling/saving/cached）（2026-03-30）
- [x] **历史会话持久化**：消息保存到 localStorage，下次打开恢复。支持多会话（2026-03-30）
- [x] **Markdown 渲染**：代码块高亮、表格、列表、链接（react-markdown + remark-gfm）（2026-03-30）
- [x] **新建会话按钮**：侧边栏顶部 "+ 新对话" 按钮（2026-03-30）
- [x] **会话列表侧边栏**：显示历史会话，可切换、删除（2026-03-30）
- [x] **会话重命名**：双击侧边栏会话名编辑，Enter 保存，Esc 取消（2026-03-30）
- [x] **完整还原 OpenClaw chat 功能**：真正流式输出（替代打字机模拟）、工具调用折叠展示、streaming 状态区实时渲染 Markdown（2026-03-30）
- [x] **文件预览**：拖拽文件后在聊天中预览内容（文本前20行 + 图片缩略图 + 文件大小）（2026-03-30）
- [x] **拖拽文件视觉反馈**：拖拽文件到聊天区域时显示 drop zone 高亮覆盖层（2026-03-30）
- [x] **本地项目目录编辑支持**：聊天页可选择当前项目目录，`chat:send` 在该目录下启动 OpenClaw agent，正式支持修改本地项目文件（2026-03-31）

### Logo & 品牌
- [x] **替换所有脑子 emoji**：侧边栏、聊天 AI 头像、安装向导 — 全部换成 Awareness 真实 logo（2026-03-30）
- [x] **聊天气泡 AI 头像**：用 Awareness logo.png 替代 🧠 emoji（2026-03-30）

### 界面美观
- [x] **聊天界面重新设计**：参考 ChatGPT/Claude 风格，圆角气泡、AI头像、meta 行、打字机光标（2026-03-30）
- [x] **消息气泡优化**：圆角、border、悬浮复制按钮（2026-03-30）
- [x] **输入框优化**：自动增高、Shift+Enter 提示、禁用状态（2026-03-30）
- [x] **聊天布局居中对齐**：消息区域 max-w-3xl 居中（对齐输入框），AI 消息改为 Claude 风格无气泡全宽布局（2026-03-30）
- [x] **API Key 输入显示/隐藏切换**：PasswordInput 组件（眼睛图标），全局 4 处统一替换（Dashboard/Settings/Channels/Setup）（2026-03-30）

### 模型配置
- [x] 模型激活状态 badge（✅已配置 / 🔑需配置）
- [x] 未配置厂商点击弹出 API Key 输入框（2026-03-30）
- [x] 测试连接按钮（设置页模型弹窗中，验证 API Key）（2026-03-30）
- [x] **已安装 OpenClaw 自动延用配置**：检测到已有 providers/models 时跳过模型选择步骤（2026-03-30）

### 记忆系统
- [x] 记忆页接入本地守护进程 MCP API（awareness_lookup type=knowledge）（2026-03-30）
- [x] 语义搜索调用后端（awareness_recall semantic_query）（2026-03-30）
- [x] 感知信号面板接入真实数据（local daemon 新增 type=perception，返回 pattern/staleness 信号）（2026-03-30）
- [x] **Awareness 记忆 vs OpenClaw 原生 memory 协作策略**：双层架构（Awareness=长期跨项目云端，OpenClaw=短期本地工作区），零冲突设计，Memory 页面增加架构可视化（2026-03-30）
- [x] **轻量化 + 节省 token**：新增 Thinking Level 控制（off/minimal/low/medium/high），token 估算显示，recall limit 联动 token 开销（2026-03-30）

### 通道
- [x] 通道配置写入 openclaw.json（Telegram/Discord/Slack/Feishu）（2026-03-30）
- [x] 测试连接功能（channel:test IPC）（2026-03-30）
- [x] 通道状态检测框架（读取 openclaw.json channels）（2026-03-30）
- [x] Telegram 无终端配对闭环：频道页新增“粘贴配对码 + 一键 Approve”，批准后自动重绑 main agent 并自动连通性检测（2026-04-04）

### 定时任务（Cron）
- [x] Cron 可视化管理页面（独立"自动化"tab）（2026-03-30）
- [x] 调用 `openclaw cron list/add/remove`（2026-03-30）
- [x] Heartbeat 开关 + 频率配置（2026-03-30）
- [x] **可视化时间选择器**：频率选择（Daily/Hourly/Weekly/Custom）+ 时间选择器 + 星期选择器，非技术用户友好（2026-03-30）
- [x] **Cron 表达式人类可读翻译**：任务列表中把 `0 9 * * *` 显示为 "Daily 09:00"（2026-03-30）

### 系统管理
- [x] Gateway 启动/停止/重启按钮
- [x] Gateway 状态实时检测
- [x] 日志查看器弹窗
- [x] 系统诊断（设置页环境检测按钮）（2026-03-30）

### 升级提醒
- [x] **强提醒（弹窗）**：模态框 — 立即升级 / 下次提醒 / 永不提醒（2026-03-30）
- [x] **弱提醒（tooltip）**：顶部提示条，手动关闭（sessionStorage）（2026-03-30）
- [x] 检测 OpenClaw / Awareness 插件版本（npm view 对比）（2026-03-30）

### OpenClaw 初始化
- [x] 已安装 OpenClaw 检测 + 配置复用（setup:read-existing-config）（2026-03-30）
- [x] 新用户 bootstrap 流程引导（安装后自动运行 `openclaw doctor --fix`）（2026-03-30）
- [x] openclaw.json 安全写入（深度合并，不覆盖 providers）（2026-03-29）
- [x] **Windows 首装 OpenClaw 安装超时修复**：OpenClaw 安装/升级超时统一提升到 5 分钟，避免正常安装在 90 秒时被误杀；超时提示改为用户友好文案（2026-04-03）
- [x] **Setup 安装状态细化**：OpenClaw 安装过程增加阶段状态和心跳提示，展示“检查 / 下载 / 验证 / 备用源 / 官方安装器”等实时进度，减少首装焦虑（2026-04-03）
- [x] **Windows Chat `pairing required` 修复**：桌面端 Gateway WebSocket 改为使用 OpenClaw control UI 客户端标识和 loopback Origin；若命中本地 scope upgrade 配对请求，主进程自动执行 `openclaw devices approve --latest` 后重连，避免用户手动修复（2026-04-03）
- [x] **Windows 本地 daemon 启动兜底修复**：桌面端改用 `npx.cmd` 并在缺失时回退到 bundled npm CLI，避免 Electron 里用 bare `npx` 触发 `ENOENT` 导致聊天前本地服务拉不起来（2026-04-03）
- [x] **Windows Gateway token_missing 修复（BOM 容错）**：openclaw.json 带 UTF-8 BOM 时，桌面端读取配置会 JSON.parse 失败导致 token 丢失；主进程改为 BOM 容错 JSON 读取，Gateway WS 握手恢复带 token 鉴权（2026-04-03）

---

## P2.5 — 关键 Bug 修复（2026-03-31）

### 性能优化（✅ 已完成）
- [x] Dashboard 打字机 15ms setInterval → RAF + 30ms 节流（CPU 占用大幅降低）
- [x] Settings Gateway 轮询改为 visibilitychange 感知 + 30s 间隔（省电）
- [x] Node.js 安装等待 120×2s → 30 次指数退避（~90s 上限）
- [x] daemon 关闭/升级/gateway 启动轮询全部加指数退避

### Gateway 无法启动（✅ 已修复）
- [x] `tools.denied: []` 写入 openclaw.json 导致 OpenClaw 配置校验失败，所有命令报错
- [x] `permissions:update` 和 config merge 只在 denied 非空时写入

### openclaw-memory 插件本地模式（✅ 已修复）
- [x] 插件 `memory-awareness.ts` 强制要求 apiKey + memoryId → 本地模式（localUrl）跳过校验
- [x] 插件成功注册到 OpenClaw Gateway（日志确认 `Awareness memory plugin initialized (local daemon)`）

### Dashboard 切换 tab 丢失对话（✅ 已修复）
- [x] App.tsx 条件渲染 → Dashboard 始终 mounted + CSS hidden
- [x] 切回 Chat 自动 focus 输入框 + 滚动到最新消息
- [x] RAF 打字机在 app 隐藏时跳到最终状态

### 测试修复（✅ 已修复）
- [x] dashboard.test.tsx / update-banner.test.tsx 的 `getByText('AwarenessClaw')` → `getByAltText`（头部 UI 改为 logo img）

### Chat 上下文连贯性（✅ 已调查 2026-03-31）
- [x] **排查 `openclaw agent --local --session-id` 是否维护多轮对话历史**：确认 OpenClaw 在 `~/.openclaw/agents/main/sessions/<id>.jsonl` 中维护完整对话历史，session-id 相同时上下文连贯 ✅
- [x] 真正问题是 Awareness 插件 auto-recall 注入了 Claude Code 编程记忆（source=mcp），导致 AI 上下文混乱 → 已通过 sourceExclude 修复 ✅

### Daemon 记忆隔离（✅ 已修复 2026-03-31）
- [x] **根因修复**：`daemon.mjs` `_remember()` 中 `source` 字段被硬编码为 `'mcp'`，无论调用方传什么来源都被覆盖 → 改为 `params.source || 'mcp'` ✅
- [x] **`awareness_record` MCP 工具**：schema 中加入 `source` 字段（daemon.mjs 和 mcp-server.mjs 两处）✅
- [x] **`awareness_recall` source_exclude 过滤**：MCP 工具加 `source_exclude` 参数，search.mjs recall() 加后过滤，daemon REST `/memories` 加 `source_exclude` 查询参数 ✅
- [x] **openclaw-memory 插件**：auto-recall 时传 `sourceExclude: ['mcp']`，确保聊天上下文中不再注入 Claude Code 编程记忆 ✅
- [x] **Memory 页面**：sourceView 切换现在在 API 层面过滤（不再是前端过滤），节省网络传输 ✅

### Chat 功能对齐 OpenClaw Web UI（进行中 2026-03-31）
- [x] **消息队列**：agent 运行时 textarea 保持可用，消息排队自动发送 ✅
- [x] **Stop 按钮**：agent 运行时显示 Stop 按钮，kill 子进程 ✅
- [x] **代码块复制按钮**：已有 CodeBlock 组件 ✅
- [x] **Gateway 模式**：去掉 `--local` flag，通过 Gateway 运行（更好的会话管理）✅
- [x] **WebSocket 直连 Gateway**：`gateway-ws.ts` 386 行完整 WS 客户端 + Ed25519 v3 签名 + 设备身份认证，已用于聊天和统一收件箱（2026-04-02）
- [x] **chat.abort RPC**：`register-chat-handlers.ts` 实现双路径：Gateway WS `chatAbort()` RPC 优先 + CLI SIGTERM fallback（2026-04-02）
- [x] **chat.history 同步**：桌面聊天切换 session 时优先从 Gateway 加载历史 + 与 localStorage 合并去重；`chat:load-history` IPC + preload 暴露；Gateway 不可用时静默 fallback localStorage（2026-04-03）

### OpenClaw MD 文档管理
OpenClaw 的 chat 质量依赖 `~/.openclaw/workspace/` 下的 MD 文档：
| 文件 | 功能 | 重要性 |
|------|------|--------|
| **SOUL.md** | Agent 人格/身份设定 | 高 |
| **USER.md** | 用户信息（名字、偏好等） | 高 |
| **IDENTITY.md** | Agent 显示名/头像/emoji | 中 |
| **TOOLS.md** | 工具使用备注 | 低 |
| **MEMORY.md** | 长期记忆配置 | 中 |
| **HEARTBEAT.md** | 定时检查任务 | 低 |
| **AGENTS.md** | 工作区设置 | 低 |
- [x] **Settings 页集成 MD 编辑器**：Settings Workspace section 已有 SOUL.md/USER.md/IDENTITY.md/TOOLS.md 的模态编辑器，支持创建+修改+保存（2026-03-30）
- [x] **AGENTS.md 可视化编辑支持**：Settings / Agents 页面均已纳入 AGENTS.md，便于直接查看和修改 OpenClaw 工作区默认规则；同时补充 bootstrap 触发测试，明确 onboarding 以 USER.md 是否存在为准（2026-04-02）
- [x] **首次使用 Bootstrap 引导**：新用户首次打开 Chat 时显示 3 步向导（名字→AI 风格→AI 名字），自动生成 SOUL.md/USER.md/IDENTITY.md，支持跳过。检测 USER.md 存在则跳过引导。中英双语。（2026-03-31）
- [x] **Agent 人格设定 UI**：Settings Workspace + Agents 页均可编辑 SOUL.md（系统提示词），用户无需懂 Markdown（2026-03-30）

### 多 Agent 聊天切换（2026-03-31）
- [x] **Agent 选择器**：聊天输入框底部工具栏新增 Agent 切换下拉菜单（当存在 2+ agents 时显示），选中的 agent ID 持久化到 localStorage + 传给 `chat:send`（2026-03-31）
- [x] **chat:send 支持 agentId**：main.ts `chat:send` handler 接受 `agentId` 参数，非 main agent 时传 `--agent "<id>"` flag 给 OpenClaw CLI（2026-03-31）
- [x] **Agent 快速创建入口**：聊天页 Agent 选择器底部加"管理 Agent"跳转链接，点击导航到 Agents 页面（2026-04-01）

---

## P3 — 进阶功能

### 技能市场（ClawHub 集成）
- [x] **技能列表接入真实数据**：读 lock.json 已安装 + ClawHub REST API explore，替代 mock 数据（2026-03-30）
- [x] **技能搜索**：调 ClawHub `/api/v1/search` 向量搜索（2026-03-30）
- [x] **技能安装/卸载**：`runAsync('npx clawhub install/uninstall')` + 进度反馈 + 错误提示（2026-03-30）
- [x] **技能详情页**：点击技能卡片弹出详情模态，显示 SKILL.md 内容、版本、作者、安装/卸载按钮（2026-03-30）
- [x] **技能配置编辑**：读/写 `openclaw.json → skills.<slug>.config`，支持增删改键值对，dirty tracking + Save 按钮（2026-03-30）
- [x] **技能依赖自动匹配安装**：依赖安装支持 Windows `winget search --command` 自动匹配包 ID、已知别名回退、安装后补查剩余缺失 bin，并实时推送进度到前端（2026-04-04）
- [x] **内置能力展示**：新增 Built-in tab，展示 OpenClaw 内置的 8 大能力（浏览器/Shell/文件/图片/记忆/消息/自动化/搜索），让用户知道开箱即用的能力（2026-04-01）
- [x] **推荐安装板块**：Explore tab 顶部显示 4 个精选推荐 skill（tavily-search/capability-evolver/github/obsidian），带推荐理由和一键安装（2026-04-01）
- [x] **前端分页**：Load More 按钮，每次加载 20 条，避免一次性渲染全部技能（2026-04-01）
- [x] **浏览器工具自动启用**：`syncToOpenClaw` 确保 `tools.profile: "coding"` 写入 openclaw.json，激活浏览器/Shell/文件等全部内置工具（2026-04-01）

### 权限管理
- [x] **权限概览面板**：Settings 页显示 tools profile、alsoAllow 标签列表（可增删）、denied 命令标签列表（可增删）（2026-03-30）
- [x] **安全审计提示**：Settings 页新增 Security Audit section — 检测 openclaw.json 文件权限（非 600 时警告 + 修复命令）、tools.alsoAllow 过多时警告、第三方 extensions 检测（2026-03-30）
- [x] **权限预设方案 UI**：3 张卡片（安全/标准/开发者模式），一键应用，自动检测当前是哪个预设，高级设置折叠（2026-03-31）

### 工作区设置
- [x] **工作区文件编辑器**：Settings 页 Workspace section，编辑 SOUL.md / USER.md / IDENTITY.md / TOOLS.md（模态框 + 保存）（2026-03-30）
- [x] **已安装插件管理**：Settings 页 Plugins section，读 `plugins.entries` 显示列表 + enabled/disabled Toggle（2026-03-30）
- [x] **Hooks 管理**：Settings 页 Hooks section，按事件名分组显示 hook 命令 + enable/disable Toggle（2026-03-30）

### 其他
- [x] macOS 系统托盘集成（关窗隐藏、托盘菜单：显示/新对话/Dashboard/退出、点击图标恢复窗口）（2026-03-30）
- [x] 配置导入/导出（Settings 页导出 JSON + 导入深度合并，含原生文件对话框）（2026-03-30）
- [x] **多 Agent 管理**：Agents 页面 — 列出已配置 agents（`openclaw agents list --json`），创建新 agent，删除非 default agent，显示 emoji/name/bindings（2026-03-30）
- [x] **Gateway 自动启动**：`chat:send` 前自动检测 Gateway 状态，未运行时自动 `openclaw up`，轮询最多 10s 等待就绪，用户无需手动启动（2026-03-30）
- [x] **Agent 定义编辑**：Agents 页面新增工作区文件编辑器 — SOUL.md（系统提示词）、TOOLS.md（工具配置）、IDENTITY.md、USER.md、MEMORY.md 五个文件 tab 切换编辑，dirty tracking + Save 按钮，创建时可直接写入 SOUL.md（2026-03-30）
- [x] **Agent 创建增强**：创建表单改为展开式（Create Agent 按钮触发），支持名称 + 模型 + 系统提示词三项，创建前自动确保 Gateway 运行和目录存在（2026-03-30）
- [ ] iOS/Android 扫码配对
- [ ] TTS/STT 语音支持
- [x] **图片理解**：拖拽图片时自动识别为图片文件（.png/.jpg/.gif/.webp/.svg/.bmp），发送时以 `[Images to analyze: ...]` 格式传给 agent（2026-03-30）
- [x] **费用统计面板**：`src/lib/usage.ts` 本地 token 估算（CJK ~1.5 chars/token, EN ~4），Settings 页显示今日/30天消息数和估算 tokens，按模型分组，支持清零（2026-03-30）
- [x] **每日记忆摘要**：Memory 页顶部 Daily Summary section，调 `memory:get-daily-summary` IPC 获取最近知识卡片 + 待办任务数，daemon 未连接时不显示（2026-03-30）

---

## P2.5 — 记忆系统深度整合（替代 OpenClaw 原生 memory + 超越 QMD 插件）

> **目标**：让 Awareness 记忆成为 OpenClaw 的**唯一记忆源**，覆盖所有通道（微信/WhatsApp/Telegram/桌面聊天），深度替代 OpenClaw 的 `memory-core` + `memory-lancedb` 原生记忆，并超越 QMD 插件的功能。

### 记忆页重写（去 mock，真实数据）
- [x] **去掉所有 mock fallback**：daemon 没连接时显示空状态 + "Start Daemon" Fix 按钮（一键拉起）（2026-03-30）
- [x] **记忆时间线视图**：展示实际记忆事件（不只是知识卡），包含时间、内容摘要、来源通道、会话 ID（2026-03-30）
- [x] **记忆详情展开**：点击事件展开完整内容，超过 200 字自动折叠（2026-03-30）
- [x] **记忆搜索结果高亮**：`HighlightText` 组件已实现，用 amber 色标记匹配文字，应用到 event titles/content 和 knowledge card titles/summaries（2026-03-30）

### 全通道记忆捕获
- [x] **微信/WhatsApp/Telegram 消息自动写入 Awareness 记忆**：验证确认 OpenClaw 插件 `agent_end` hook 在 Gateway 模式下已生效（Agent 绑定到通道时触发），添加通道来源检测（2026-03-30）
  - 方案 C 确认：`agent_end` hook 在 Gateway 模式下自动触发（Agent 处理通道消息后），source 从 context 动态提取通道名
- [x] **桌面聊天消息也写入记忆**：`chat:send` 完成后 fire-and-forget 调 `awareness_record`，source 标记为 `desktop`（2026-03-30）
- [x] **通道来源标记**：`agent_end` hook 中从 context 提取 channel/channelId/source，生成 `openclaw-{channel}` 格式的 source 标记（2026-03-30）
- [x] **桌面端可查看所有通道的对话历史**：通过 Gateway WebSocket `sessions.list` + `chat.history` RPC 实现统一收件箱。device identity Ed25519 签名认证 Gateway 连接，侧边栏分组显示通道/本地会话，点击加载历史，支持实时消息推送和桌面端回复（2026-03-31）

### 本地向量搜索
- [x] **本地 embedding 模型自动下载**：已实现，使用 `@huggingface/transformers` (ONNX WASM) + `Xenova/all-MiniLM-L6-v2` (23MB)，daemon 启动时后台预热+下载，改进了诊断日志和 healthz 返回 embedding 状态（2026-03-30）
  - 当前 daemon healthz 确认 `search_mode: "hybrid"`，模型正常工作
  - healthz 新增 `embedding` 字段返回可用状态和模型名
  - 失败时输出清晰的诊断信息（常见原因 + 修复命令）
- [x] **混合搜索**：已实现，向量搜索 + FTS5 全文搜索混合排序（search.mjs），daemon healthz 显示 `search_mode: "hybrid"`（2026-03-30）

### 超越 QMD 插件的差异化功能
- [x] **知识卡片自动提炼**：Memory.tsx 完整实现 9 类 category 系统 + 真实 MCP 数据解析 + 每日摘要 + 分类筛选（2026-04-01）
- [x] **跨会话知识图谱**：Memory 页新增 Graph tab，使用 react-force-graph-2d 力导向图。节点=知识卡片（按 category 着色），边=关键词重叠（≥20%）+ 会话时间窗口关联。支持悬浮详情、缩放平移、类别图例。lazy-load 独立 chunk（194KB）（2026-04-03）
- [x] **感知信号面板**：Memory.tsx 已实现 4 种信号类型（contradiction/pattern/resonance/staleness），彩色 UI + daemon type=perception 数据接入（2026-04-01）
- [x] **记忆冲突检测**：Knowledge card 显示 superseded 状态（amber 徽章 + 删除线 + 半透明），后端 5 类分类器已对接（2026-04-01）
- [x] **隐私控制**：Settings Memory Privacy section — 7 个来源的记忆捕获开关（desktop/telegram/whatsapp/discord/slack/wechat/dev-tools），blockedSources 同步到 openclaw.json 插件配置；一键删除所有知识卡片按钮（调 daemon DELETE /knowledge/cleanup）（2026-04-01）

### Daemon 健壮性
- [x] **npx 缓存损坏自动修复**：`doctor.ts` `fixDaemonStart()` 主动清理 `~/.npm/_npx/` 坏缓存 + `local-daemon.ts` `clearAwarenessLocalNpxCache()`（2026-04-01）
- [x] **开机自动启动 daemon**：`daemon-autostart.ts` 三平台实现：macOS LaunchAgent (`com.awareness.local-daemon.plist`) / Windows schtasks (ONLOGON) / Linux systemd user service。Settings 页新增 "Memory Service at Boot" 开关，IPC `app:set/get-daemon-autostart`（2026-04-03）
- [x] **daemon 崩溃自动重启**：`daemon-watchdog.ts` 每 60s 健康检查 + 自动 spawn 重拉（2026-04-01）
- [x] **better-sqlite3 编译失败降级**：Memory 页检测 `daemonHealth.search_mode !== 'hybrid'` 时显示 amber 提示条 "Semantic search unavailable"，引导重启 daemon（2026-04-03）

## P4 — 长尾功能

- [x] 更多通道（Teams, Twitch, Zalo）— 已通过动态通道注册表（Unified Channel Registry）自动覆盖所有 OpenClaw 支持的通道（2026-04-01）
- [ ] 团队记忆
- [ ] 自定义技能创建
- [ ] 多语言 UI（当前中英双语基本覆盖）

---

## 技术债务 & Bug

- [x] ~~通道连接后消息无响应~~ — channel:setup 加 `--verbose` flag（非 TTY 无输出）+ 成功后自动 `openclaw agents bind --agent main --bind <channel>`（2026-03-31）
- [x] ~~新建会话按钮样式粗糙~~ — 重设计为 Claude Desktop 风格（圆角+图标+hover动画+⌘N 快捷键提示），同时注册全局 ⌘N/Ctrl+N 键绑定（2026-03-31）
- [x] ~~代码块无语言标签无复制按钮~~ — 新增 CodeBlock 组件（语言标签 + copy 按钮 + 圆角 header），所有 markdown 渲染路径统一使用（2026-03-31）
- [x] ~~工具调用折叠无动画~~ — ToolCallsBlock 改用 max-h CSS transition（200ms），ChevronRight 旋转代替切换 ChevronDown（2026-03-31）
- [x] ~~openclaw agent session conflict~~ — 用 --local --session-id 解决
- [x] ~~.bash_profile cargo/env 报错~~ — 用 --norc --noprofile
- [x] ~~plugins.allow 警告~~ — 写入 plugins.allow
- [x] ~~Setup.tsx 残留代码~~ — 清理 4957 chars
- [x] ~~saveConfig 覆盖用户 providers~~ — 改为深度合并
- [x] ~~升级按钮不生效~~ — plugin 升级命令错误、版本 regex 混入 commit hash、PATH 缺 ~/.npm-global/bin、升级后未重新验证（2026-03-30）
- [x] ~~所有 shell 执行报 cargo/env 不存在~~ — safeShellExec/runAsync 全部改为 `--norc --noprofile` 模式（2026-03-30）
- [x] ~~openclaw plugins install 报 plugin already exists~~ — 升级前先 rm -rf 旧 extension 目录（2026-03-30）
- [x] ~~升级后版本不变（3.13→3.28）~~ — `~/.npm-global/bin` 必须排在 `/usr/local/bin` 前面，否则找到旧版残留（2026-03-30）
- [x] ~~Settings 页白屏~~ — plugins.entries 是对象不是数组，P3 代码假设错误导致 .map() crash（2026-03-30）
- [x] ~~Plugin 版本检测读错位置~~ — 改为读 `~/.openclaw/extensions/openclaw-memory/package.json`（实际安装位置）（2026-03-30）
- [x] **通道连接全面修复**：所有通道（Telegram/Discord/LINE/Slack/飞书/Matrix/Google Chat）的 `channel:save` 均已统一修复为三步流程（plugin install → channels add / config write → gateway restart + agent bind）。`channel:test` 凭据检查已覆盖所有字段（token/botToken/appId/appSecret/serviceAccountFile/homeserver 等）。Telegram 手动验证通过（Windows CLI + 桌面端代码审计）。飞书/Matrix/Google Chat 直接写 JSON 的路径同样补齐了 plugin install + gateway restart + agent bind（2026-04-01）
- [x] **一键通道连接确认优化**：`channel:setup` 改为登录成功后短轮询 `openclaw channels list`，确认超时时返回“仍在确认中”而不是直接失败；`openclaw-shell-output` 新增混合 stderr/JSON 解析测试，减少 agent/channel 列表偶发空白（2026-04-02）
- [x] **权限管理 UI 重设计**：`SettingsPermissionsPanel.tsx` 实现 3 张预设卡片（Safe/Standard/Developer），图标+颜色+一键切换，替代手写工具名（2026-04-01）
- [x] **新建会话按钮美化**：`SessionSidebar.tsx` Claude Desktop 风格（rounded-xl + hover 动画 + ⌘N 快捷键 badge + brand 色图标）（2026-03-31）
- [x] **聊天 UI 细节打磨**：`ChatMessagesPane.tsx` 圆角气泡 + 悬浮复制按钮 + 代码块语言标签/copy + 工具折叠 ChevronRight 旋转动画 + streaming 闪烁光标（2026-04-01）
- [x] **主题切换（Light/Dark/System）真正生效**：Settings 页的 Theme toggle 之前只切换了 HTML class 但没有任何 light mode CSS。修复：在 `index.css` 中通过 `:root:not(.dark)` 选择器覆盖整个 slate 调色板（bg/text/border/divide/ring/scrollbar），`index.html` 加 blocking script 防止白闪。零组件文件修改，纯 CSS 方案（2026-03-31）
- [x] **Auto Update 开关真正生效**：Settings 页的 autoUpdate toggle 之前只存 localStorage 不起作用。修复：`UpdateBanner.tsx` 读取 `config.autoUpdate`，为 `false` 时跳过 `checkForUpdates()`。新增测试验证（2026-03-31）
- [ ] Windows / Linux 打包未测试
- [x] **macOS 无法退出应用**：`close` 事件中 `if (tray)` 永远为 true 导致 `preventDefault()` 阻止所有关窗。修复：`isQuitting` 标志 + `before-quit` 事件设置（2026-03-30）
- [x] **Daemon 升级失败（Exit code 1）**：daemon 通过 `npx` 运行不是全局安装，`npm install -g` 无效。改为先 shutdown → `npx -y @latest start`（2026-03-30）
- [x] **Setup 向导假成功**：`installPlugin()` / `startDaemon()` 失败时前端不再误显示 done，改为检查 success 并显示友好错误（2026-03-30）
- [ ] **OpenClaw 安装脚本供应链风险**：当前 Windows 用 `irm ... | iex`、mac/Linux 用 `curl ... | bash`，缺少签名/校验。需要改为下载后校验 hash/signature 再执行
- [x] **配置导入/导出含敏感信息**：导出前增加敏感信息提示，支持脱敏导出；导入改为按真实 `models.providers` 结构深合并，并忽略脱敏占位值（2026-03-30）
- [x] **安全审计覆盖不足**：新增 Windows ACL 检查、离线 tgz manifest/checksum 检查、升级回滚准备状态提示（2026-03-30）
- [x] **Windows 安装器进度可视化**：NSIS 改为引导式安装，强制当前用户安装并显示明确安装进度页，避免用户误以为卡死（2026-03-31）

### 技术债务（已知 · 待后续处理）
- [x] **Agents 创建修复**：创建前先 `mkdirSync` workspace 目录，避免 `openclaw agents add` 因目录不存在失败（2026-03-30）
- [x] **Agents 绑定/身份编辑**：Agents 页面新增 inline 编辑（emoji + name → `set-identity`）、绑定管理（add/remove → `bind/unbind`）、错误提示（2026-03-30）
- [ ] **Daemon 版本与项目源码不一致**：当前 daemon 从 `sdks/local/` 源码运行（v0.1.0），npm 上是 v0.4.0。需要统一版本管理策略

### npm 全局安装权限 & 跨平台兼容（必须验证）

> **背景**：`npm install -g` 在不同系统/安装方式下权限行为差异巨大，当前代码没有任何权限预检和 EACCES 错误处理，导致安装/升级可能静默失败。

#### 🔴 权限预检与错误处理
- [x] **npm prefix 权限预检**：升级前 `npm config get prefix` + `fs.accessSync(prefix, W_OK)`，不可写时返回友好指引（2026-03-30）
- [x] **EACCES 错误捕获与友好提示**：catch 中检测 EACCES/permission denied，提示 `npm config set prefix ~/.npm-global`（2026-03-30）
- [x] **Linux sudo 权限问题**：改为先检测 `pkexec`（GUI 密码对话框），fallback 到 `sudo`，失败时返回友好终端命令提示（2026-03-30）

#### 🟡 跨平台安装路径验证
- [x] **macOS 路径验证（代码审查）**：Homebrew `/opt/homebrew/bin`、官方 pkg `/usr/local/bin`、nvm 动态检测、自定义 prefix `~/.npm-global/bin` — 全部覆盖且优先级正确（2026-03-30）
- [x] **Windows 路径验证（代码审查）**：`%APPDATA%\npm`、`%ProgramFiles%\nodejs`、新增 `%LOCALAPPDATA%\pnpm`（pnpm 全局）和 `%LOCALAPPDATA%\fnm_multishells`（fnm Windows）（2026-03-30）
- [x] **Linux 路径验证**：`getEnhancedPath()` 已添加 `/snap/bin`、`~/.fnm/aliases/default/bin`（动态检测 fnm 安装），pkexec 优先 sudo（2026-03-30）

#### 🟢 降级策略
- [x] **npm global 不可写时的 fallback**：prefix 不可写时自动尝试 `npx openclaw@latest` 运行（无需全局安装），fallback 返回 hint 引导改 prefix（2026-03-30）
- [x] **升级失败后的恢复**：升级后验证 `openclaw --version` 响应，无响应时返回错误含 previousVersion 信息（2026-03-30）
- [x] **多包管理器支持**：自动检测 pnpm/yarn，使用对应全局安装命令（`pnpm add -g` / `yarn global add` / `npm install -g`），安装和升级流程统一（2026-03-30）

### 通道连接真实实现
- [x] **通道列表对齐 OpenClaw**：验证 `openclaw channels --help` 支持的通道（telegram/discord/slack/whatsapp/signal/imessage/googlechat/line/matrix），新增 LINE 和 Matrix 通道卡片，feishu 保留（via plugin）（2026-03-30）
- [x] **通道测试改进**：`channel:test` 改为三步验证：①检查 openclaw.json 凭证 ②`openclaw channels status` 检测 Gateway ③`openclaw channels list` 确认注册状态，提供详细诊断（2026-03-30）
- [x] **通道列表从 OpenClaw 动态获取**：新增 `channel:list-supported` IPC，读 `openclaw channels list` 解析支持的通道，动态追加到硬编码列表中（2026-03-30）
- [x] **统一通道注册表（Unified Channel Registry）**：只保留 wechat（json-direct）+ local 为内置，其余 22 个通道全部从 OpenClaw `channel-catalog.json` + `cli-startup-metadata.json` 动态发现。通道配置表单由注册表 `configFields` 驱动（DynamicConfigForm 替代 6 个 switch-case）。已知通道有品牌 SVG 图标 + 准确的 CLI flag 映射（slack 双 token、matrix 三字段、googlechat webhook 等）；未知通道显示首字母图标 + 通用 token 表单。Dashboard 统一收件箱从 emoji 改为 SVG 图标。28 文件 165 测试全过（2026-04-01）

### i18n 国际化
- [x] **i18n 基础系统**：`src/lib/i18n.ts` — 零依赖、中英双语、`useI18n()` hook（2026-03-30）
- [x] **Sidebar i18n**：聊天/记忆/通道/技能/自动化/设置（2026-03-30）
- [x] **Dashboard i18n**：空状态、输入框、状态标签、建议问题（2026-03-30）
- [x] **Automation i18n**：所有按钮、标签、提示文字（2026-03-30）
- [x] **Settings i18n**：所有 section 标题、行标签、按钮文字（2026-03-30）
- [x] **Skills i18n**：页面标题、搜索框、安装/卸载按钮（2026-03-30）
- [x] **Channels i18n**：通道名、向导步骤文字（2026-03-30）
- [x] **UpdateBanner i18n**：升级弹窗文字（2026-03-30）
- [x] **Setup i18n**：安装向导所有步骤文字（2026-03-30）
- [x] **Memory i18n**：页面标题、搜索框、卡片标签（2026-03-30）

### 关键 Bug（假完成 / Mock 数据）

#### 🔴 CRITICAL
- [x] **聊天文件附件未真正发送**：改为通过 `--files` 参数传给 OpenClaw agent，不再拼接到消息文本（2026-03-30）
- [x] **模型切换不生效**：chatSend 现在传 `model: providerKey/modelId` 给 OpenClaw agent `--model` 参数（2026-03-30）
- [x] **通道连接状态硬编码**：新增 `channel:list-configured` IPC，从 openclaw.json channels 读取已配置通道，动态更新 UI（2026-03-30）

#### 🟡 HIGH
- [x] **Heartbeat 是假功能**：改为 localStorage 持久化 + cron job 注册（2026-03-30）
- [x] **通道测试是假的**：channel:test 改为先验证 openclaw.json 有凭证，再尝试 openclaw 命令，提供诚实反馈（2026-03-30）
- [x] **主题切换不生效**：App.tsx 添加 useThemeEffect hook，真正切换 document.documentElement 的 dark/light class（2026-03-30）
- [x] **记忆页 Mock 数据无标识**：添加 isMockData 状态 + 醒目的 amber 警告条："Showing example data"（2026-03-30）

#### 🟢 MEDIUM
- [x] **Gateway 操作无进度反馈**：gatewayLoading 已有 spinner（原代码已实现），确认正常（2026-03-30）
- [x] **模型列表动态化**：新增 `models:read-providers` IPC 读 openclaw.json providers，`useDynamicProviders()` hook 合并硬编码 + 动态列表，CLI 自定义厂商自动显示为 🔌 Custom（2026-03-30）
- [x] **Settings 模型切换需重启**：保存模型后显示 amber 提示条 "Start a new chat session to use the new model"（2026-03-30）

### 聊天中 Bash 操作
- [x] **Bash 命令执行验证**：OpenClaw agent 使用 `tool=exec` 执行 bash 命令，输出作为 agent 回复（Markdown 代码块）正常流式显示（2026-03-30）
- [x] **Embedded agent 工具状态解析**：verbose 输出格式为 `[agent/embedded] embedded run tool start/end: ... tool=exec toolCallId=...`，新增正则匹配，工具调用状态（exec: Running... / Done）正确显示在聊天界面（2026-03-30）
- [x] **工具图标识别**：exec/bash/shell/command 类工具显示 Terminal 图标（2026-03-30）

### 测试质量提升（116 tests / 26 files — 2026-03-30）
- [x] **AwarenessClaw 最小 CI**：新增 GitHub Actions workflow，针对 push / PR 运行 desktop build、CLI smoke build 和关键前端测试（agents/dashboard/settings/workspace），控制分钟消耗同时保证主链路回归（2026-04-02）
- [x] **Skills 页端到端测试**：mock API 返回数据 → 验证技能列表渲染 + 搜索调用（2026-03-30）
- [x] **Permissions 面板测试**：验证 profile 显示 + denied 命令移除调用 permissionsUpdate（2026-03-30）
- [x] **Workspace 编辑器测试**：验证文件按钮显示 + 点击调用 workspaceReadFile（2026-03-30）
- [x] **UpdateBanner 测试**：mock checkUpdates 返回更新 → 验证弹窗显示版本对比 + Upgrade 按钮（2026-03-30）
- [x] **文件预览测试**：验证 text/image/error 三种 filePreview 响应的渲染（2026-03-30）
- [x] **Automation 可视化选择器测试**：验证 Daily/Hourly/Weekly/Custom 频率切换 + 星期选择 + cron 列表渲染（2026-03-30）
- [ ] **System tray 测试**：验证关窗隐藏、托盘菜单功能（需 Electron 测试框架）
- [ ] **集成测试/E2E**：用 Playwright 或 Spectron 做 Electron E2E 测试，覆盖完整用户流程

---

## 用户体验债务（2026-03-30 审计）

### 🔴 P0（阻塞用户使用）

#### 通道页面（已部分修复，以下为剩余问题）
- [x] **Feishu 双输入框**：AppID + AppSecret 两个独立 PasswordInput（2026-03-30）
- [x] **WhatsApp/Signal/iMessage 一键连接**：noToken 通道不再保存空配置，改为调 `channel:setup` IPC 自动执行 `openclaw channels add + login`（2026-03-30）
- [x] **已配置通道预填凭证**：`channel:read-config` IPC 从 openclaw.json 读取已有配置（2026-03-30）
- [x] **错误信息透传**：testError 显示实际 CLI 错误（2026-03-30）

#### 聊天页面
- [x] **会话删除需确认**：confirm() 对话框（2026-03-30）
- [x] **模型未配置时空状态引导**：显示 "选择模型" + 按钮跳转模型选择器（2026-03-30）

#### Automation 页面
- [x] **删除 cron 任务需确认**：confirm()（2026-03-30）
- [x] **添加任务失败时显示错误**：addError 状态 + 红色横幅（2026-03-30）

#### Agent 页面
- [x] **删除 Agent 需确认**：confirm()（2026-03-30）
- [x] **创建失败时友好错误**：区分 permission/duplicate/other（2026-03-30）

### 🟡 P1（影响体验但不阻塞）

#### 设置页面
- [x] **模型切换时 API Key 不应清空**：切回当前 provider 时从 config.apiKey 恢复，切到其他 provider 时清空（2026-03-30）
- [x] **AwarenessClaw 版本号从 package.json 读取**：import pkg 动态读取（2026-03-30）
- [x] **Permissions 添加去重**：includes() 检查已有项（2026-03-30）
- [x] **Permissions 空列表友好提示**："None" → "No extra tools added" / "No commands blocked"（2026-03-30）
- [x] **Workspace 文件编辑保存成功提示**：fileSaveSuccess 状态 + "Saved ✓" 提示（2026-03-30）
- [x] **Workspace 文件不存在时提示**：loadWorkspaceFile 失败时用空内容打开编辑器，允许新建（2026-03-30）
- [x] **Usage 清零确认对话框**：confirm() 确认（2026-03-30）
- [x] **安全审计无问题时显示绿色 ✅**：securityIssues.length === 0 时显示 "No issues found"（2026-03-30）
- [x] **导入导出友好提示**：导入格式错误时翻译错误（'Invalid config file format' → i18n），导出后 shell.showItemInFolder() 自动在资源管理器中显示文件（2026-03-30）

#### 通道页面
- [x] **硬编码英文文本 i18n 化**：Slack "Bot Token" / "App Token"，Feishu "App ID" / "App Secret" 全部用 t() 包裹（2026-03-30）
- [x] **配置完成后 UI 即时更新**：closeWizard() 已调用 loadConfiguredChannels()，关闭即刷新（2026-03-30）

#### 记忆页面
- [x] **搜索无结果区分原因**：有搜索词 → "No results for '...'"；有分类筛选 → "No cards in this category" + 清除筛选；无 → "No memory data yet"（2026-03-30）
- [x] **分类筛选无结果时提供 "清除筛选" 按钮**：clearFilter 按钮点击恢复 selectedCategory='all'（2026-03-30）
- [x] **Mock 数据提示加操作指引**：mockHint 下方增加 `npx @awareness-sdk/local start` 命令框（2026-03-30）

#### 聊天页面
- [x] **"No response" 用 i18n**：已用 t('chat.noResponse')（2026-03-30）
- [x] **模型选择器标记当前活跃模型**：Active 模型显示 "✓ Active" brand 色标签（2026-03-30）

#### Agent 页面
- [x] **绑定输入框格式说明**：Agents 页面绑定表单已有 "Format: channel:accountId" 提示（测试已覆盖）（2026-03-30）

---

## 通道配置调研结果（2026-03-30 · 基于 `openclaw channels add --help` 实际输出）

> **所有通道都需要 Gateway 运行**（`openclaw gateway` 或 Settings → Gateway → Start）

### 每个通道的真实配置参数

| 通道 | CLI 参数 | 前端应显示的字段 | 是否需要交互式登录 |
|------|---------|-----------------|-------------------|
| **Telegram** | `--channel telegram --token <BOT_TOKEN>` | 1 个输入框：Bot Token（格式 `123456:ABC-...`） | 否 |
| **Discord** | `--channel discord --token <BOT_TOKEN>` | 1 个输入框：Bot Token | 否 |
| **Slack** | `--channel slack --bot-token <xoxb-...> --app-token <xapp-...>` | **2 个输入框**：Bot Token (`xoxb-`) + App Token (`xapp-`) | 否 |
| **WhatsApp** | `--channel whatsapp` + `openclaw channels login --channel whatsapp` | **无输入框** — 一键连接按钮，后台执行 add + login | 是（QR 扫码） |
| **Signal** | `--channel signal --signal-number <+PHONE> --http-url <URL>` | **2 个输入框**：手机号 (`+86...`) + signal-cli HTTP URL | 部分（需先安装 signal-cli） |
| **iMessage** | `--channel imessage --db-path <PATH>` | **1 个输入框**：chat.db 路径（macOS only，默认 `~/Library/Messages/chat.db`） | 否 |
| **Google Chat** | `--channel googlechat --webhook-url <URL>` | **1 个输入框**：Webhook URL | 否 |
| **LINE** | `--channel line --token <CHANNEL_TOKEN>` | 1 个输入框：Channel Access Token | 否 |
| **Matrix** | `--channel matrix --homeserver <URL> --user-id <@user:host> --password <PW>` 或 `--access-token <TOKEN>` | **3 个输入框**：Homeserver URL + User ID + Password（或 1 个 Access Token） | 否 |
| **Feishu** | 不通过 `channels add`，直接编辑 `openclaw.json → channels.feishu`（通过 plugin 实现） | **2 个输入框**：App ID + App Secret（✅ 已实现） | 否 |

### 当前实现 vs 应该实现

| 通道 | 当前状态 | 需要修复 |
|------|---------|---------|
| Telegram | ✅ 单 token 输入 | — |
| Discord | ✅ 单 token 输入 | — |
| Slack | ❌ 单 token 输入 | 改为 2 个输入框（bot_token + app_token） |
| WhatsApp | ⚠️ 一键连接已实现但未验证 QR 流程 | 验证 `channel:setup` IPC 是否真正触发 QR，可能需要 Gateway 先启动 |
| Signal | ❌ 当前走通用 token 输入 | 改为 2 个输入框（phone + http_url），标注需先安装 signal-cli |
| iMessage | ❌ 当前走通用 token 输入 | 改为 1 个输入框（db_path），加默认值 `~/Library/Messages/chat.db`，macOS only 提示 |
| Google Chat | ❌ 当前走通用 token 输入 | label 改为 "Webhook URL" |
| LINE | ✅ 单 token 输入（label 需改为 Channel Access Token） | label 文案修改 |
| Matrix | ❌ 当前走通用 token 输入 | 改为 3 个输入框（homeserver + userId + password） |
| Feishu | ✅ 双输入框 | — |

### handleTest configMap 需要重写

当前 `handleTest` 中的 `channelSave` 应该调用 `openclaw channels add` 而不是直接写 openclaw.json：

```
现有方式：channelSave(channelId, { token }) → 直接写 openclaw.json.channels[id]
正确方式：通过 CLI `openclaw channels add --channel <id> --token <token>` → OpenClaw 自己处理配置格式
```

**建议**：新增 `channel:add` IPC，调用 `openclaw channels add --channel <id> <参数>` 替代直接写文件。这样可以确保配置格式正确且兼容 OpenClaw 未来更新。

---

## Agent 管理调研结果（2026-03-30 · 基于 `openclaw agents --help` 实际输出）

### 创建 Agent

**命令**：`openclaw agents add <name> [options]`

| 参数 | 必填 | 说明 |
|------|------|------|
| `<name>` | 否（交互式会提示） | agent 名称，作为 ID |
| `--workspace <dir>` | 条件（`--non-interactive` 时必填） | 独立工作目录 |
| `--agent-dir <dir>` | 否 | 状态目录（默认 `~/.openclaw/agents/{id}/agent`） |
| `--model <id>` | 否 | 模型 ID（格式 `provider/model`，默认用全局配置） |
| `--bind <channel[:accountId]>` | 否，可重复 | 初始路由绑定 |
| `--non-interactive` | 否 | 禁用交互提示 |
| `--json` | 否 | JSON 输出 |

**JSON 输出 schema**：
```json
{
  "agentId": "test-agent",
  "name": "test-agent",
  "workspace": "/path/to/workspace",
  "agentDir": "~/.openclaw/agents/test-agent/agent",
  "bindings": { "added": [], "updated": [], "skipped": [], "conflicts": [] }
}
```

### 列表 Agent

**命令**：`openclaw agents list [--json] [--bindings]`

**JSON 输出每个 agent 的字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一 ID |
| `name` | string | 显示名 |
| `identityName` | string | 身份名（来自 IDENTITY.md 或 config） |
| `identityEmoji` | string | 表情符号 |
| `identitySource` | `"identity"` \| `"config"` | 身份信息来源 |
| `workspace` | string | 工作目录绝对路径 |
| `agentDir` | string | 状态目录绝对路径 |
| `model` | string | `provider/model-name` |
| `bindings` | number | 绑定数量 |
| `isDefault` | boolean | 是否为默认 agent |
| `routes` | string[] | 路由描述 |
| `bindingDetails` | string[] | 绑定详情（如 `"feishu"`, `"whatsapp accountId=default"`） |

### 绑定管理

**格式**：`channel[:accountId]`
- 示例：`telegram`、`whatsapp:default`、`feishu:oc_xxx`
- 存储在 `openclaw.json → bindings[]` 数组（全局，不在 agent 记录内）

**命令**：
- `openclaw agents bind --agent <id> --bind <channel[:accountId]>` （可重复 `--bind`）
- `openclaw agents unbind --agent <id> --bind <channel[:accountId]>` （`--all` 移除全部）
- `openclaw agents bindings [--agent <id>] [--json]`

### 身份设置

**命令**：`openclaw agents set-identity --agent <id> [options]`

| 选项 | 说明 | 示例 |
|------|------|------|
| `--name <name>` | 显示名 | `--name "My Bot"` |
| `--emoji <emoji>` | 表情 | `--emoji "🤖"` |
| `--avatar <value>` | 头像（文件路径 / URL / data URI） | `--avatar "https://..."` |
| `--theme <theme>` | 主题 | `--theme "dark"` |
| `--from-identity` | 从 IDENTITY.md 读取 | — |

### 删除 Agent

**命令**：`openclaw agents delete <id> [--force] [--json]`

**删除的内容**：
- `openclaw.json` 中的 agent 记录 + 所有 bindings
- `~/.openclaw/agents/{id}/` 目录（agent/ + sessions/）
- workspace 内容被清空但目录本身不删

### 当前 AwarenessClaw 实现 vs 应该实现

| 功能 | 当前状态 | 需要修复 |
|------|---------|---------|
| 列表 | ⚠️ 解析逻辑不可靠（text fallback） | 始终用 `--json` + 正确解析上述 schema |
| 创建 | ❌ workspace 创建为 agent 子目录 | 应创建独立 workspace（如 `~/.openclaw/workspaces/{name}/`） |
| 绑定 | ⚠️ 基础可用 | 输入框加格式说明 + 可用通道列表 |
| 身份编辑 | ⚠️ 只有 name + emoji | 加 avatar + theme |
| 删除 | ✅ 有确认 | 加 `--force --json` 获取删除结果 |
| 模型选择 | ❌ 缺失 | 创建时应支持选择模型（`--model`） |
| 绑定展示 | ❌ 解析不准确 | 用 `bindingDetails` 字段显示 |
