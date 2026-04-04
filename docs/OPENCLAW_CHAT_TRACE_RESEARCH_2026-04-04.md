# OpenClaw Chat Thinking 与 Tool Trace 调研

> 日期: 2026-04-04
> 目标: 解释为什么 OpenClaw 官方聊天界面能完整展示 thinking 推理过程和 tool 调用内容，并定位当前 AwarenessClaw 聊天输出异常的根因。

## 结论

OpenClaw 官方聊天界面之所以能像截图那样完整展示 thinking、tool call、tool output，不是因为它在最终文本里“解析”出了这些内容，而是因为它从一开始就把聊天视为三条并行数据流来处理：

1. `chat.history` 保留结构化 transcript，消息里的 `content[]` 不会被压平成纯文本。
2. `chat` 事件负责 assistant 文本流和 final state。
3. `agent` 事件负责 tool start/update/result、thinking stream、lifecycle。

官方 Control UI / WebChat 直接消费这三类结构化数据，并在 UI 层分开渲染：

- assistant 正文
- thinking 块
- tool cards
- event/debug log

当前 AwarenessClaw 的问题不是“样式不对”，而是数据模型已经在 Electron bridge 层被压扁了，导致前端只能拿到简化后的 `status + detail`，不可能复刻 OpenClaw 官方的完整 run trace。

## 官方资料结论

### 1. OpenClaw 官方文档明确写了 Chat 会消费 live tool output cards

官方文档 `docs/web/control-ui.md` 明确说明：

- Chat 通过 Gateway WS 使用 `chat.history`、`chat.send`、`chat.abort`、`chat.inject`
- Chat 中会 `Stream tool calls + live tool output cards`
- `chat.send` 是 non-blocking，真正的回复通过 `chat` 事件流回来

这说明官方 UI 不是只等 final text，而是持续消费结构化事件。

### 2. OpenClaw 官方 agent loop 把 tool 和 thinking 当作独立 stream

官方文档 `docs/concepts/agent-loop` 说明：

- assistant deltas 走 `assistant` stream
- tool start/update/end 走 `tool` stream
- lifecycle 走 `lifecycle` stream
- reasoning streaming 可以单独发出

这意味着官方从 runtime 到 Gateway 协议层，已经把 thinking 和 tool execution 作为一等事件，而不是文本附属物。

### 3. 官方 UI 代码里存在独立的 tool stream 状态层

OpenClaw 仓库中可以看到官方 UI 有专门的 tool stream 组装模块：

- `ui/src/ui/app-tool-stream.ts`
- `ui/src/ui/views/chat.ts`
- `ui/src/ui/chat/grouped-render.ts`
- `ui/src/ui/chat/tool-cards.ts`

核心模式是：

- `chatMessages` 保存历史消息
- `chatToolMessages` 单独保存工具消息
- `chatStreamSegments` 保存文本流与 tool 卡片之间的顺序关系
- `buildToolStreamMessage()` 把 tool call/result 重新组装成结构化消息块

这正是官方聊天区能展示“tool read / tool output / tool exec / tool output exec”这类卡片序列的关键。

### 4. 官方 UI 历史加载不会压平消息结构

OpenClaw 官方 `ui/src/ui/controllers/chat.ts` 里，`loadChatHistory()` 的逻辑是：

- 直接读取 `chat.history`
- 把 `messages` 原样保留在 `state.chatMessages`
- 只过滤 silent reply
- 不把 `content[]` 压成字符串

这使得后续 renderer 还能从消息里提取：

- text
- thinking blocks
- toolcall
- toolresult
- 图片或其他块

### 5. 官方 renderer 有显式的显示开关，而不是丢数据

官方 UI 中有两个独立开关：

- `chatShowThinking`
- `chatShowToolCalls`

也就是说，官方是“先完整保留结构化数据，再决定是否显示”，不是“为了简单先丢掉数据”。

## 当前 AwarenessClaw 的真实问题

### 1. `chat.history` 在 Electron 层被压平成纯文本

文件：`AwarenessClaw/packages/desktop/electron/ipc/register-chat-handlers.ts`

当前 `chat:load-history` 逻辑是：

- 如果 `msg.content` 是数组，只拼接 `type === 'text'` 的块
- 直接忽略所有非 text block

这一步会丢失：

- `thinking` / `reasoning`
- `tool_use`
- `tool_result`
- 任何未来新增的结构化 block

结果是，即使 Gateway 历史里本来有完整结构，AwarenessClaw 前端拿到的也只剩一段纯文本。

这是一号根因。

### 2. 实时阶段也只保留了“简化版状态”，没有保留原始 tool event

文件：`AwarenessClaw/packages/desktop/electron/ipc/register-chat-handlers.ts`

当前 WebSocket 事件处理逻辑：

- `event:agent` 的 `tool` stream 被转换为 `chat:status`
- `phase=start/update/result` 被压成：`tool_call` / `tool_update`
- 输出内容通过 `extractToolDetail()` 提取并截断到 600 chars

这意味着：

- 原始 args 结构丢失
- 原始 result JSON 结构丢失
- partial update 的完整增量丢失
- 超过截断阈值的输出丢失
- tool call 和 tool result 的内容类型被抹平

OpenClaw 官方做的是“保留 tool message”，AwarenessClaw 现在做的是“保留 tool summary”。

这是二号根因。

### 3. 所有 Gateway 原始事件只进了 console，没有进用户可见 trace

文件：

- `AwarenessClaw/packages/desktop/electron/ipc/register-chat-handlers.ts`
- `AwarenessClaw/packages/desktop/src/pages/Dashboard.tsx`

当前逻辑：

- 主进程把每个 gateway event 用 `send('chat:debug', '[gw:...] ...')` 发给前端
- 前端 `onChatDebug` 里只 `console.log(msg)`
- 不进入可见状态树，不进入聊天 trace UI

所以用户看不到官方截图里那种按时间顺序展开的 tool/event 轨迹，只能在开发者控制台里看一串字符串。

这是三号根因。

### 4. 前端 trace 面板的数据模型太弱，无法承接官方结构

文件：

- `AwarenessClaw/packages/desktop/src/components/dashboard/ChatTracePanel.tsx`
- `AwarenessClaw/packages/desktop/src/pages/Dashboard.tsx`

当前的 `ChatTraceEvent` 只有：

- `kind: 'status' | 'debug' | 'thinking' | 'stream'`
- `label`
- `detail`
- `raw`

缺少官方所需的关键字段：

- 原始 tool args
- 原始 tool result blocks
- runId / seq / sessionKey
- lifecycle phase
- partial vs final
- 内容类型数组
- 可折叠的结构化 payload

这导致即使后端愿意把事件发上来，现有前端状态模型也不够表达力。

这是四号根因。

### 5. 当前产品决策里有一处“主动降噪”，和官方截图目标冲突

根据仓库已有记录，之前桌面聊天对齐时做过一个产品决策：

- raw gateway debug noise 不进入聊天主视图
- `onChatDebug` 只写控制台
- tool status 最终统一收口成 `completed`

这个决策对“减少噪音”是有帮助的，但它和你现在要的目标冲突：

> 你要的是像 OpenClaw 官方截图一样，把 run trace、tool execution、tool output 完整展示出来。

如果继续坚持“debug 不可见、只显示摘要状态”，就不可能达到截图里的效果。

这是五号根因，属于产品策略冲突，不只是技术 bug。

## OpenClaw 官方到底是怎么解决的

可以把官方方案概括成一句话：

**端到端保留结构化消息，UI 只做渲染开关，不做信息降级。**

更具体地说：

### 1. Runtime 层

- Agent runtime 发出 assistant / tool / lifecycle / reasoning 等分流事件

### 2. Gateway 层

- `chat.send` 立即 ack
- `chat` 事件持续输出 delta/final
- `agent` 事件持续输出 tool 和 lifecycle
- `chat.history` 保留结构化 transcript

### 3. UI state 层

- 历史消息保留原始 message object
- 实时工具流单独存 `toolStream`
- 文本流和工具流按顺序拼装到 chat items

### 4. Renderer 层

- thinking 单独提取并折叠显示
- tool call / tool result 用卡片组件显示
- event log 在独立视图展示
- 通过 `showThinking` / `showToolCalls` 控制可见性

所以它不是“一个神奇 prompt”或者“某个模型特殊能力”，而是完整的数据管线设计。

## AwarenessClaw 与 OpenClaw 的关键差异

| 维度 | OpenClaw 官方 | AwarenessClaw 当前 |
|---|---|---|
| 历史消息 | 保留结构化 `content[]` | 只保留拼接后的纯文本 |
| tool 实时流 | 独立 tool stream message | 压成 `status + detail` |
| thinking | 从结构化 block 提取 | 仅支持简化 thinking 文本 |
| tool output | 独立卡片，可展开 | 最多只是一段 detail 文本 |
| debug/event log | 有独立 event log 视图 | 仅 `console.log` |
| 可见性控制 | 显示开关不丢数据 | 为降噪提前丢数据 |

## 最小可行修复方案

如果目标是先做到“接近截图效果”，最小方案不是重写整个聊天页，而是分三步。

### Phase 1: 停止压平数据

修改点：`electron/ipc/register-chat-handlers.ts`

1. `chat:load-history` 直接把原始 `msg.content` 返回给前端，不要只提取 text。
2. 新增 `thinking` 提取字段，而不是依赖纯文本回填。
3. 对 tool result 保留原始 block，而不是只保留 `extractToolDetail()` 结果。

目标：先保证历史消息不丢结构。

### Phase 2: 建立独立的 live tool stream

参考官方模式，在桌面端增加独立状态：

- `chatMessages`
- `chatToolMessages`
- `chatStreamSegments`

主进程不要只发：

- `chat:status`

而是新增更高保真事件，例如：

- `chat:agent-event`
- `chat:tool-start`
- `chat:tool-update`
- `chat:tool-result`
- `chat:lifecycle`

目标：把实时工具调用还原成结构化卡片，而不是字符串状态。

### Phase 3: UI 上把聊天区和事件区分层

建议不要把所有原始事件都塞进正文气泡里，而是按官方思路拆成两层：

1. 聊天主区
   - assistant 正文
   - thinking 折叠块
   - tool cards

2. 侧边或底部 debug/event 面板
   - 原始 gateway events
   - lifecycle
   - raw payload

这样既能保留信息，也不会让主聊天区过度噪声化。

## 推荐的数据模型改造

当前 `ChatTraceEvent` 不够用，建议至少升级为：

```ts
type ChatRunEvent = {
  id: string;
  runId?: string;
  sessionKey?: string;
  seq?: number;
  stream: 'assistant' | 'tool' | 'lifecycle' | 'debug';
  phase?: 'start' | 'update' | 'result' | 'end' | 'error';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  text?: string;
  thinking?: string;
  raw?: unknown;
  timestamp: number;
};
```

然后渲染层再派生：

- thinking view model
- tool card view model
- event log view model

不要在 IPC 层就决定“什么该显示，什么不该显示”。

## 我对当前问题的判断

基于代码和官方资料，当前 AwarenessClaw 聊天输出问题的根因排序如下：

1. **历史与实时数据都在 bridge 层被压平**，这是主因。
2. **前端状态模型没有 tool-stream 概念**，这是结构性缺口。
3. **之前的降噪决策与现在的目标冲突**，这是产品策略问题。
4. **trace 面板只是“状态时间线”，不是“结构化 run trace”**，这是 UI 表达力问题。

换句话说，OpenClaw 不是“展示得更激进”，而是它从协议到 UI 都没把这些信息提前丢掉。

## 建议的下一步

如果要尽快修，我建议按下面顺序落地：

1. 先修 `chat:load-history`，停止把结构化消息压平成字符串。
2. 再把 `event:agent` 的 tool 事件改成高保真 IPC，而不是 `status/detail` 摘要。
3. 最后重做聊天区的 tool card 渲染，参考 OpenClaw 的 `app-tool-stream.ts + tool-cards.ts` 思路。

这样改是低风险路径，因为：

- 第一阶段不需要大改 UI，只是停止丢数据。
- 第二阶段主要改 bridge 和状态层。
- 第三阶段才是组件层对齐官方交互。

如果你要，我下一步可以直接按这个文档开始改 AwarenessClaw 的聊天链路，先做 Phase 1 和 Phase 2。