import Agent, * as agentExports from '@light-agent/agent';
import * as builtinToolExports from '@light-agent/agent/builtin-tools';
import {
	builtinToolPrompts,
	createGrepTool,
	createReadFileTool,
	createTreeTool,
} from '@light-agent/agent/builtin-tools';
import ToolRegistry, { ToolRegistry as NamedToolRegistry } from '@light-agent/agent/tool';
import { describe, expect, it } from 'vitest';

import type { Tool } from '@light-agent/agent/tool';

describe('package exports', () => {
	it('根出口应只暴露 runtime 主 API', () => {
		expect(Agent).toBeTypeOf('function');
		expect('Agent' in agentExports).toBe(false);
		expect('createGrepTool' in agentExports).toBe(false);
		expect('createReadFileTool' in agentExports).toBe(false);
	});

	it('tool 子出口应暴露通用工具注册能力', () => {
		expect(ToolRegistry).toBe(NamedToolRegistry);

		const toolName: Tool.Definition['name'] = 'demo';
		expect(toolName).toBe('demo');
	});

	it('builtin-tools 子出口应暴露内置工具与提示词', () => {
		expect(createGrepTool().name).toBe('grep');
		expect(createReadFileTool().name).toBe('read_file');
		expect(createTreeTool().name).toBe('tree');
		expect(builtinToolPrompts.content).toContain('tree');
		expect('createRecallTool' in builtinToolExports).toBe(false);
	});
});
