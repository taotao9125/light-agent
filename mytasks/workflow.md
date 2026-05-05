# min-workflow-yield.js 四条命令代表什么

这 4 条命令是在模拟一个真实 agent / workflow 的完整生命周期：

```bash
node demos/min-workflow-yield.js reset
node demos/min-workflow-yield.js
node demos/min-workflow-yield.js approve
node demos/min-workflow-yield.js
```

对应真实系统里就是：

```text
初始化任务
  -> 执行到需要外部事件时暂停
  -> 外部事件到达
  -> 从持久化状态恢复并继续执行
```

## 1. reset：创建一个干净世界

```bash
node demos/min-workflow-yield.js reset
```

在 demo 里代表：

```text
删除旧 workflow state
清空之前的执行记录
准备从 0 开始
```

真实 agent / workflow 里对应：

```text
创建一个新的任务实例
创建一个新的 workflow run
清理旧测试状态
初始化上下文
```

比如真实场景：

```text
用户发起：帮我订明天下午 2 点会议室
```

系统创建：

```json
{
  "workflowId": "wf_001",
  "status": "created",
  "context": {
    "userId": 1,
    "goal": "订会议室"
  }
}
```

## 2. 第一次 run：执行到等待点

```bash
node demos/min-workflow-yield.js
```

demo 里执行了：

```text
validate
create_booking
wait_approval
```

然后停住：

```text
[side effect] insert booking
[waiting] admin approval required
```

也就是说：

```text
预约已经创建
但是需要管理员审批
workflow 不能继续
所以保存状态并退出
```

真实 agent / workflow 里对应：

```text
agent / workflow 开始执行任务
完成能自动完成的步骤
遇到需要外部输入、人工审批、异步回调、长时间等待时暂停
```

比如：

```text
用户申请预约
  -> 系统校验参数
  -> 创建 pending booking
  -> 发现需要管理员审批
  -> 状态保存为 waiting
  -> 当前进程可以结束
```

状态可能是：

```json
{
  "status": "waiting",
  "currentStep": "wait_approval",
  "context": {
    "bookingId": 123,
    "bookingStatus": "pending",
    "waitingFor": "admin_approval"
  }
}
```

这就是 workflow 的核心：

```text
进程可以停，但任务状态不能丢。
```

## 3. approve：外部事件到达

```bash
node demos/min-workflow-yield.js approve
```

demo 里代表：

```text
管理员批准了
写入 events.approved = true
把 bookingStatus 改成 approved
```

真实系统里对应：

```text
外部事件 / 人工动作 / webhook / 消息队列事件 到达
```

比如：

```text
管理员点击“通过”
第三方支付 webhook 回调成功
用户确认危险操作
CI job 完成
文件上传完成
定时器到期
```

真实接口可能是：

```http
PATCH /api/booking/123/review
```

或者：

```text
Webhook: payment.succeeded
```

它做的事不是重新跑整个 workflow，而是：

```text
把等待中的 workflow 标记为可继续
写入事件
更新上下文
```

## 4. 第二次 run：恢复并继续执行

```bash
node demos/min-workflow-yield.js
```

demo 里会：

```text
读取 /tmp/min-workflow-yield-state.json
知道之前已经完成 validate/create_booking
跳过已完成步骤
看到 approved=true
继续执行 after_approval
并行 sendEmail + writeAuditLog
完成 workflow
```

真实系统里对应：

```text
worker / scheduler / agent runtime 发现某个 waiting workflow 可以继续
从持久化状态恢复
跳过已完成步骤
从安全点继续执行
最终完成任务
```

例如：

```text
审批通过后
  -> 发送通知
  -> 写审计日志
  -> 标记 workflow completed
```

## 放到真实 agent 里看

如果是真实 agent，不一定是“审批会议室”，可能是：

```text
用户：帮我修复 CI 失败
```

对应关系：

### reset

```text
创建一个新的 agent task
清空旧 trace
初始化目标和上下文
```

### 第一次 run

```text
agent 开始：
  -> 读 CI 日志
  -> 读相关文件
  -> 生成修改计划
  -> 遇到危险动作：需要用户批准执行 git push / deploy
  -> 状态变 waiting
```

### approve

```text
用户确认：
  -> 允许执行测试
  -> 允许修改文件
  -> 允许部署
```

### 第二次 run

```text
agent 恢复：
  -> 执行已批准动作
  -> 跑测试
  -> 总结结果
  -> 完成任务
```

## 这 4 步背后的真实概念

```text
reset
  = 创建任务实例 / 清空旧状态

run 第一次
  = 执行到阻塞点，保存状态

approve
  = 外部事件到达，更新状态

run 第二次
  = 从状态恢复，继续执行
```

更工程化一点：

```text
workflow instance lifecycle:

created
  -> running
  -> waiting
  -> event received
  -> running
  -> completed
```

## 为什么真实系统需要这样

因为真实任务经常不是一个 HTTP 请求能跑完的。

比如：

```text
等待人工审批
等待支付回调
等待 CI 完成
等待文件处理
等待外部 API 恢复
等待用户确认
等待子 agent 完成
```

如果只靠一个函数一路 `await`：

```js
await waitForAdminApproval();
```

进程可能要挂很久，而且服务重启就丢了。

workflow 的做法是：

```text
保存状态
退出
等事件来了再恢复
```

## 一句话总结

这 4 条命令模拟的是：

```text
一个 agent/workflow 任务从创建，到执行，到等待外部事件，再到恢复完成的完整生命周期。
```

更短：

```text
reset = 新任务
run = 自动执行
approve = 外部事件
run = 恢复继续
```
