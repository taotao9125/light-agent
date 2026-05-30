import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../../agent/types';

const readFileTool: ToolDefinition<
  { path: string },
  Promise<{
    content: string;
    isError: boolean;
  }>
> = {
  name: 'read_file',
  description: 'Read the full contents of a specific file when the user asks to inspect, open, or read a file.',
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The user-specified file path to read, resolved relative to the agent working directory.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },

  async execute(p, context) {
    const realPath = path.resolve(context.cwd, p.path);
    try {
      return {
        content: await fs.readFile(realPath, { encoding: 'utf8', signal: context.signal }),
        isError: false,
      };
    } catch (e) {
      // 用户取消往上抛
      if (context.signal?.aborted) {
        throw e;
      }
      return {
        content: e instanceof Error ? e.message : String(e),
        isError: true,
      };
    }
  },
};

export default readFileTool;