 有，而且很值得看。下面这些是我觉得和你现在理解的 “compose + 状态/上下文/重试/分支/并行/补偿/等待” 最相关的官方文章或文档。

  OpenAI

  1. A practical guide to building agents (https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
     重点看 Orchestration 部分。它把 agent workflow 分成 single-agent loop 和 multi-agent orchestration，也强调不要一上来就搞复杂自治系统。
  2. OpenAI Agents SDK: Agent Orchestration (https://openai.github.io/openai-agents-js/guides/multi-agent/)
     这篇很贴近你说的 compose(task1, task2, task3)。它明确区分两种编排：
      - 让 LLM 决定下一步
      - 用代码决定流程

  Anthropic
  3. Building effective agents (https://www.anthropic.com/engineering/building-effective-agents)
  强烈推荐。Anthropic 这篇把很多 agentic workflow 拆成简单模式，比如：

  - prompt chaining
  - routing
  - parallelization
  - orchestrator-workers
  - evaluator-optimizer

  这篇和你现在的问题最契合，因为它强调：成功的 agent 系统通常不是复杂框架，而是简单、可组合的 workflow pattern。

  4. Building Effective AI Agents eBook (https://resources.anthropic.com/building-effective-ai-agents)
     更偏白皮书/长文，适合系统读。里面会讨论什么时候用 workflow-based architecture，什么时候用 single-agent / multi-agent。

  Microsoft
  5. Semantic Kernel: Multi-agent Orchestration (https://devblogs.microsoft.com/agent-framework/semantic-kernel-multi-agent-orchestration/)
  这篇直接讲编排模式：

  - Sequential Orchestration
  - Concurrent Orchestration
  - Group Chat
  - Handoff
  - Magentic

  6. Microsoft Agent Framework: Magentic Orchestration (https://learn.microsoft.com/en-us/agent-framework/user-guide/workflows/orchestrations/magentic)
     适合理解 “动态 workflow”。它不是固定 task1 -> task2 -> task3，而是 manager agent 根据上下文决定哪个 agent 下一步执行。
  7. AutoGen: Enabling next-generation large language model applications (https://www.microsoft.com/en-us/research/blog/autogen-enabling-next-generation-large-language-model-applications/)
     Microsoft Research 的经典文章，讲多 agent 对话如何形成复杂 LLM workflow。

  Google
  8. Google ADK: Workflow Agents (https://google.github.io/adk-docs/agents/workflow-agents/)
  很适合你现在的阶段。它明确说 Workflow Agents 是纯编排组件，不靠 LLM 动态决策，而是确定性控制执行顺序。里面有：

  - Sequential Agents
  - Parallel Agents
  - Loop Agents

  9. Vertex AI Agent Builder (https://cloud.google.com/products/agent-builder)
     偏产品架构，讲怎么构建、治理、扩展 enterprise agent workflows。
  10. Build a multi-agent KYC workflow using Google ADK and Gemini (https://cloud.google.com/blog/products/ai-machine-learning/build-kyc-agentic-workflows-with-googles-adk/)
     一个具体业务 workflow 例子，KYC 场景很典型：资料检查、外部搜索、风险判断、报告生成。

  我建议阅读顺序：

  1. Anthropic - Building effective agents
  2. OpenAI - Practical guide to building agents
  3. OpenAI Agents SDK - Orchestration
  4. Google ADK - Workflow Agents
  5. Microsoft Semantic Kernel - Multi-agent Orchestration

  如果只看一篇，先看 Anthropic 那篇。它最接近你现在从 compose() 推到 workflow pattern 的思路。