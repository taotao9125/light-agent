import fs from 'fs/promises';
import path from 'path';

const tasksDbPath = path.resolve(process.cwd(), 'src/db/tasks.json');
const workFlowDbPath = path.resolve(process.cwd(), 'src/db/workflow.json');


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

async function insertTaskToDb(task) {
  let currentTasks = [];
  try {
    currentTasks = JSON.parse(await fs.readFile(tasksDbPath, 'utf-8'))
  } catch (e) {
  }
  const newTasks = [...currentTasks, task];
  // 模拟持久化任务状态到数据库，这里直接写文件。
  return fs.writeFile(tasksDbPath, JSON.stringify(newTasks, null, 2));
}


async function updateTaskToDb(task) {

  let currentTasks = [];
  try {
    currentTasks = JSON.parse(await fs.readFile(tasksDbPath, 'utf-8'))
  } catch (e) {

  }

  const newTasks = currentTasks.map(t => t.id === task.id ? task : t);

  return fs.writeFile(tasksDbPath, JSON.stringify(newTasks, null, 2));

}

async function insertWorkflowToDb(workflowState) {
  let currentWorkflowState = [];
  try {
    currentWorkflowState = JSON.parse(await fs.readFile(workFlowDbPath, 'utf-8'))
  } catch (e) {

  }
  const newWorkflowState = [...currentWorkflowState, workflowState];
  // 模拟持久化 workflow 状态到数据库，这里直接写文件。
  return fs.writeFile(workFlowDbPath, JSON.stringify(newWorkflowState, null, 2));
}

async function updateWorkflowToDb(workflowState) {
  let currentWorkflowState = [];
  try {
    currentWorkflowState = JSON.parse(await fs.readFile(workFlowDbPath, 'utf-8')) || [];
  } catch (e) {

  }
  const newWorkflowState = currentWorkflowState.map(wf => wf.id === workflowState.id ? workflowState : wf);
  // 模拟持久化 workflow 状态到数据库，这里直接写文件。
  return fs.writeFile(workFlowDbPath, JSON.stringify(newWorkflowState, null, 2));
}

async function findWorkflowFromDb(workFlowId) {
  try {
    const currentWorkflowState = JSON.parse(await fs.readFile(workFlowDbPath, 'utf-8')) || [];
    return currentWorkflowState.find(wf => wf.id === workFlowId);
  } catch (e) {
    return null;
  }
}




export {
  deepAssign,
  insertTaskToDb,
  updateTaskToDb,
  insertWorkflowToDb,
  updateWorkflowToDb,
  findWorkflowFromDb
}