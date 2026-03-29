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
- [ ] **工具调用状态展示**：解析输出中的 tool_call 事件，显示 "🔧 正在搜索..." 等
- [x] **历史会话持久化**：消息保存到 localStorage，下次打开恢复。支持多会话（2026-03-30）
- [x] **Markdown 渲染**：代码块高亮、表格、列表、链接（react-markdown + remark-gfm）（2026-03-30）
- [x] **新建会话按钮**：侧边栏顶部 "+ 新对话" 按钮（2026-03-30）
- [x] **会话列表侧边栏**：显示历史会话，可切换、删除（2026-03-30）
- [x] **会话重命名**：双击侧边栏会话名编辑，Enter 保存，Esc 取消（2026-03-30）
- [ ] **完整还原 OpenClaw chat 功能**：工具调用展示、多轮上下文、文件预览等

### Logo & 品牌
- [x] **替换所有脑子 emoji**：侧边栏、聊天 AI 头像、安装向导 — 全部换成 Awareness 真实 logo（2026-03-30）
- [x] **聊天气泡 AI 头像**：用 Awareness logo.png 替代 🧠 emoji（2026-03-30）

### 界面美观
- [x] **聊天界面重新设计**：参考 ChatGPT/Claude 风格，圆角气泡、AI头像、meta 行、打字机光标（2026-03-30）
- [x] **消息气泡优化**：圆角、border、悬浮复制按钮（2026-03-30）
- [x] **输入框优化**：自动增高、Shift+Enter 提示、禁用状态（2026-03-30）

### 模型配置
- [x] 模型激活状态 badge（✅已配置 / 🔑需配置）
- [x] 未配置厂商点击弹出 API Key 输入框（2026-03-30）
- [x] 测试连接按钮（设置页模型弹窗中，验证 API Key）（2026-03-30）
- [x] **已安装 OpenClaw 自动延用配置**：检测到已有 providers/models 时跳过模型选择步骤（2026-03-30）

### 记忆系统
- [ ] 记忆页接入本地守护进程 MCP API
- [ ] 语义搜索调用后端
- [ ] 感知信号面板接入真实数据
- [ ] **Awareness 记忆 vs OpenClaw 原生 memory 协作策略**
- [ ] **轻量化 + 节省 token**

### 通道
- [x] 通道配置写入 openclaw.json（Telegram/Discord/Slack/Feishu）（2026-03-30）
- [x] 测试连接功能（channel:test IPC）（2026-03-30）
- [x] 通道状态检测框架（读取 openclaw.json channels）（2026-03-30）

### 定时任务（Cron）
- [x] Cron 可视化管理页面（独立"自动化"tab）（2026-03-30）
- [x] 调用 `openclaw cron list/add/remove`（2026-03-30）
- [x] Heartbeat 开关 + 频率配置（2026-03-30）

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

- [ ] 多 Agent 管理（列表/创建/路由绑定）
- [ ] macOS 系统托盘集成
- [ ] iOS/Android 扫码配对
- [ ] TTS/STT 语音支持
- [ ] 图片理解（拖拽图片分析）
- [ ] MCP 服务器管理
- [ ] 费用统计面板
- [ ] 每日记忆摘要
- [ ] 配置导入/导出

---

## P4 — 长尾功能

- [ ] 更多通道（Teams, Twitch, Zalo）
- [ ] 团队记忆
- [ ] Agent 权限管理
- [ ] 自定义技能创建
- [ ] 多语言 UI

---

## 技术债务 & Bug

- [x] ~~openclaw agent session conflict~~ — 用 --local --session-id 解决
- [x] ~~.bash_profile cargo/env 报错~~ — 用 --norc --noprofile
- [x] ~~plugins.allow 警告~~ — 写入 plugins.allow
- [x] ~~Setup.tsx 残留代码~~ — 清理 4957 chars
- [x] ~~saveConfig 覆盖用户 providers~~ — 改为深度合并
- [ ] Windows / Linux 打包未测试
