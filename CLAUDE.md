# AwarenessClaw 项目规则

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
- **所有配置全 UI 化**：模型选择、通道连接、记忆体管理全部图形化
- **用人话说话**：错误提示不要技术术语，用"网络连接有问题，请检查 Wi-Fi"而非"ECONNREFUSED 127.0.0.1:37800"
- **安全默认值**：所有配置都有合理的默认值，用户可以一路"下一步"完成安装

### 4. 记忆是差异化
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

## 与主仓库的关系
- 本项目位于 `Awareness/AwarenessClaw/`，使用独立 Git 仓库管理
- 主仓库 `.gitignore` 已排除本目录
- 通过 npm 依赖引用主仓库 SDK，不通过文件路径引用

## 开发规则
- 中文推理和回复，英文写代码（与主仓库一致）
- 代码注释用英文
- UI 文案支持多语言（默认英文 + 中文），不要 hardcode 语言
- 所有用户可见的错误信息必须友好、非技术性、可操作
