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

### 聊天
- [x] 聊天气泡 UI（用户蓝色/AI 深色）
- [x] 后端接通 `openclaw agent --local --session-id ... -m ... --json`（qwen-turbo 验证通过）
- [ ] **流式输出（streaming）**：逐字显示 AI 回复，不等完整响应。通过逐行读取 CLI stdout 实现
- [ ] **Markdown 渲染**：代码块高亮、表格、列表、链接（用 react-markdown）
- [ ] **会话管理**：新建会话 / 会话历史列表 / 切换会话（读取 `~/.openclaw/agents/*/sessions/`）
- [ ] **文件/图片上传**：拖拽 + 点击，传文件路径给 agent

### 模型配置
- [ ] **模型激活状态 badge**：已配置 API Key 显示 ✅，未配置显示 🔑
- [ ] **未配置厂商点击提示输入 API Key**
- [ ] **测试连接按钮**：验证 API Key 有效性
- [ ] **已安装 OpenClaw 自动延用配置**：检测 `~/.openclaw/openclaw.json` 已有的 providers 和 model，安装向导跳过模型选择步骤，直接用现有配置

### 记忆系统
- [ ] 记忆页接入本地守护进程 MCP API（awareness_lookup / awareness_recall）
- [ ] 语义搜索真正调用后端
- [ ] 感知信号面板（矛盾/模式/共鸣）接入真实数据
- [ ] **与 OpenClaw 原生 memory 系统的关系**：研究 OpenClaw 自带的 MEMORY.md / memory_search / memory_get 工具，确定 Awareness 记忆与 OpenClaw 内存的协作策略（互补 vs 替代）
- [ ] **确保 Awareness 记忆体远超 OpenClaw 原生 MD 插件**：向量搜索、感知信号、跨设备同步等差异化优势要在 UI 中体现
- [ ] **轻量化 + 节省 token**：记忆加载策略优化，避免注入过多上下文浪费 token

### 通道
- [ ] 通道配置写入 openclaw.json（Telegram Token 等）
- [ ] 测试连接功能
- [ ] 通道状态实时显示

### 定时任务（Cron）
- [ ] Cron 可视化管理页面（列表 + 添加 + 删除）
- [ ] 调用 `openclaw cron list/add/remove` CLI
- [ ] Heartbeat 开关 + 频率配置

### 系统管理
- [x] Gateway 启动/停止/重启按钮
- [x] Gateway 状态实时检测
- [x] 日志查看器弹窗
- [ ] 系统诊断（`openclaw doctor` 展示）

### 升级提醒
- [ ] **强提醒（弹窗）**：OpenClaw 有重大更新时弹出，用户可选"立即升级 / 下次提醒 / 永不提醒"
- [ ] **弱提醒（tooltip）**：每次打开时顶部显示更新提示条，用户手动关闭才消失
- [ ] 检测 OpenClaw 版本 vs npm latest
- [ ] 检测 Awareness 插件版本
- [ ] 检测 AwarenessClaw 桌面端版本（electron-updater）

### OpenClaw 安装与初始化
- [ ] **已安装 OpenClaw 检测 + 配置复用**：安装向导检测到 `~/.openclaw/openclaw.json` 存在时，自动读取已配置的 providers/models，跳过模型选择步骤，只做 Awareness 插件安装
- [ ] **新用户 OpenClaw bootstrap**：首次安装 OpenClaw 后，引导用户完成 `openclaw onboard` 初始化流程（wizard/doctor），确保 Gateway 配置正确
- [ ] **openclaw.json 安全写入**：不覆盖用户已有配置，只合并新增的 Awareness 相关字段

---

## P3 — 进阶功能

### 多 Agent 管理
- [ ] Agent 列表页面
- [ ] Agent 创建向导
- [ ] 路由绑定可视化编辑器

### 设备节点
- [ ] macOS 系统托盘集成
- [ ] iOS/Android 扫码配对 UI

### 语音 & 视觉
- [ ] TTS 语音输出（消息播放按钮）
- [ ] STT 语音输入（麦克风按钮）
- [ ] 图片理解（拖拽图片自动发送分析）

### MCP
- [ ] MCP 服务器列表管理
- [ ] MCP 工具浏览

### 其他
- [ ] 费用统计面板
- [ ] 每日记忆摘要（日历视图）
- [ ] MEMORY.md 富文本编辑器
- [ ] 配置导入/导出

---

## P4 — 长尾功能

- [ ] 更多通道（Teams, Twitch, Zalo, Nextcloud）
- [ ] 团队记忆（多用户 + 角色隔离）
- [ ] Agent 权限管理
- [ ] 自定义技能创建
- [ ] 多语言 UI 完善（日/韩/英/中）

---

## 技术债务 & Bug

- [x] ~~`openclaw agent` 返回 "Message ordering conflict"~~ — 根因：DeepSeek API Key 无效返回 404，已恢复 qwen-portal 配置，`--local --session-id` 模式验证通过（2026-03-29）
- [ ] `.bash_profile` 加载报错（`cargo/env: No such file or directory`）— spawn 时用 `--norc` 或忽略 stderr
- [ ] `plugins.allow` 警告 — 在 openclaw.json 中设置 `plugins.allow: ["openclaw-memory"]`
- [ ] Setup.tsx 中残留的 `__UNUSED` 旧 PROVIDERS 数组需清理
- [ ] `saveConfig` 曾覆盖用户的 qwen-portal 配置改成 deepseek — 需改为合并而非覆盖 providers
- [ ] Windows / Linux 打包未测试
