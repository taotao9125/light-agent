/**
通用状态: created, running, succeeded, failed
workflow 跑 task，task 可能会有输入输出，输入来自 workflow 的 context，输出会放到 workflow context 的 outputs 里，key 是 task name
 */

/**
 * TODO
 *  P0：先保证跑得对

  -   任务 key 和 name 分离
  - ✅ WorkflowDefinition / WorkflowRun 分离
  - ✅ TaskDefinition / TaskRun 分离
  - ✅ 统一错误结构：{ code, message, detail }
  - ✅ 失败传播策略：任务失败后 workflow 怎么处理 ----> task -> workflow -> throw 
  - ✅ 任务 input / output 结构固定下来
  - 输入校验：至少校验 workflow input

  P1：保证失败后能恢复

  - ✅ 状态持久化
  - ✅ 恢复执行 new XXX/create | restore/run
  - 幂等性设计 ----> 数据库那边设计
  - ✅ 重试策略 ----> workFlowrunner call withRetry(() => promiseFn, retryConfig)
  - ✅ task 级超时
  - workflow 级超时
  - 审计日志 / 事件日志

  P2：支持复杂流程

  - 依赖关系建模：dependsOn
  - 跳过策略：skipped
  - 并行任务调度
  - context 版本管理或按 task output 隔离
  - 取消机制
  - 补偿机制
  - 输出契约：task output schema

  P3：生产化运维能力

  - 可观测性：traceId、日志、指标、耗时
  - 死信 / 失败归档
  - 限流和并发控制
  - 权限和安全边界
  - 敏感数据处理
  - 可视化状态查询

  P4：平台化能力

  - 任务类型插件化
  - 流程定义版本控制
  - 多 worker / 队列执行器
  - 管理后台
  - 流程编排 UI
 */
