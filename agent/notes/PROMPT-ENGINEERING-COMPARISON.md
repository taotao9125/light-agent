# Prompt Engineering 对比笔记

这份文档对比四篇 prompt engineering 资料，并把它们映射到 agent runtime 的设计里。

资料来源：

- OpenAI Prompt Engineering: https://platform.openai.com/docs/guides/prompt-engineering
- Azure OpenAI System Message Design: https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/advanced-prompt-engineering
- Claude Code Modifying System Prompts: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
- Anthropic Prompt Engineering Overview: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview

## 核心结论

这几篇文档角度不同，但共同指向一个工程判断：

```text
Prompt engineering is context construction.
Prompt 工程，本质是上下文构造。
```

对 agent 来说，prompt 工程不是写一句聪明的提示词，而是设计一个 `Context Builder`，把 Host 侧的不同输入编译成模型能看到的 messages：

```text
rules
+ skills
+ project context
+ user goal
+ tool schemas
+ tool observations
+ retrieved evidence
+ task state
+ memory
= model request payload
```

## 共同原则

### 1. 高优先级规则要和用户输入分开

四篇资料都显式或隐式使用了分层控制：

```text
developer/system instructions
> user request
> assistant history
> tool observations / dynamic context
```

对你的 agent 来说，这意味着：

```text
runtime rules
project rules
tool policy
skill index
```

不要随便和用户当前请求混在一起。它们应该由 Host 构建，并放在更高优先级的 prompt section 或 message 里。

OpenAI 在这一点上最明确：`developer message` 更像应用开发者写的规则和业务逻辑，`user message` 更像传给这些逻辑的当前输入参数。

### 2. 用结构标记上下文边界

这些文档都倾向于使用结构化 prompt：

```text
Markdown headings
XML-like tags
clear sections
examples
explicit output contracts
```

对 agent 来说，可以形成这种 prompt 结构：

```text
<RuntimeRules>
...
</RuntimeRules>

<ProjectContext>
...
</ProjectContext>

<AvailableSkills>
...
</AvailableSkills>

<TaskState>
...
</TaskState>

<RetrievedEvidence>
...
</RetrievedEvidence>
```

注意：`XML-like tags` 不是协议，也不是模型真的在解析 XML。它只是普通文本边界，用来帮助模型区分不同类型的上下文。

### 3. 明确告诉模型你要什么行为

这些资料都反对依赖模糊意图。好的 prompt 应该明确说明：

```text
assistant 是什么角色
应该做什么
不能做什么
不确定时怎么办
输出格式是什么
工具应该怎么用
```

对你的 agent 来说，`systemPrompt` 里应该有直接规则，例如：

```text
When the task is large, create or update a task plan first.
When project-private knowledge is needed, use search_docs.
When a file's content is needed, read it before editing.
When a tool fails, reason from the observation and decide the next action.
```

翻成你的工程语言就是：

```text
大任务先建 task_plan
需要私有知识时用 search_docs
需要文件事实时先 read_file
工具失败后基于 observation 继续决策
```

### 4. Prompt 需要版本管理和验证

OpenAI 和 Anthropic 都强调 empirical evaluation，也就是通过实际样例验证 prompt 行为。Microsoft 也提醒：system message 会影响模型行为，但不能保证模型一定遵守。

对你的 agent 来说：

```text
prompt change = runtime behavior change
```

所以重要的 prompt builder 应该：

```text
存放在代码里
纳入版本控制
可以 code review
有代表性样例验证
必要时可以量化
```

这直接对应这些模块：

```text
contextBuilder.ts
skill formatter
tool observation formatter
task plan formatter
RAG result formatter
```

### 5. Context 有用，但不能无限塞

OpenAI 和 Anthropic 都强调 context window 限制，以及只提供相关上下文。Microsoft 也提醒 system message 不应该过长。

对你的 agent 来说：

```text
不要把所有东西都 dump 到 systemPrompt。
```

不同来源应该用不同策略：

```text
always-on rules -> system/developer prompt
skill metadata -> skill index
skill body -> load on demand
RAG -> retrieve relevant evidence
event log -> recent turns or summarized state
tool result -> concise observation
memory -> relevant recalled facts/preferences
```

### 6. Agent prompt 必须描述工具使用方式

OpenAI 和 Claude Code 对 coding agent 最相关。它们都把 tool-use instructions 当成 agent 行为契约的一部分。

对你的 agent 来说，工具提示至少要回答：

```text
模型什么时候应该调用工具？
应该提供什么参数？
拿到 observation 以后怎么办？
什么时候继续？
什么时候停止？
工具失败时怎么处理？
```

这也是为什么只有 `ToolRegistry` 不够。模型除了看到工具 schema，还需要看到工具使用策略。

## 不同侧重点

| 资料 | 主要关注点 | 对你的 agent 最有价值的启发 |
| --- | --- | --- |
| OpenAI Prompt Engineering | API 层 prompt 构造、message roles、代码管理 prompt、Markdown/XML 结构、context/RAG、模型差异 | 把 `developer/systemPrompt` 当成应用逻辑。prompt builder 应该放在代码里并可验证。 |
| Azure OpenAI System Message Design | system message 的 role、scope、tone、output format、safety、fallback behavior | 把 `systemPrompt` 设计成可维护的行为契约：角色、边界、输出格式、不确定策略。 |
| Claude Code System Prompts | Agent SDK 行为定制：preset、append、custom prompt、project context、output styles | 把基础 agent 行为、项目规则、产品扩展分开，不要全塞进一个大 prompt。 |
| Anthropic Prompt Engineering Overview | prompt 工程流程：先定义成功标准，再评估和迭代 | 不要凭感觉调 prompt。先定义要改善什么，再改 prompt。 |

## OpenAI：Prompt 是应用逻辑

OpenAI 的角度最接近 provider API 设计。

重点：

- 使用 message roles 或 `instructions` 表达更高优先级行为。
- `developer message` 保存规则和业务逻辑。
- `user message` 保存当前任务输入。
- Markdown 和 XML-like tags 用来标记逻辑边界。
- developer message 通常包含 `Identity`、`Instructions`、`Examples`、`Context`。
- 生产 prompt 应该放在应用代码里，支持类型、review、测试、部署。
- 当模型需要私有数据或外部资料时，应该提供 relevant context，包括 RAG。
- 不同模型家族可能需要不同 prompt 风格。

映射到你的 agent：

```text
contextBuilder.ts
= 把应用逻辑编译成模型可见 messages

systemPrompt/developer message
= runtime rules + tool policy + skill index + project rules

user message
= current goal + user constraints

tool messages / observations
= external execution results
```

## Azure：System Message 是行为契约

Azure 这篇更偏 chat application 里的 system message 设计。

重点：

- System message 定义角色、边界、语气、输出格式、安全和质量约束。
- 它会影响行为，但不能保证模型一定遵守。
- 好的 system message 应该清晰、不冲突，并明确 fallback behavior。
- 常见问题包括：规则冲突、message 过长、输出格式要求隐藏得太深。

映射到你的 agent：

```text
systemPrompt 应该包含：

1. Role
2. Scope
3. Tool-use boundaries
4. Output contract
5. Error / uncertainty policy
6. Safety or file-operation boundaries
```

例子：

```text
If you lack file evidence, read the relevant file first.
If a tool fails, do not pretend success; explain the failure and choose the next action.
If the task is ambiguous, ask a concise clarification or create a plan with assumptions.
```

## Claude Code：Prompt 是 Agent Runtime 配置

Claude Code 这篇最接近真实 coding agent 的设计。

重点：

- system prompt 定义行为、能力和回复风格。
- Claude Code 提供 CLI/IDE coding agent 的 preset。
- 可以 append 产品侧规则，同时保留 preset。
- 也可以完全替换 prompt，但那样就要自己重建 tool guidance 和 safety behavior。
- `CLAUDE.md` 这类项目级文件会作为 project context 注入，不一定等同于 system prompt 本身。
- Skills、hooks、permissions 这些机制也会影响行为，但它们不一定都属于 system prompt。

映射到你的 agent：

```text
base runtime prompt
+ append project-specific rules
+ project instructions
+ skill index
+ tool schemas
+ permission model
= coding agent behavior
```

这里有一个重要提醒：

```text
不要把所有行为都塞进一个巨大的 systemPrompt。
```

有些行为属于 Host 侧机制：

```text
permissions
hooks
tool registry
skill discovery
memory retrieval
task plan state
event log compaction
```

## Anthropic：Prompt 工程是评估迭代流程

Anthropic 这篇不太强调某一种 prompt 格式，而是强调 prompt 迭代的方法。

重点：

- 做 prompt engineering 前，先定义成功标准。
- 要有方法基于这些标准做经验性测试。
- 从初版 prompt 开始，然后迭代。
- 不是所有失败都应该靠改 prompt 解决；有时问题在模型选择、延迟/成本权衡、工具设计、检索质量或 evaluation。

映射到你的 agent：

```text
不要只凭感觉调 contextBuilder。
```

每个 prompt 模块都应该知道自己要改善什么：

```text
tool policy
-> 减少错误工具调用

task plan rules
-> 减少长任务中途断裂

RAG formatting
-> 提升回答 grounding

observation formatting
-> 降低 token 浪费，让后续推理更容易

skill index
-> 提升按需复用行为的能力
```

## Agent Context 映射表

对你的 agent，可以用这个实用分类：

| Agent 来源 | 模型侧类别 | 通常放到哪里 |
| --- | --- | --- |
| Base runtime rules | Instruction / Constraint | system 或 developer message |
| `AGENTS.md` 这类项目规则 | Instruction / Constraint / Project Context | system/developer 或 project context block |
| Skill metadata | Skill Index / Tool Hint / Conditional Instruction | system/developer prompt |
| Skill body | Instruction / Workflow / Constraint / Output Contract | 按需加载进上下文 |
| User request | Goal / Constraint | user message |
| Event log | History / State / Observation | 近期 messages 或 summarized state |
| Tool call result | Observation | tool message 或 observation block |
| RAG result | Evidence | user/tool message 或 evidence block |
| Memory | Preference / Stable Fact / State | memory block |
| Task plan | State / Goal Decomposition | state block |
| Tool schemas | Action Interface | API `tools` 字段 |

## 推荐的 Prompt Layout

基于你当前架构，可以使用一个稳定的 prompt builder：

```text
<Identity>
You are a local coding agent running inside a host runtime.
</Identity>

<RuntimeRules>
- Use tools when external state is needed.
- Do not claim file contents without reading them.
- For large tasks, create or update a task plan.
- Stop when the user's goal is complete or when blocked by missing information.
</RuntimeRules>

<ToolPolicy>
- read_file: use when exact file content is needed.
- list_files: use when locating files.
- search_docs: use when private project knowledge is needed.
- task_plan: use when work needs multiple steps or continuity.
</ToolPolicy>

<ProjectContext>
...AGENTS.md or project instructions...
</ProjectContext>

<AvailableSkills>
...skill name, description, location...
</AvailableSkills>

<TaskState>
...current plan / progress...
</TaskState>

<RelevantMemory>
...only relevant recalled facts or preferences...
</RelevantMemory>
```

动态内容尽量不要全部塞进静态 systemPrompt：

```text
user message -> current goal
tool result -> observation
RAG result -> evidence
event log -> recent messages or summary
```

## 不要过载 SystemPrompt

避免这些错误：

```text
不要把所有 context 都当成 instruction。
不要把所有 skills 永久塞进 systemPrompt。
不要永久塞完整 event log。
不要在可读 observation 足够时 stringify 嵌套 JSON。
不要以为 systemPrompt 能保证模型一定遵守。
不要没有样例或检查就随便改 prompt 行为。
```

## 最终心智模型

```text
Provider API view:
messages + tools + model params

Model view:
text context + tool schemas

Agent runtime view:
Context Builder 把 rules、skills、memory、RAG、state、event log 编译成 provider messages。

Engineering view:
Prompt design is runtime behavior design.
所以它应该被版本化、结构化、验证和度量。
```

