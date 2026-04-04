# AwarenessClaw 多 Agent 协作指南

> 日期：2026-04-05
> 适用版本：AwarenessClaw + OpenClaw 2026.4.x
> 目标读者：产品团队、开发者、高级用户

## 一、核心原理

### 1.1 什么是多 Agent 协作？

传统 AI 聊天是"一个 AI 回答所有问题"。多 Agent 协作是"多个专家 AI 各司其职，协同完成复杂任务"。

```
传统模式：
  用户 → 🤖 通才 AI → 回答（质量参差不齐）

多 Agent 模式：
  用户 → 🤖 主 Agent（总指挥）
            ├→ 💻 Coder Agent（写代码）
            ├→ 🧪 Tester Agent（写测试）
            ├→ 🔍 Reviewer Agent（审查代码）
            └→ 📝 Writer Agent（写文档）
         ← 综合所有 Agent 结果后回复用户
```

### 1.2 OpenClaw 的三层协作架构

AwarenessClaw 的多 Agent 协作 100% 基于 OpenClaw 原生能力，分三层：

#### 第一层：Agent 隔离（已实现 ✅）

每个 Agent 是一个**独立的 AI 人格**，拥有：
- 独立的系统提示词（SOUL.md）—— 定义"我是谁、我擅长什么"
- 独立的工作空间 —— 各自的文件和记忆
- 独立的模型选择 —— 主 Agent 用 Opus，Worker 用 Haiku 省钱
- 独立的工具权限 —— Coder 能执行代码，Writer 不能

```
~/.openclaw/
├── workspace/              ← 主 Agent (main) 的工作空间
│   ├── SOUL.md             ← "我是通用助手"
│   └── TOOLS.md
├── workspace-coder/        ← Coder Agent 的工作空间
│   ├── SOUL.md             ← "我是高级程序员，专注写代码"
│   └── TOOLS.md
├── workspace-tester/       ← Tester Agent 的工作空间
│   └── SOUL.md             ← "我是测试工程师，专注写测试"
└── agents/
    ├── main/sessions/      ← 主 Agent 的会话历史
    ├── coder/sessions/     ← Coder Agent 的会话历史
    └── tester/sessions/    ← Tester Agent 的会话历史
```

#### 第二层：Sub-Agent 委托（核心协作能力 ✅）

主 Agent 可以在对话中**自动或手动 spawn 子 Agent**，让它们在后台执行任务：

```
用户："帮我重构 auth 模块"

主 Agent 思考：这个任务需要分步完成...
  1. spawn → Coder Agent："分析 auth 模块结构，输出重构计划"
  2. 等待 Coder 完成 → 拿到重构计划
  3. spawn → Coder Agent："按照计划重构代码"
  4. spawn → Tester Agent："为重构后的代码写单元测试"
  5. 汇总所有结果 → 回复用户
```

**技术原理**：

```
用户消息 → Gateway (ws://127.0.0.1:18789)
              ↓
         主 Agent Session
              ↓ (LLM 决定需要委托)
         调用 sessions_spawn 工具
              ↓
         Gateway 创建子 Agent Session
              ↓
         子 Agent 独立运行（有自己的 SOUL.md、工具、模型）
              ↓
         完成后 announce 结果回主 Agent 的聊天
              ↓
         主 Agent 继续处理或回复用户
```

**关键配置**（openclaw.json）：
```json
{
  "agents": {
    "defaults": {
      "subagents": {
        "maxSpawnDepth": 2,        // 允许 spawn 子 Agent（1=不允许）
        "maxChildrenPerAgent": 5,  // 每个 Agent 最多 5 个并行子任务
        "runTimeoutSeconds": 300   // 子 Agent 5 分钟超时
      }
    }
  },
  "tools": {
    "agentToAgent": {
      "enabled": true              // 允许 Agent 之间直接通信
    }
  }
}
```

#### 第三层：Lobster 工作流（确定性编排 ✅）

对于需要**严格按顺序执行**的多步骤任务，用 Lobster 工作流引擎：

```yaml
# 代码审查工作流
name: code-review
steps:
  - id: analyze          # 第 1 步：分析
    run: openclaw.invoke --tool llm-task --args-json '{"prompt": "分析代码..."}'

  - id: review           # 第 2 步：审查（依赖第 1 步输出）
    run: openclaw.invoke --tool llm-task --args-json '{"prompt": "审查..."}'
    stdin: $analyze.stdout

  - id: approve          # 第 3 步：人工审批（暂停等待确认）
    approval: "确认审查结果后继续"

  - id: summarize        # 第 4 步：生成总结（审批通过后执行）
    run: openclaw.invoke --tool llm-task --args-json '{"prompt": "总结..."}'
    when: $approve.approved
```

**Lobster vs Sub-Agent 的区别**：

| 特性 | Sub-Agent | Lobster 工作流 |
|------|----------|---------------|
| 流程控制 | LLM 动态决定 | YAML 预定义 |
| 适用场景 | 灵活、探索性任务 | 固定、重复性流程 |
| 人工介入 | 不支持 | 支持审批门 |
| 数据流 | Agent 间对话 | 步骤间 JSON 管道 |
| 可预测性 | 低（LLM 可能跑偏） | 高（确定性执行） |

### 1.3 数据流全链路

```
┌─────────────────────────────────────────────────────────────┐
│                    AwarenessClaw 桌面端                       │
│                                                              │
│  ┌──────────┐    ┌───────────┐    ┌────────────────────┐    │
│  │ 聊天页面  │    │ Task Center│    │ @agent 提及检测     │    │
│  │ Dashboard │    │ 看板+工作流 │    │ @coder 写测试 →    │    │
│  │          │    │           │    │ /subagents spawn   │    │
│  └────┬─────┘    └─────┬─────┘    └────────┬───────────┘    │
│       │                │                    │                │
│       └────────────────┼────────────────────┘                │
│                        │ IPC                                 │
└────────────────────────┼─────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               OpenClaw Gateway (ws://127.0.0.1:18789)        │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐               │
│  │ Main Agent│  │Coder Agent│  │Tester Agent│  ...          │
│  │ session   │  │ session   │  │ session   │               │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘               │
│        │               │               │                     │
│        │ sessions_spawn │               │                     │
│        ├──────────────►│               │                     │
│        │               │ sessions_spawn │                     │
│        ├──────────────────────────────►│                     │
│        │               │               │                     │
│        │◄──── announce ─┤               │                     │
│        │◄──────────── announce ─────────┤                     │
│        │                                                     │
│  event:agent (subagent.spawned / agent.finished / ...)       │
└──────────────────────┬───────────────────────────────────────┘
                       │ WebSocket 实时推送
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  AwarenessClaw 看板自动更新：                                  │
│  Backlog → Queued → Running ⏳ → Done ✅ / Failed ❌         │
└─────────────────────────────────────────────────────────────┘
```

## 二、用户操作流程

### 2.1 前置准备（一次性）

#### 步骤 1：创建专用 Agent

打开 **多 Agent** 页面 → 点击 **Create Agent**：

| Agent 名称 | Emoji | SOUL.md 内容 |
|-----------|-------|-------------|
| Coder | 💻 | "你是一个高级全栈开发者。专注写出高质量、可维护的代码。" |
| Tester | 🧪 | "你是一个测试工程师。专注写全面的单元测试和集成测试。" |
| Reviewer | 🔍 | "你是一个高级代码审查员。专注发现 bug、安全漏洞和性能问题。" |
| Researcher | 📚 | "你是一个技术调研员。专注搜索最新资料、对比方案、输出调研报告。" |

#### 步骤 2：启用多 Agent 协作

打开 **任务** 页面 → 看到黄色引导卡片 → 点击 **立即启用**。

这会自动：
- 设置 `maxSpawnDepth: 2`（允许 spawn 子 Agent）
- 设置 `agentToAgent.enabled: true`（允许 Agent 间通信）
- 重启 Gateway 使配置生效

### 2.2 使用方式一：聊天中 @Agent

最简单的方式——在聊天框里直接 @agent：

```
你输入：@coder 帮我重构 auth 模块，用 JWT 替换 session

系统自动转译为：
  /subagents spawn coder "帮我重构 auth 模块，用 JWT 替换 session"

结果：
  🤖 主 Agent 显示：正在委派给 @coder...
  💻 Coder Agent 在后台独立工作
  完成后结果自动返回聊天
```

**适用场景**：
- 快速委托单个任务
- 不需要跟踪进度
- 想在聊天中直接看到结果

### 2.3 使用方式二：任务看板

打开 **任务** 页面 → **看板** tab：

#### 创建任务

点击 **+ 新建任务** → 弹窗填写：
- **任务描述**："为 auth 模块写 JWT 认证的单元测试"
- **分配给**：🧪 Tester
- **优先级**：高
- **超时**：5 分钟

点击 **创建并运行** → 任务卡片出现在看板的 **Running** 列。

#### 看板自动更新

```
┌─────────┐  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────┐  ┌───────┐
│ Backlog │  │ Queued  │  │ Running  │  │ Review │  │ Done  │  │Failed │
│         │  │         │  │          │  │        │  │       │  │       │
│         │  │         │  │ 🧪 写测试 │  │        │  │       │  │       │
│         │  │         │  │ ⏳ 1m23s  │  │        │  │       │  │       │
│         │  │         │  │          │  │        │  │       │  │       │
└─────────┘  └─────────┘  └──────────┘  └────────┘  └───────┘  └───────┘
```

任务完成后自动移到 **Done**，失败移到 **Failed**（可一键重试）。

#### 查看任务详情

点击卡片上的 👁 图标 → 右侧弹出详情面板：
- 任务状态、耗时、Run ID
- 子 Agent 的完整对话历史
- 结果文本

### 2.4 使用方式三：工作流模板

打开 **任务** 页面 → **工作流** tab：

#### 选择模板

内置 3 个模板：
| 模板 | 步骤 | 适用场景 |
|------|------|---------|
| 🔍 代码审查 | analyze → review → approve → summarize | PR 审查 |
| 🚀 功能开发 | plan → approve → implement → test → review | 新功能 |
| 🐛 Bug 修复 | investigate → fix → approve → verify | 修 bug |

#### 填写参数并运行

选择 **代码审查** 模板 → 右侧填写参数：
- **description**："重构了 auth 模块，从 session 改为 JWT"
- **files**："src/auth/jwt.ts, src/auth/middleware.ts"

点击 **运行** → 步骤进度条实时更新：

```
[analyze ✅] ─── [review ⏳] ─── [approve 🔒] ─── [summarize ⏸]
```

遇到审批门时显示 **Approve / Reject** 按钮，人工确认后继续执行。

### 2.5 使用方式四：让主 Agent 自动委托

最高级的方式——你什么都不用管，主 Agent 自己判断何时需要分工。

**前提**：在主 Agent 的 AGENTS.md 中写入规则：

```markdown
# Agent 协作规则

当遇到以下情况时，自动委托给专用 Agent：
- 需要写代码 → spawn coder
- 需要写测试 → spawn tester
- 需要审查代码 → spawn reviewer
- 需要调研技术方案 → spawn researcher

委托时使用 sessions_spawn 工具，不需要用户确认。
Worker agent 用 claude-haiku 模型（省钱），只有复杂任务用 claude-sonnet。
```

然后正常聊天即可——主 Agent 会自动判断并 spawn。

## 三、实际例子

### 例子 1：自动代码审查

```
用户：帮我审查这个 PR，改动了 auth 和 user 两个模块

主 Agent：
  好的，我来协调审查。
  
  [自动 spawn reviewer] 分析 auth 模块的改动...
  [自动 spawn reviewer] 分析 user 模块的改动...
  
  两个审查任务并行运行中 ⏳

  --- 2 分钟后 ---

  审查完成！总结如下：

  ## Auth 模块
  - ✅ JWT 实现正确
  - ⚠️ token 过期时间硬编码为 24h，建议改为配置项
  - 🔴 缺少 refresh token 机制

  ## User 模块
  - ✅ 输入验证完善
  - ⚠️ 密码 hash 用了 MD5，应改为 bcrypt
```

### 例子 2：并行功能开发

```
用户：实现用户注册功能，要有邮箱验证

主 Agent：
  我来拆分任务并行执行：
  
  [spawn coder]      → "实现注册 API 和邮箱验证逻辑"
  [spawn coder]      → "实现注册前端表单和验证 UI"
  [spawn tester]     → "为注册功能写 E2E 测试"
  
  看板：
  ┌──────────┐
  │ Running  │
  │ 💻 后端API│
  │ 💻 前端表单│
  │ 🧪 E2E测试│
  └──────────┘
  
  --- 5 分钟后 ---
  
  3 个任务全部完成 ✅
  后端：POST /api/register + 邮件发送服务
  前端：注册表单 + 验证码输入
  测试：3 个 E2E 场景覆盖
```

### 例子 3：用看板管理长期项目

```
看板状态：

┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
│  Backlog    │ │ Queued   │ │ Running  │ │ Review │ │  Done    │
│             │ │          │ │          │ │        │ │          │
│ 📝 写API文档 │ │ 🧪 集成测试│ │ 💻 支付模块│ │ 🔍 auth │ │ ✅ 注册  │
│ 📚 竞品调研 │ │          │ │ ⏳ 3m12s  │ │   审查  │ │ ✅ 登录  │
│             │ │          │ │          │ │        │ │ ✅ JWT   │
└─────────────┘ └──────────┘ └──────────┘ └────────┘ └──────────┘

操作：
- 把"写API文档"拖到 Queued → 自动 spawn 📝 Writer Agent
- 点击"auth 审查"查看详情 → 看 Reviewer 的完整审查意见
- "集成测试"排队中 → 等 Coder 完成支付模块后自动开始
```

## 四、成本优化

### 模型选择策略

| Agent 角色 | 推荐模型 | 原因 |
|-----------|---------|------|
| 主 Agent（总指挥） | Claude Opus / GPT-4 | 需要判断力，任务量少 |
| Coder（写代码） | Claude Sonnet | 平衡质量和速度 |
| Tester（写测试） | Claude Haiku | 测试代码模式固定，用便宜模型 |
| Reviewer（审查） | Claude Sonnet | 需要理解力但不需要最强推理 |
| Researcher（调研） | Claude Haiku + 搜索工具 | 主要是搜索汇总 |

### 配置方法

在 openclaw.json 中为每个 Agent 配置模型：

```json
{
  "agents": {
    "list": [
      {
        "id": "coder",
        "model": "anthropic/claude-sonnet-4-20250514"
      },
      {
        "id": "tester",
        "model": "anthropic/claude-haiku-4-5-20251001"
      }
    ],
    "defaults": {
      "subagents": {
        "model": "anthropic/claude-haiku-4-5-20251001"
      }
    }
  }
}
```

或者在 spawn 时指定模型：

```
/subagents spawn tester "写单元测试" --model anthropic/claude-haiku-4-5-20251001
```

## 五、与 Awareness Memory 的协同

多 Agent 协作 + Awareness 记忆 = **有记忆的团队**。

每个 Agent 共享同一个 Awareness 记忆体：
- Coder 写了代码 → 自动记录到记忆
- Reviewer 审查时 → 自动 recall 相关历史决策
- 下次类似任务 → 所有 Agent 都能回忆之前的经验

```
第 1 次：
  用户："实现支付模块"
  Coder Agent → 选择 Stripe API → 记录决策

第 2 次（一个月后）：
  用户："加个退款功能"
  Coder Agent → recall → 发现之前用了 Stripe → 直接用 Stripe Refund API
  不需要重新调研！
```

## 六、故障排除

### 问题 1：子 Agent spawn 失败

**检查**：`maxSpawnDepth` 是否 ≥ 2
```bash
cat ~/.openclaw/openclaw.json | grep maxSpawnDepth
```

**修复**：在任务页面点击"立即启用"，或手动设置：
```json
{ "agents": { "defaults": { "subagents": { "maxSpawnDepth": 2 } } } }
```

### 问题 2：子 Agent 不返回结果

**可能原因**：
- 子 Agent 超时（默认 300 秒）
- Gateway 在子 Agent 运行期间重启了
- 子 Agent 的模型 API 不可用

**检查**：打开任务详情面板，查看 sub-agent 对话历史。

### 问题 3：Lobster 工作流不执行

**检查**：Lobster 是否安装
```bash
openclaw plugins list | grep lobster
```

**修复**：在工作流页面点击"安装 Lobster"。

### 问题 4：Windows 上 Gateway 重启失败

**已知问题**：Windows Scheduled Task 模式下 `gateway restart` 可能卡住。
**AwarenessClaw 已修复**：使用 `gateway stop` + `gateway start` 代替 `restart`。

## 七、参考资料

- [OpenClaw Sub-Agents 官方文档](https://docs.openclaw.ai/tools/subagents)
- [OpenClaw Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)
- [OpenClaw Lobster 工作流引擎](https://docs.openclaw.ai/tools/lobster)
- [OpenClaw Gateway Architecture](https://docs.openclaw.ai/concepts/architecture)
- [AwarenessClaw Task Center 设计文档](../docs/prd/WORKFLOW_KANBAN_SPEC.md)
