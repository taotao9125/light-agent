import { z } from 'zod';

const INTENT_FIELD_DESCRIPTION =
	'简要说明你为什么调用这个工具，以及你期望从结果中获得什么具体信息。该字段会用于为工具结果建立历史索引；相关时请写明具体文件、符号、错误、问题或决策。';

export type ToolSchema = z.ZodObject<z.ZodRawShape>;
export type ToolContext = {
	cwd: string;
	signal?: AbortSignal;
};

export type PullToolContext = () => ToolContext;

export type ToolResult = {
	isError: boolean;
	content: string;
};

/**
 * 工具定义。
 *
 * 默认情况下，`execute` 的 args 类型由 schema 自动推导；例如
 * `z.object({ city: z.string() })` 会让 execute 接收 `{ city: string }`。
 *
 * 第二个泛型用于注册表内部改写执行入参：对外 schema 会额外包含 `_intent`，
 * 但实际业务 execute 仍只接收原始 schema 对应的参数。
 */
export type ToolDefinition<T extends ToolSchema = ToolSchema> = {
	name: string;
	description: string;
	schema: T;
	/** 执行业务逻辑；args 不包含注册表自动注入的 `_intent`。 */
	execute(args: z.infer<T>, context?: ToolContext): Promise<ToolResult>;
};

export namespace Tool {
	export type Schema = ToolSchema;
	export type Context = ToolContext;
	export type PullContext = PullToolContext;
	export type Result = ToolResult;
	export type Definition<T extends ToolSchema = ToolSchema> = ToolDefinition<T>;
}

function isAvailableString(value: unknown) {
	return typeof value === 'string' && !!value.trim();
}

export default class ToolRegistry {
	private tools = new Map<string, ToolDefinition>();

	constructor(private pullToolContext: PullToolContext) {}

	register<T extends ToolSchema>(tool: ToolDefinition<T>): void {
		if (!isAvailableString(tool.name)) throw new Error('工具 name 不能为空');
		if (!isAvailableString(tool.description)) throw new Error(`工具 description 不能为空: ${tool.name}`);
		if (!(tool.schema instanceof z.ZodObject)) throw new Error(`工具 schema 必须是 z.object(): ${tool.name}`);
		if (this.tools.has(tool.name)) throw new Error(`工具已存在: ${tool.name}`);

		const pullToolContext = this.pullToolContext;
		this.tools.set(tool.name, {
			name: tool.name,
			description: tool.description,
			schema: tool.schema.extend({
				_intent: z.string().describe(INTENT_FIELD_DESCRIPTION),
			}),
			async execute(args) {
				const { _intent, ...toolArgs } = args;
				const parsed = tool.schema.safeParse(toolArgs);
				if (!parsed.success) {
					const issues = parsed.error.issues.map((issue) => {
						const path = issue.path.length ? issue.path.join('.') : '<root>';
						return `- ${path}: ${issue.message}`;
					});

					return {
						isError: true,
						content: [
							'[what]: 你传递的工具参数没有通过 schema 校验',
							`[tool]: ${tool.name}`,
							'[issues]:',
							...issues,
							'[how]: 请根据上面的字段路径和错误原因，重新选择工具或重新组织参数后再调用。',
						].join('\n'),
					};
				}
				return await tool.execute(parsed.data, pullToolContext());
			},
		});
	}

	remove(name: string): boolean {
		return this.tools.delete(name);
	}

	get(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	getTools(): Array<
		Omit<ToolDefinition, 'schema' | 'execute'> & { schema: { type: 'object' } & Record<string, unknown> }
	> {
		return [...this.tools.values()].map((tool) => ({
			name: tool.name,
			description: tool.description,
			schema: z.toJSONSchema(tool.schema) as { type: 'object' } & Record<string, unknown>,
		}));
	}
}
