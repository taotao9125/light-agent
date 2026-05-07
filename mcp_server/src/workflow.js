/**
通用状态: created, running, succeeded, failed
workflow 跑 task，task 可能会有输入输出，输入来自 workflow 的 context，输出会放到 workflow context 的 outputs 里，key 是 task name
 */

/**
 * TODO
 *  P0：先保证跑得对

  - 任务 key 和 name 分离
  - WorkflowDefinition / WorkflowRun 分离
  - TaskDefinition / TaskRun 分离
  - 统一错误结构：{ code, message, detail }
  - 失败传播策略：任务失败后 workflow 怎么处理
  - 任务 input / output 结构固定下来
  - 输入校验：至少校验 workflow input

  P1：保证失败后能恢复

  - 状态持久化
  - 恢复执行
  - 幂等性设计
  - 重试策略
  - task 级超时
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


const WORK_FLOW_STATUS = {
  // WorkflowRunner 的整体生命周期状态。
  CREATED: 'created',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed'
}

const TASK_STATUS = {
  // 单个 Task 的生命周期状态。
  CREATED: 'created',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
}

const WORKFLOW_CONFIG = {
  // 工作流定义：描述这个流程是什么，以及包含哪些任务。
  name: 'book_meeting_room',
  description: '根据参会人数和会议时间自动预定一个可用会议室',
  tasks: [
    {
      // 当前最小 demo 用 name 作为任务标识；后续可以拆成 key + name。
      name: 'booking_task',
      description: '预定会议室',
      // handler 是任务真正执行的业务函数。
      handler: bookingRoom
    }
  ]
}


// 上面那个 deepAssign 函数直接拿来用
function deepAssign(target, ...sources) {
  // 合并 state 时保留已有字段，只覆盖传入 newState 中出现的字段。
  for (const source of sources) {
    for (const key in source) {
      const targetVal = target[key];
      const sourceVal = source[key];
      if (typeof sourceVal === "object" && sourceVal !== null && !Array.isArray(sourceVal)) {
        if (typeof targetVal !== "object" || targetVal === null || Array.isArray(targetVal)) {
          target[key] = {};
        }
        deepAssign(target[key], sourceVal);
      } else {
        target[key] = sourceVal;
      }
    }
  }
  return target;
}


function bookingRoom(context) {
  // 业务任务函数：读取 workflow context 里的用户输入，返回本任务 output。
  const { userId, startTime, endTime } = context.userInput;
  return {
    bookingId: `booking_${Date.now()}`,
    userId,
    roomId: `room_${Math.floor(Math.random() * 100)}`,
    startTime,
    endTime
  }
}


class WorkflowRunner {
  constructor(config, userInput) {
    this.state = {
      // workflow run 的运行态数据；getState() 返回的就是这个对象。
      id: Math.random().toString(36).substring(2, 15),
      name: config.name,
      status: WORK_FLOW_STATUS.CREATED,
      error: null,
      // 记录当前/最近执行的任务 id；当前实现跑完后会清空。
      lastTaskId: null,
      context: {
        // 原始用户输入，所有任务都可以读取。
        userInput,
        // 每个任务完成后的 output 会按任务名写到这里。
        outputs: {}
      },
      // run() 结束后保存所有任务的最终状态快照。
      tasks: []
    };

    // TasksManager 负责把任务配置转换成 Task 实例。
    this.tasksManager = new TasksManager(config.tasks);

  }

  setState(newState) {
    // 统一更新 workflow state，避免在外面直接散落修改 this.state。
    this.state = deepAssign(this.state, newState);
  }

  async run() {
    // workflow 开始执行。
    this.setState({ status: WORK_FLOW_STATUS.RUNNING });

    try {
      // 当前最小版是顺序执行所有任务。
      for (const task of this.tasksManager.init()) {
        const output = await task.run(this.state.context);
        this.setState({
          lastTaskId: task.getState().id,
          context: {
            outputs: {
              // 把任务输出写入 workflow context，供后续任务或最终状态读取。
              [task.getState().name]: output
            }
          }
        });
      }

      // 所有任务执行完，workflow 成功。
      this.setState({ status: WORK_FLOW_STATUS.SUCCEEDED, lastTaskId: null });
    } catch (e) {
      // 任意任务抛错后，workflow 标记为失败。
      this.error = e;
      this.setState({ error: e, status: WORK_FLOW_STATUS.FAILED });
    }
    finally {
      // 无论成功失败，都把任务状态同步到 workflow state。
      this.setState({ tasks: this.tasksManager.getState() });
    }
  }

  getState() {
    // 对外暴露 workflow 当前状态。
    return this.state;
  }



}

class Task {
  constructor(config) {

    this.state = {
      // task run 的运行态数据。
      id: Math.random().toString(36).substring(2, 15),
      name: config.name,
      status: TASK_STATUS.CREATED,
      error: null
    }

    // 保存业务执行函数，run() 时调用。
    this.handler = config.handler;
  }

  setState(newState) {
    // 统一更新 task state。
    this.state = deepAssign(this.state, newState);
  }

  async run(context) {
    // task 开始执行。
    this.setState({ status: TASK_STATUS.RUNNING });
    try {
      // handler 的返回值就是这个 task 的 output。
      const ret = await this.handler(context);
      this.setState({ status: TASK_STATUS.SUCCEEDED });
      return ret;
    } catch (e) {
      // 记录 task 错误，并继续向上抛给 WorkflowRunner。
      this.setState({ error: e.message, status: TASK_STATUS.FAILED });
      throw e;
    }
  }


  getState() {
    // 对外暴露 task 当前状态。
    return this.state;
  }

}

class TasksManager {
  constructor(tasks) {
    // 把 workflow config 里的 task 配置转换成可执行的 Task 实例。
    this.tasks = tasks.map(taskConfig => new Task(taskConfig));

  }

  init() {
    // 当前最小版直接返回所有任务，WorkflowRunner 负责顺序执行。
    return this.tasks;
  }

  getState() {
    // 返回所有 task 的状态快照。
    return this.tasks.map(task => task.getState());
  }

}


const demoInput = {
  userId: 'user_001',
  startTime: '2026-05-08 14:00:00',
  endTime: '2026-05-08 15:00:00'
};

async function main() {
  // 创建一次 workflow run，并执行。
  const workflow = new WorkflowRunner(WORKFLOW_CONFIG, demoInput);
  await workflow.run();
  // 打印最终状态，方便观察 workflow 和 task 的状态变化结果。
  console.log(JSON.stringify(workflow.getState(), null, 2));
}

main();
