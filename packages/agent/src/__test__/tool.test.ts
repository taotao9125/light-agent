import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import ToolRegistry from '../tool.ts';

import type { ToolDefinition } from '../tool.ts';

describe('工具注册表', () => {
	it('应注册 z.object 工具定义，并在对外 schema 中加入 _intent', () => {
		const registry = new ToolRegistry(() => ({ cwd: '/tmp/workspace' }));
		const schema = z.object({
			city: z.string().describe('城市名称'),
		});

		registry.register({
			name: 'weather',
			description: '获取天气',
			schema,
			execute: async ({ city }) => ({ isError: false, content: city }),
		});

		const tool = registry.get('weather');

		expect(tool?.name).toBe('weather');
		expect(tool?.description).toBe('获取天气');
		expect(tool?.schema).not.toBe(schema);
		expect(tool?.schema.shape.city).toBe(schema.shape.city);
		expect(tool?.schema.shape._intent).toBeInstanceOf(z.ZodString);

		expect(registry.getTools()).toMatchObject([
			{
				name: 'weather',
				description: '获取天气',
				schema: {
					type: 'object',
					required: ['city', '_intent'],
					properties: {
						city: {
							type: 'string',
							description: '城市名称',
						},
						_intent: {
							type: 'string',
						},
					},
				},
			},
		]);
	});

	it('应从 z.object schema 推导 execute 的业务参数类型', async () => {
		const execute = vi.fn(async ({ city }: { city: string }) => ({
			isError: false,
			content: `城市：${city}`,
		}));
		const tool: ToolDefinition<
			z.ZodObject<{
				city: z.ZodString;
			}>
		> = {
			name: 'weather',
			description: '获取天气',
			schema: z.object({
				city: z.string(),
			}),
			execute,
		};
		const registry = new ToolRegistry(() => ({ cwd: '/tmp/workspace' }));

		registry.register(tool);

		const result = await registry.get('weather')?.execute({ city: '上海', _intent: '查询天气' });

		expect(result).toEqual({ isError: false, content: '城市：上海' });
		expect(execute).toHaveBeenCalledWith({ city: '上海' }, { cwd: '/tmp/workspace' });
	});

	it('应校验 name 和 description', () => {
		const registry = new ToolRegistry(() => ({ cwd: '/tmp/workspace' }));
		const baseTool = {
			name: 'weather',
			description: '获取天气',
			schema: z.object({
				city: z.string(),
			}),
			execute: async () => ({ isError: false, content: '' }),
		};

		expect(() => registry.register({ ...baseTool, name: ' ' })).toThrow('工具 name 不能为空');
		expect(() => registry.register({ ...baseTool, description: ' ' })).toThrow(
			'工具 description 不能为空: weather',
		);
	});

	it('应拒绝非 z.object schema', () => {
		const registry = new ToolRegistry(() => ({ cwd: '/tmp/workspace' }));

		expect(() =>
			registry.register({
				name: 'bad',
				description: '错误工具',
				schema: z.string() as never,
				execute: async () => ({ isError: false, content: '' }),
			}),
		).toThrow('工具 schema 必须是 z.object(): bad');
	});

	it('应拒绝重复注册同名工具', () => {
		const registry = new ToolRegistry(() => ({ cwd: '/tmp/workspace' }));
		const tool = {
			name: 'weather',
			description: '获取天气',
			schema: z.object({
				city: z.string(),
			}),
			execute: async () => ({ isError: false, content: '' }),
		};

		registry.register(tool);

		expect(() => registry.register(tool)).toThrow('工具已存在: weather');
	});

	it('应按名称移除工具', () => {
		const registry = new ToolRegistry(() => ({ cwd: '/tmp/workspace' }));

		registry.register({
			name: 'weather',
			description: '获取天气',
			schema: z.object({
				city: z.string(),
			}),
			execute: async () => ({ isError: false, content: '' }),
		});

		expect(registry.remove('weather')).toBe(true);
		expect(registry.get('weather')).toBeUndefined();
		expect(registry.remove('weather')).toBe(false);
	});
});
