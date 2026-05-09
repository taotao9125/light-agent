import { to } from 'await-to-js';
import workflowDefinition from './workflow.definition.js';
import { deepAssign, insertTaskToDb, insertWorkflowToDb, updateTaskToDb, updateWorkflowToDb, findWorkflowFromDb } from './utils.js';



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



class WorkflowError extends Error {
  constructor(message, code = 'WORKFLOW_EXECUTION_FAILED', detail = {}) {
    super(message);
    this.code = code;
    this.name = 'WorkflowError';
    this.detail = detail;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail
    }
  }
}

class WorkflowRunner {
  constructor(config, userInput) {
    const id = Math.random().toString(36).substring(2, 15);
    this.state = {
      // workflow run 的运行态数据；getState() 返回的就是这个对象。
      id,
      name: config.name,
      status: WORK_FLOW_STATUS.CREATED,
      error: null,
      // 记录当前/最近执行的任务 id；当前实现跑完后会清空。
      lastTaskId: null,
      context: {
        workFlowId: id,
        // 原始用户输入，所有任务都可以读取。
        userInput,
        // 每个任务完成后的 output 会按任务名写到这里。
        outputs: {}
      }
    };

    // TasksManager 负责把任务配置转换成 Task 实例。
    this.tasksManager = new TasksManager(config.tasks);

  }

  setState(newState) {
    // 统一更新 workflow state，避免在外面直接散落修改 this.state。
    this.state = deepAssign(this.state, newState);
  }

  async transaction(newState) {
    this.setState(newState);
    await updateWorkflowToDb(this.getState());
  }

  async create() {
    await insertWorkflowToDb(this.getState());
  }

  async restore(workFlowId) {
    const persistedState = await findWorkflowFromDb(workFlowId);
    if (!persistedState) {
      throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', { workFlowId });
    }

    this.setState(persistedState)
  }

  async run(workFlowId) {
    // workflow 开始执行。
    await this.transaction({ status: WORK_FLOW_STATUS.RUNNING });

    const succeeded = new Set(Object.keys(this.state.context.outputs) || {});



    for (const task of this.tasksManager.init()) {
      const taskName = task.getState().name;
      if (succeeded.has(taskName)) {
        continue;
      }
      await task.create();
      console.log('[WorkflowRunner] Running task:', taskName);

      const [e, output] = await to(task.run(this.state.context));

      if (e) {
        console.log('[WorkflowRunner] Running failed:', taskName);
        const structedErrorJson = e.toJSON?.() ?? {
          code: 'WORKFLOW_EXECUTION_FAILED',
          message: e.message || 'Unknown workflow error'
        }
        await this.transaction({
          status: WORK_FLOW_STATUS.FAILED,
          // 兜底错误结构，区分业务错误和系统错误。
          error: structedErrorJson,
          lastTaskId: task.getState().id
        });


        // 抛给最外层 main 去接收这个错误，打印日志或做其他处理。
        throw e;
      }

      console.log('[WorkflowRunner] Completed task:', task.getState().name);
      this.setState({
        context: {
          outputs: {
            // 把任务输出写入 workflow context，供后续任务或最终状态读取。
            [task.getState().name]: output
          }
        },
        lastTaskId: task.getState().id,
      });


    }

    console.log('[WorkflowRunner] Completed workflow');
    await this.transaction({ status: WORK_FLOW_STATUS.SUCCEEDED, lastTaskId: null });

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

  async transaction(newState) {
    this.setState(newState);
    await updateTaskToDb(this.getState());
  }

  async create() {
    console.log('[Task] Created task:', this.state.name);
    return await insertTaskToDb(this.getState());
  }

  async run(context) {
    // task 开始执行。
    console.log('[Task] Running task:', this.state.name);
    await this.transaction({ status: TASK_STATUS.RUNNING, workFlowId: context.workFlowId })

    const [e, output] = await to(this.handler(context));
    if (e) {

      const error = new WorkflowError('Task execution failed', 'BIZ_TASK_EXECUTION_FAILED', {
        taskId: this.state.id,
        taskName: this.state.name,
      })


      await this.transaction({ status: TASK_STATUS.FAILED, error: error.toJSON() })
      throw error;
    }

    if (!output.ok) {
      const error = new WorkflowError('Task biz logic failed', `BIZ_${output.code}` || 'BIZ_TASK_FAILED', {
        taskId: this.state.id,
        taskName: this.state.name,
      });


      console.log('[Task] Business logic failed:', this.state.name, error.detail);
      await this.transaction({ status: TASK_STATUS.FAILED, error: error.toJSON() })

      throw error;
    }

    console.log('[Task] Completed task:', this.state.name);
    await this.transaction({ status: TASK_STATUS.SUCCEEDED })
    return output;


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
  const workflow = new WorkflowRunner(workflowDefinition, demoInput);
  await workflow.create();
  await workflow.run();


  // const workflow = new WorkflowRunner(workflowDefinition, demoInput);
  // await workflow.restore('rsg6q4b3oy8');
  // await workflow.run();


}

main()
  .catch(e => {
    console.log(e)
    process.exit(1);
  })
