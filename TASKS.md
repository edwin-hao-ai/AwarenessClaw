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

---

## P3 — 进阶功能

### 技能市场（ClawHub 集成）
- [x] **技能列表接入真实数据**：读 lock.json 已安装 + ClawHub REST API explore，替代 mock 数据（2026-03-30）
- [x] **技能搜索**：调 ClawHub `/api/v1/search` 向量搜索（2026-03-30）
- [x] **技能安装/卸载**：`runAsync('npx clawhub install/uninstall')` + 进度反馈 + 错误提示（2026-03-30）
- [x] **技能详情页**：点击技能卡片弹出详情模态，显示 SKILL.md 内容、版本、作者、安装/卸载按钮（2026-03-30）
- [x] **技能配置编辑**：读/写 `openclaw.json → skills.<slug>.config`，支持增删改键值对，dirty tracking + Save 按钮（2026-03-30）

### 权限管理
- [x] **权限概览面板**：Settings 页显示 tools profile、alsoAllow 标签列表（可增删）、denied 命令标签列表（可增删）（2026-03-30）
- [x] **安全审计提示**：Settings 页新增 Security Audit section — 检测 openclaw.json 文件权限（非 600 时警告 + 修复命令）、tools.alsoAllow 过多时警告、第三方 extensions 检测（2026-03-30）

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
- [ ] **去掉所有 mock fallback**：daemon 没连接时显示空状态 + "Start Daemon" Fix 按钮（一键拉起）
- [ ] **记忆时间线视图**：展示实际记忆事件（不只是知识卡），包含时间、内容摘要、来源通道、会话 ID
- [ ] **记忆详情展开**：点击卡片/事件展开完整内容（当前只显示 title + summary，缺少详情）
- [ ] **记忆搜索结果高亮**：语义搜索返回的结果在内容中高亮匹配片段

### 全通道记忆捕获
- [ ] **微信/WhatsApp/Telegram 消息自动写入 Awareness 记忆**：从 OpenClaw Gateway session 数据中捕获所有通道对话
  - 方案 A：Gateway 侧 hook — 在 `openclaw.json → hooks → command:new` 中注册 Awareness 记录
  - 方案 B：轮询 session 文件 — 定时读 `~/.openclaw/agents/main/sessions/` 新数据写入记忆
  - 方案 C：Awareness 插件的 `auto-capture` 模式已有此能力（需要验证 Gateway 模式是否生效）
- [ ] **桌面聊天消息也写入记忆**：当前 `chat:send` 只调 `openclaw agent` CLI，返回的对话不经过记忆系统
- [ ] **通道来源标记**：记忆事件标记 `source: "wechat"` / `"whatsapp"` / `"desktop"` / `"telegram"`
- [ ] **桌面端可查看所有通道的对话历史**：读 OpenClaw session 数据，在桌面聊天 UI 或记忆页中展示

### 本地向量搜索
- [ ] **本地 embedding 模型自动下载**：daemon 首次启动时自动下载小型 embedding 模型（如 `all-MiniLM-L6-v2` ~22MB），不依赖在线 API
  - 当前 `@awareness-sdk/local` 用 `better-sqlite3` FTS5 做全文搜索，不是真正的向量搜索
  - 需要集成 `onnxruntime-node` + 小模型实现本地 embedding
  - Doctor 检查项：验证 embedding 模型是否已下载
- [ ] **混合搜索**：本地向量搜索 + FTS5 全文搜索混合排序

### 超越 QMD 插件的差异化功能
- [ ] **知识卡片自动提炼**：从对话中自动提取决策、问题解决、工作流等结构化知识（已有后端能力，需要前端展示优化）
- [ ] **跨会话知识图谱**：关联不同通道/会话中的相关知识，在记忆页可视化展示关联关系
- [ ] **感知信号面板**：展示项目上下文变化（文件修改模式、活跃时段、技术栈偏好）— 已有 daemon type=perception 能力
- [ ] **记忆冲突检测**：新知识与已有知识矛盾时自动标记（后端已实现 5 类分类器，前端需展示）
- [ ] **隐私控制**：用户可在桌面端选择哪些通道的消息存入记忆、一键删除指定时段/通道的记忆

### Daemon 健壮性
- [ ] **npx 缓存损坏自动修复**：Doctor 已有 `fixDaemonStart` 清理 `~/.npm/_npx/` 坏缓存
- [ ] **开机自动启动 daemon**：macOS LaunchAgent / Windows 计划任务 / Linux systemd
- [ ] **daemon 崩溃自动重启**：watchdog 机制，检测 37800 端口无响应时自动重拉
- [ ] **better-sqlite3 编译失败降级**：已有 `NoopIndexer` fallback，但需要在前端提示"搜索功能不可用"

## P4 — 长尾功能

- [ ] 更多通道（Teams, Twitch, Zalo）
- [ ] 团队记忆
- [ ] 自定义技能创建
- [ ] 多语言 UI

---

## 技术债务 & Bug

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
- [ ] Windows / Linux 打包未测试
- [x] **macOS 无法退出应用**：`close` 事件中 `if (tray)` 永远为 true 导致 `preventDefault()` 阻止所有关窗。修复：`isQuitting` 标志 + `before-quit` 事件设置（2026-03-30）
- [x] **Daemon 升级失败（Exit code 1）**：daemon 通过 `npx` 运行不是全局安装，`npm install -g` 无效。改为先 shutdown → `npx -y @latest start`（2026-03-30）
- [x] **Setup 向导假成功**：`installPlugin()` / `startDaemon()` 失败时前端不再误显示 done，改为检查 success 并显示友好错误（2026-03-30）
- [ ] **OpenClaw 安装脚本供应链风险**：当前 Windows 用 `irm ... | iex`、mac/Linux 用 `curl ... | bash`，缺少签名/校验。需要改为下载后校验 hash/signature 再执行
- [x] **配置导入/导出含敏感信息**：导出前增加敏感信息提示，支持脱敏导出；导入改为按真实 `models.providers` 结构深合并，并忽略脱敏占位值（2026-03-30）
- [x] **安全审计覆盖不足**：新增 Windows ACL 检查、离线 tgz manifest/checksum 检查、升级回滚准备状态提示（2026-03-30）

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
