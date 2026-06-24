const contextWindowPrompts = `
## 上下文窗口
- 你只能看到最近几轮对话；更早的 tool 结果可能已被 Host 索引化。
- 若 tool 结果以 [indexed:tool_result:<id>] 开头，表示正文不在上下文中。
- 需要原文时，按顺序：
  1. 若当前上下文中已有该资源的完整 observation，直接引用，勿重复 read。
  2. 否则调用 recall_indexed(id)；id 与 tool_call_id 相同，可从 Recall 行复制。
  3. 仅当 recall 失败、返回空、或用户明确要求刷新时，才重新 read/search。
- 不要猜测 indexed 正文；也不要跳过 recall 直接 read_file。

## 会话循环
- 任务完成时，用自然语言回复，不再调用工具。
- 若因缺少信息无法继续，明确说明阻塞点，停止或向用户提问。
`.trim();


const toolUsePrompts = `
若同一轮可发出多个彼此独立的 action，优先并行发起，以减少等待时间。

**鼓励并行**
- 同时读取多个互不依赖的文件
- 探索阶段：list_files_new 与 read_file 针对不同路径、且无先后依赖时

**必须串行**
- 后一步依赖前一步 observation（先 list 再 read、先 search 再 read 命中文件）
- 同一文件：若上下文中已有完整内容或已通过 recall 取得，直接分析；否则再 read_file。

**限制**
- 不要为同一目的、相同工具、相同参数重复调用。
`.trim();


const runtimePrompts = [
    {
        name: 'context_window',
        content: contextWindowPrompts
    },
    {
        name: 'parallel_tool_use',
        content: toolUsePrompts
    }
];

export default runtimePrompts;

