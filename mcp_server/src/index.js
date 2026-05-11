
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import axios from 'axios';
import { to } from 'await-to-js';
import dotenv from 'dotenv';
import OpenAI from 'openai';


dotenv.config();

if (process.env.HTTPS_PROXY) {
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}

const MODEL = process.env.AI_MODEL;
const DEFAULT_INPUT = '我在的时区是东八区，定明天下午两点半到四点半会议室，有空会议室就预定';

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


async function createBooking(room_id, start_time, end_time) {
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


const toolHanders = toolDefinitions.reduce((acc, tool) => {
  acc[tool.name] = tool.handler;
  return acc;
}, {})

async function runToolFromCall(toolCall) {
  const handler = toolHanders[toolCall.function.name];
  if (!handler) {
    return { error: `未知工具: ${toolCall.function.name}` };
  }
  const args = JSON.parse(toolCall.function.arguments);
  return handler(args);
}

async function modelResponse(client, messages) {
  return client.chat.completions.create({
    model: MODEL,
    messages,
    tools: LLMTools,
  });
}

async function runToolUseFlow(client, userInput) {
  const messages = [
    { role: 'user', content: userInput },
  ];

  let usedTool = false;
  const maxRounds = 5;

  for (let round = 0; round < maxRounds; round++) {
    const [e, response] = await to(modelResponse(client, messages))
    if (e) throw e;

    const assistantMessage = response.choices[0]?.message;

    if (!assistantMessage) {
      return { usedTool, text: '' };
    }

    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { usedTool, text: assistantMessage.content ?? '' };
    }

    usedTool = true;

    for (const toolCall of toolCalls) {
      console.log('[LLM TOOL CALL]', toolCall.function.name, toolCall.function.arguments);

      const toolResult = await runToolFromCall(toolCall);
      if (toolResult) {
        console.log('[LLM TOOL CALL]', toolCall.function.name, 'get result success');
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  throw new Error(`工具调用超过最大轮数: ${maxRounds}`);
}


async function main() {
  assertAIKey();
  const client = createClient();

  const { usedTool, text } = await runToolUseFlow(client, DEFAULT_INPUT);

  if (!usedTool) {
    console.log(text);
    return;
  }

  console.log('\n[FINAL]');
  console.log(text);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
