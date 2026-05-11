
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';


dotenv.config();

if (process.env.HTTPS_PROXY) {
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}

const MODEL = process.env.AI_MODEL;


function assertAIKey() {
  if (!process.env.AI_API_KEY) {
    console.error('请在 mcp_server/.env 中设置 AI_API_KEY');
    process.exit(1);
  }
}

function createClient() {
  return new OpenAI({
    apiKey: process.env.AI_API_KEY,
    baseURL: process.env.AI_API_HOST,
    timeout: 600_000,
    maxRetries: 4,
  });
}



async function findRoomBookings() {
  return axios.request({
    method: 'get',
    url: 'http://localhost:3000/api/booking',
    headers: {
      Authorization: `Bearer ${process.env.bearer_token}`
    }
  }).then(r => r.data)
}


async function checkHealth() {
  return axios.request({
    method: 'get',
    url: 'http://localhost:3000/health',
    headers: {
      Authorization: `Bearer ${process.env.bearer_token}`
    }
  }).then(r => r.data)
}

async function findRooms() {
  return axios.request({
    method: 'get',
    url: 'http://localhost:3000/api/rooms',
    headers: {
      Authorization: `Bearer ${process.env.bearer_token}`
    }
  }).then(r => r.data)
}


async function createBooking({ room_id, start_time, end_time }) {
  return axios.request({
    method: 'post',
    url: 'http://localhost:3000/api/booking/create',
    data: {
      room_id,
      start_time,
      end_time
    },
    headers: {
      Authorization: `Bearer ${process.env.bearer_token}`
    }
  }).then(r => r.data)
}

const toolDefinitions = [
  {
    name: 'findRooms',
    description: '查询系统中所有会议室的基础信息，包括会议室 id、名称、容量、位置、设备和状态。',
    kind: 'read',
    schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: findRooms,
    requiresConfirmation: false
  },
  {

    name: 'findRoomBookings',
    description: '查询已有会议室预订记录，用于判断指定时间段哪些会议室已经被占用。',
    kind: 'read',
    schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: findRoomBookings,
    requiresConfirmation: false
  },
  {
    name: 'checkHealth',
    description: '调用工具前必须检查服务器健康状况，如果没返回200，停止继续',
    kind: 'read',
    schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: checkHealth,
    requiresConfirmation: false
  },
  {

    name: 'createBooking',
    description: '创建会议室预订。调用前应先确认目标会议室在指定时间段可用。',
    kind: 'write',
    schema: {
      type: 'object',
      properties: {
        room_id: {
          type: 'number',
          description: '要预订的会议室 id。',
        },
        start_time: {
          type: 'number',
          description: '预订开始时间，完整日期时间戳',
        },
        end_time: {
          type: 'string',
          description: '预定结束时间，完整日期时间戳,',
        },
      },
      required: ['room_id', 'start_time', 'end_time'],
      additionalProperties: false,
    },
    handler: createBooking,
    requiresConfirmation: true

  },
];


const LLMTools = toolDefinitions.map(tool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.schema
  }
}))


const toolHandlers = toolDefinitions.reduce((acc, tool) => {
  acc[tool.name] = tool.handler;
  return acc;
}, {})

async function runToolFromCall(toolCall) {
  const handler = toolHandlers[toolCall.function.name];
  if (!handler) {
    return { error: `未知工具: ${toolCall.function.name}` };
  }
  const args = JSON.parse(toolCall.function.arguments);
  return handler(args);
}

async function LLMReasoning(client, context) {
  return client.chat.completions.create({
    model: MODEL,
    messages: context.messages,
    tools: context.tools
  });
}


function buildContext(initMessages = [], initTools = []) {
  const initContext = {
    messages: initMessages,
    tools: initTools
  }

  return {
    addContext: (message = {}, tool = {}) => {
      if (Object.keys(message).length) {
        initContext.messages.push(message);
      }

      if (Object.keys(tool).length) {
        initContext.tools.push(tool);
      }

      return initContext;
    },

    getContext() {
      return initContext;
    }
  }

}


function emitAgentEvent(type, payload = {}) {
  console.log(
    JSON.stringify({
      type,
      at: new Date().toISOString(),
      ...payload
    })
  )
}


function isFinalAnswer(message) {
  return !message.tool_calls?.length;
}

async function executeToolCalls(toolCalls, contextBuilder) {
  for (const toolCall of toolCalls) {

    emitAgentEvent('tool:start', { id: toolCall.id, name: toolCall.function.name, arg:  toolCall.function.arguments })
    const toolResult = await runToolFromCall(toolCall);
    emitAgentEvent('tool:end', { id: toolCall.id, name: toolCall.function.name })


    // 把每次任务计划跑的结果塞回 context, 再一次 LLM 调用
    contextBuilder.addContext({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(toolResult),
    })
  }
}

function createLoopGuard({ maxReasoningTurns, maxToolCalls, maxDurationMs }) {
  const state = {
    reasoningTurns: 0,
    toolCalls: 0,
    startAt: Date.now()
  }

  return {
    assert() {
      if (state.reasoningTurns >= maxReasoningTurns) {
        throw new Error(`超过了最大推理轮数: ${maxReasoningTurns}`)
      }

      if (state.toolCalls >= maxToolCalls) {
        throw new Error(`超过了最大工具调用次数: ${maxToolCalls}`)
      }

      if (Date.now() - state.startAt >= maxDurationMs) {
        throw new Error(`超过最大执行时间: ${maxDurationMs}ms`)
      }
    },

    recordReasoningTurns() {
      state.reasoningTurns++;
    },

    recordToolCalls(count) {
      state.toolCalls += count;
    },

    getState() {
      return state;
    }
  }
}


const loopGuard = createLoopGuard({
  maxReasoningTurns: 4,
  maxToolCalls: 30,
  maxDurationMs: 60_1000
})

async function runToolUseFlow(client, contextBuilder) {

  while (true) {

    loopGuard.assert();
    emitAgentEvent('reasoning:start', { round: loopGuard.getState().reasoningTurns })

    // 构建 context
    const context = contextBuilder.getContext();
    // 等待推理
    const response = await LLMReasoning(client, context);
    // 执行推理的下一步计划
    const nextPlan = response.choices[0]?.message;

    emitAgentEvent('reasoning:end', { round: loopGuard.getState().reasoningTurns, content: nextPlan.content, role: nextPlan.role })

    if (!nextPlan) {
      throw new Error('LLM 没有返回');
    }

    if (isFinalAnswer(nextPlan)) {
      return {
        text: nextPlan.content ?? ''
      };

    }



    // 构建下一轮 context
    contextBuilder.addContext(nextPlan);

    await executeToolCalls(nextPlan.tool_calls, contextBuilder);

    loopGuard.recordReasoningTurns();
    loopGuard.recordToolCalls(nextPlan.tool_calls.length);
  }


}


async function main() {
  assertAIKey();
  const client = createClient();

  const DEFAULT_INPUT = '我在的时区是东八区，定后天下午两点半到四点半会议室，有空会议室就预定';


  const contextBuilder = buildContext([{ role: 'user', content: DEFAULT_INPUT }], LLMTools);


  const { text } = await runToolUseFlow(client, contextBuilder);



  console.log('\n[FINAL]');
  console.log(text);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
