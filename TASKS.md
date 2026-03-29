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
- [ ] **🔴 流式输出真正生效**：当前 openclaw agent CLI 是一次性输出的。需要研究是否有 `--stream` 参数，或改用 Gateway WebSocket 实现真正的逐字流式。如果 CLI 不支持 stream，需要用 WebSocket 连接 Gateway
- [ ] **🔴 Thinking 状态展示**：AI 思考中时显示 "🤔 思考中..." 动画。需要解析 openclaw 输出中的 thinking 标记
- [ ] **🔴 工具调用状态展示**：AI 调用工具时显示 "🔧 正在搜索..." / "📁 正在读取文件..." 等。需要解析 openclaw 输出中的 tool_call 事件
- [ ] **🔴 历史会话持久化**：消息保存到 localStorage 或文件，下次打开时恢复。支持多个会话切换
- [ ] **Markdown 渲染**：代码块高亮、表格、列表、链接（用 react-markdown + rehype-highlight）
- [ ] **新建会话按钮**：清空当前对话，开启新 session
- [ ] **会话列表侧边栏**：显示历史会话，可切换、删除、重命名
- [ ] **完整还原 OpenClaw chat 功能**：参考 OpenClaw TUI/Dashboard 的聊天界面，确保功能对等

### Logo & 品牌
- [ ] **🔴 替换所有脑子 emoji**：侧边栏 logo、聊天页 AI 头像、安装向导 logo、关于页面 — 全部换成 Awareness 真实 logo（SVG/PNG）
- [ ] **聊天气泡 AI 头像**：用 Awareness logo 替代 🧠 emoji

### 界面美观
- [ ] **🔴 聊天界面精打细磨**：参考 ChatGPT / Claude 的聊天 UI 设计，提升间距、字体、颜色、动画的质感
- [ ] **消息气泡优化**：圆角、阴影、悬浮效果
- [ ] **输入框优化**：自动增高、快捷键提示

### 模型配置
- [x] 模型激活状态 badge（✅已配置 / 🔑需配置）
- [ ] 未配置厂商点击提示输入 API Key
- [ ] 测试连接按钮
- [ ] **已安装 OpenClaw 自动延用配置**：检测到已有 providers/models 时跳过安装向导的模型选择步骤

### 记忆系统
- [ ] 记忆页接入本地守护进程 MCP API
- [ ] 语义搜索调用后端
- [ ] 感知信号面板接入真实数据
- [ ] **Awareness 记忆 vs OpenClaw 原生 memory 协作策略**
- [ ] **轻量化 + 节省 token**

### 通道
- [ ] 通道配置写入 openclaw.json
- [ ] 测试连接功能
- [ ] 通道状态实时显示

### 定时任务（Cron）
- [ ] Cron 可视化管理页面
- [ ] 调用 `openclaw cron list/add/remove`
- [ ] Heartbeat 开关 + 频率配置

### 系统管理
- [x] Gateway 启动/停止/重启按钮
- [x] Gateway 状态实时检测
- [x] 日志查看器弹窗
- [ ] 系统诊断（`openclaw doctor`）

### 升级提醒
- [ ] **强提醒（弹窗）**：重大更新时弹出（立即升级 / 下次提醒 / 永不提醒）
- [ ] **弱提醒（tooltip）**：每次打开顶部提示条，手动关闭才消失
- [ ] 检测 OpenClaw / Awareness 插件 / 桌面端版本

### OpenClaw 初始化
- [ ] 已安装 OpenClaw 检测 + 配置复用
- [ ] 新用户 bootstrap 流程引导
- [ ] openclaw.json 安全写入（合并不覆盖）

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
