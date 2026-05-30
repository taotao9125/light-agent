# Agent 开发工程师 — 1 个月面试准备路线图

> 目标：**1 个月后去面试，技术面高概率通过**（不是做完整产品，不是和 Pi 比 CLI）。
>
> 原则：**ROI = 面试通过率提升 ÷ 投入小时**。只做对 deep dive 有用的事。

---

## 项目范围说明

**`src/x.ts` 不在本路线内**（非本人维护的参考代码）。简历、面试、评估、GitHub 门面 **只以 `src/agent/`、`src/protocol/`、`src/ai/`、demo 为主线**。

---

## 当前状态（面试视角）

| 已有，能讲 | 缺，容易被追问穿 |
|------------|------------------|
| Tool loop、streaming | **Context 几乎透传** |
| Event 协议、Session | **代码里答不出「context 满了怎么办」** |
| Provider 适配 | **缺单测 + 架构一页纸** |
| 斗地主 demo | **GitHub 不能 30 秒跑起来** |

**ROI 最高的事 = 补「会被 deep dive 的短板」，别扩功能面。**

---

## 总进度（完成打勾）

> 用法：每完成一项把 `[ ]` 改成 `[x]`。Week 出口 **全部打勾** 再进入下一 Week。

- [ ] **Week 1** — Context 实装 + agentLoop 小修 + ARCHITECTURE 初稿
- [ ] **Week 2** — Compaction 最小闭环 + 集成测
- [ ] **Week 3** — Report + README/录屏 + 15 道题稿
- [ ] **Week 4** — 面试准备 + 简历/GitHub 收口
- [ ] **终检** — 下方「投递前终检」全部通过

**开始日期：** ____________　**目标面试日：** ____________

---

## ROI 优先级

### S 级 — 不做就很难过技术面（~70h）

| # | 做什么 | 面试解决什么 | 估时 |
|---|--------|--------------|------|
| **1** | **contextBuilder 接上 pipe**：`applyMaxSingleObservationTokens` + **keep recent N turn / token** | 「长会话 / context 窗口 / 怎么控 token」 | 12–16h |
| **2** | **contextBuilder.test.ts**（3–5 个用例）+ 1 个「50 event log → buildContext token 下降」集成测 | 「你怎么保证没回归」 | 8–10h |
| **3** | **最小 compaction**（纯函数即可）：切点 + summary 占位 + `resolveCompactedContext` 进 pipe | 「比 sliding window 更进一步呢？」 | 16–20h |
| **4** | **agentLoop 三处小修**：tool try/catch → error OBS；ACTION 先 emit；`cwd` 从 options 注入 | 「工具失败 / 事件顺序 / 生产细节」 | 6–8h |
| **5** | **ARCHITECTURE.md**（1–2 页）+ 自己练 **5 分钟白板**（log → loop → context → provider） | 系统设计题 | 4–6h |
| **6** | **面试题稿 15 道**，每道 **指到具体文件/函数** | 口述不飘 | 12–15h |

#### S 级完成自检

- [ ] **S1** `rebuildEvents` pipe 已启用，不再透传全量 events
- [ ] **S1** `applyMaxSingleObservationTokens` 已接入（`strategy.maxSingleObservationTokens`）
- [ ] **S1** `keepRecentTurns` 或 `keepRecentTokens` 已实现（按 turn 边界切）
- [ ] **S2** `contextBuilder.test.ts` ≥ 3 个用例通过
- [ ] **S2** 集成测：50+ events → `buildContext` token/条数明显下降
- [ ] **S3** `compaction.ts` 存在：`findCutPoint` / `compactLog` / `resolveCompactedContext`
- [ ] **S3** compaction 已接入 contextBuilder pipe
- [ ] **S3** `compaction.test.ts` 通过
- [ ] **S4** tool `execute` 失败 → `isError: true` 的 OBSERVATION（或 AGENT_ERROR）
- [ ] **S4** ACTION 在 tool 执行 **之前** emit
- [ ] **S4** `cwd` 从 `PromptOptions` / `ContextSource` 注入，非写死
- [ ] **S5** `ARCHITECTURE.md` 已写（log → session → context → loop → provider）
- [ ] **S5** 能不看稿白板讲满 **5 分钟**
- [ ] **S6** 15 道题每道都有「答案要点 + 代码路径」笔记

### A 级 — S 做完再加（~25h）

| # | 做什么 | 估时 |
|---|--------|------|
| **7** | **ContextBuildReport**（raw/final tokens、保留 event 数、是否 compact） | 6–8h |
| **8** | **README**：安装、env、一条命令跑 demo + **2 分钟录屏** | 4–6h |
| **9** | **LangGraph / LangChain 对比 1 页笔记**（不实现，面试口述） | 3–4h |
| **10** | **Mock 面试 2 轮**（自问自答录屏回看） | 6–8h |

#### A 级完成自检

- [ ] **A7** `ContextBuildReport`：`rawTokens` / `finalTokens` / 保留 event 数
- [ ] **A7** report 能指出是否命中 compaction、截断了哪些 observation
- [ ] **A8** README：安装、env、一条命令跑 demo
- [ ] **A8** 2 分钟录屏或 GIF 链接已放入 README
- [ ] **A9** LangGraph/LangChain 对比笔记 1 页（tradeoff 能口述 2 分钟）
- [ ] **A10** Mock 面试 ≥ 2 轮，已录音并复盘过薄弱题

### B 级 — 本月不做（ROI 低）

- `x.ts`（非本项目，忽略即可）
- 第二个 demo、WS server、RAG 全实现
- replay API、完整 policy 引擎
- 修全 repo 无关模块

---

## 四周排期（全职）

### Week 1 — 技术面最大漏洞：Context（~40h）

| 天 | 任务 |
|----|------|
| D1–D2 | contextBuilder：`truncate` + `keepRecentTurns`（或 `keepRecentTokens`） |
| D3 | `contextBuilder.test.ts` |
| D4 | agentLoop：tool 错误 + ACTION 先 emit |
| D5 | `ARCHITECTURE.md` 初稿 + 画一遍白板 |

**Week 1 出口：** 能对着代码讲清「每 turn context 怎么来的、为什么不会无限涨」。

#### Week 1 每日任务

- [ ] **D1–D2** contextBuilder：`truncate` + `keepRecentTurns`（或 `keepRecentTokens`）
- [ ] **D3** `contextBuilder.test.ts`
- [ ] **D4** agentLoop：tool 错误 + ACTION 先 emit
- [ ] **D5** `ARCHITECTURE.md` 初稿 + 画一遍白板

#### Week 1 出口自检（全部打勾再进 Week 2）

- [ ] 打开 `contextBuilder.ts`，`events` 经 pipe 处理，不是原样 `input.events`
- [ ] 跑测试：`pnpm test` 中 context 相关用例绿
- [ ] 口述 2 分钟：「单条 observation 太大怎么办？」能指到函数
- [ ] 口述 2 分钟：「history 太长怎么办（window 层）？」能指到函数
- [ ] 未开始写 compaction（Week 2 再做）— 避免抢进度导致地基不牢

---

### Week 2 — 面试必杀：Compaction 最小闭环（~40h）

| 天 | 任务 |
|----|------|
| D1–D3 | `compaction.ts`（`findCutPoint` + `compactLog` + `resolveCompactedContext`） |
| D4 | 接入 contextBuilder pipe + `compaction.test.ts` |
| D5 | 集成测：log 变长 → compact → buildContext 变短；更新 ARCHITECTURE 加 compaction 一节 |

**Week 2 出口：** 「context 满了怎么办？」→ **三层**：truncate → window → compact，**两层有代码**。

> Compaction 不必追求完美 split turn；**能跑、能测、能讲** 即可。

#### Week 2 每日任务

- [ ] **D1–D3** `compaction.ts`（`findCutPoint` + `compactLog` + `resolveCompactedContext`）
- [ ] **D4** 接入 contextBuilder pipe + `compaction.test.ts`
- [ ] **D5** 集成测 + 更新 ARCHITECTURE compaction 一节

#### Week 2 出口自检

- [ ] 合成或真实长 log 跑 `compactLog` 后，log 追加 compaction 标记（append-only）
- [ ] compact 后 `buildContext` 的 event 数或 token 明显少于 compact 前
- [ ] 口述 3 分钟：「context 满了怎么办？」— truncate → window → compact **后两层都有代码**
- [ ] 能答：「compact 后旧 events 还在 log 里吗？」— 能结合实现说明 log vs model view
- [ ] `pnpm test` 全绿（含 compaction）

---

### Week 3 — 可讲 + 可演示（~35h）

| 天 | 任务 |
|----|------|
| D1–D2 | `ContextBuildReport`（轻量） |
| D3 | README + demo 跑通 + 录屏 |
| D4–D5 | 面试题稿 15 道 + 每道写「答案要点 + 代码位置」 |

**Week 3 出口：** 面试官要共享屏幕，你能 **live demo + 打开 report**。

#### Week 3 每日任务

- [ ] **D1–D2** `ContextBuildReport`（轻量）
- [ ] **D3** README + demo 跑通 + 录屏
- [ ] **D4–D5** 面试题稿 15 道 + 答案要点与代码位置

#### Week 3 出口自检

- [ ] 按 README 冷启动：10 分钟内跑通 demo（可请人按文档试跑）
- [ ] 共享屏幕：一轮 tool call + 展示 log / report
- [ ] 15 道题中 **至少 12 道** 能指到具体文件/函数（自评）
- [ ] GitHub 首页：README 清晰，**无 `x.ts` 作为 headline**

---

### Week 4 — 只准备面试，几乎不写新功能（~35h）

| 天 | 任务 |
|----|------|
| D1 | 题稿背熟：tool loop / streaming / context / compact / 失败处理 |
| D2 | LangGraph 对比笔记 + 「为什么自研 runtime」 |
| D3 | RAG / Multi-agent 口头题（各 30 分钟准备，不写代码） |
| D4 | Mock 面试 ×2（录音） |
| D5 | 简历 + GitHub 收口；只投「能展示项目」的岗 |

**Week 4 出口：** 技术面 **稳定输出**，不靠临场发挥。

#### Week 4 每日任务

- [ ] **D1** 题稿背熟：tool loop / streaming / context / compact / 失败处理
- [ ] **D2** LangGraph 对比笔记 + 「为什么自研 runtime」
- [ ] **D3** RAG / Multi-agent 口头题（各 30 分钟，不写代码）
- [ ] **D4** Mock 面试 ×2（录音）
- [ ] **D5** 简历 + GitHub 收口；开始投递

#### Week 4 出口自检

- [ ] 3 分钟项目介绍能脱稿讲完（Problem → Approach → Tradeoff）
- [ ] Mock 录音回听：无「嗯…大概…可能是 LangChain 那样」式空答
- [ ] 简历项目描述已更新（见下文模板），**无夸大**
- [ ] 已投递 ≥ ___ 个匹配 JD（自填目标，建议 15–30）

---

## 15 道面试题稿（必须能指到代码）

每道题答案里要有 **「在我们项目里是 `xxx.ts` 的 `xxx` 函数」**。

**掌握自检：** 能脱稿 1 分钟 + 指代码 → 打勾。

- [ ] 1. 描述一次 user prompt 在系统里的完整路径
- [ ] 2. Tool loop 怎么实现？何时结束一轮？
- [ ] 3. Streaming 时 `THOUGHT_DELTA` 和 `THOUGHT` 区别？
- [ ] 4. `ACTION` 和 `OBSERVATION` 为什么要成对？
- [ ] 5. Context 每 turn 为什么 refresh？
- [ ] 6. Observation 太大怎么办？
- [ ] 7. History 太长怎么办？（window + compact）
- [ ] 8. Compaction 切点怎么选？
- [ ] 9. Compact 后 log 里旧 events 还在吗？
- [ ] 10. 工具 `execute` 失败怎么处理？
- [ ] 11. `maxTurns` 防止什么？
- [ ] 12. Session 持久化格式？重启怎么恢复？
- [ ] 13. 和 LangChain Agent 比，tradeoff 是什么？
- [ ] 14. 若要做 RAG，你会接在哪一层？
- [ ] 15. 怎么 debug「模型不知道 X」？（report + log vs model view）

**代码位置笔记区（可选，填链接或行号）：**

| 题号 | 文件 | 函数/符号 |
|------|------|-----------|
| 1 | | |
| 2 | `agentLoop.ts` | `runAgentLoop` |
| 6 | `contextBuilder.ts` | |
| 7 | | |
| 8 | `compaction.ts` | |
| … | | |

---

## 每日自检

**开工前（30 秒）：**

- [ ] 今日任务在 Week ___ / S___ 或 A___ 内
- [ ] 这件事能否让第 **6、7、8、15** 题答得更硬？ **是 / 否**
- [ ] 若否 → 本月不做，回主线

**收工前（2 分钟）：**

- [ ] 今日计划项已打勾或写明阻塞原因
- [ ] 若有新代码 → 至少补/更新 1 个测试或手动验证步骤
- [ ] `pnpm test` 未红（或已知失败已记 issue）

---

## ROI 速查表

| 事项 | 面试 ROI |
|------|----------|
| context pipe + 测试 | ⭐⭐⭐⭐⭐ |
| 最小 compaction + 接入 | ⭐⭐⭐⭐⭐ |
| 面试题稿 + mock | ⭐⭐⭐⭐⭐ |
| agentLoop 小修 | ⭐⭐⭐⭐ |
| ARCHITECTURE + 录屏 | ⭐⭐⭐⭐ |
| ContextBuildReport | ⭐⭐⭐ |
| LangGraph 笔记（口述） | ⭐⭐⭐ |
| 第二 demo / RAG 全实现 | ⭐ |

---

## 成功概率（粗估，非承诺）

在「2 年+ 开发经验、全职执行、主攻中小厂 Agent / LLM 应用岗」假设下：

| 指标 | 现在（粗估） | 1 个月后（粗估） |
|------|-------------|-----------------|
| 简历 → 面试 | ~5–15% | ~15–30% |
| Agent 技术面通过意向 | 常卡在 context | 能拿项目硬答 |
| 拿到 offer（一次求职周期） | ~5–15% | ~15–35% |

相对提升约 **2×** 或 **+10～20 个百分点**（offer）；**Agent 专题技术面**提升最大。

---

## 简历项目描述模板

```
自研 Agent Runtime (TypeScript)                          2025.xx
• 设计 INPUT→THOUGHT→ACTION→OBSERVATION→OUTPUT 事件协议与 round/turn 元数据
• 实现 streaming tool loop，对接 OpenAI / Gemini function calling
• Session JSONL 持久化；ContextBuilder 投影（observation 截断 + 近期 turn 保留）
• [可选] Compaction 摘要 + ContextBuildReport 可观测性
GitHub: xxx  Demo: xxx
```

**不要写：**「5700 行 context 平台」「超越 Pi」。**不要提 `x.ts`。**

---

## 面试故事线（3 分钟）

**Problem：** 长会话 agent 会 context 爆、tool 结果过大、难以 debug。

**Approach：** Event log 作 SSOT；AgentLoop 只管单轮推理环；ContextBuilder 每 turn 投影；Session 持久化。

**Tradeoffs：** 为什么不用 LangChain 全家桶 → 可控、可测、语义 event 适合 tool 审计。

**Deep dive 准备：**

- context 满了怎么办（truncate → window → compaction）
- ACTION/OBSERVATION 为什么要成对
- streaming 时何时 commit event
- 工具失败怎么处理

---

## 一句话总结

```
Week1  context 实装 + 测试
  → Week2  最小 compaction
  → Week3  report + demo + 题稿
  → Week4  只面试，不加功能
```

技术面从「有 loop 但 context 讲虚」→「**三层 context 策略都有代码 + 能白板 + 能 demo**」。

---

## 投递前终检（全部打勾再大量投递）

### 工程

- [ ] `pnpm test` 通过
- [ ] `pnpm ts:check` 在 `src/agent/`、`src/protocol/`、`src/ai/` 相关路径无 blocking error
- [ ] README 10 分钟内能跑通 demo
- [ ] 简历/GitHub **未提及 `x.ts`**

### 技术面口述（各 2 分钟内）

- [ ] prompt 全路径
- [ ] tool loop 结束条件
- [ ] context 三层：truncate / window / compact
- [ ] 工具失败处理
- [ ] 为什么自研 runtime（vs LangChain）

### 演示

- [ ] 录屏或 live demo 练过 ≥ 2 次
- [ ] 能打开 `ContextBuildReport` 或等价输出解释 token

### 文档

- [ ] `ARCHITECTURE.md` 与代码一致（无画饼模块）
- [ ] 15 道题 ≥ 12 道已打勾

**终检日期：** ____________　**签字/自评：** 就绪 / 延后 ___ 天

---

## 相关代码路径

| 模块 | 路径 |
|------|------|
| Agent loop | `src/agent/agentLoop.ts` |
| Session | `src/agent/agent.ts` |
| Context builder | `src/agent/contextBuilder.ts` |
| Event 协议 | `src/protocol/events.ts` |
| Store | `src/agent/store.ts` |
| AI Provider | `src/ai/` |
