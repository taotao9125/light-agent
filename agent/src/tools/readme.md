## 我想要的


```typescript
for await (const toolCall of tools) {
  const result = await toolCallFactory.get(toolCall.name).excute(toolCall.arguments);
}
```

## 模型 tool 输入
```typescript
type tools = {
  name: string;
  description: string;
  parameters: Record<string, any>
}[];
```
## 模型 tool 输出
```typescript
type toolCalls = {
  name: string;
  arguments: Record<string, any>
}[]

```

# 命令行模式（统一收口执行） + 工厂模式（统一注册查找）
## 自定义 tool 接口命令
```typescript
// T: tool input. U: tool output
export interface ToolDefinition<T, U> extends ToolMeta {
	excute(p: T): U;
}
```

## 注册 tool 
```typescript

const read_file: ToolDefinition<{path: string}, Promise<string>> = {
  name: 'xxx',
  excute(p) {
    return fs.readFile(p.path)
  }
}

ToolFactory.register(name, Tool);

// agent 查找 tool
const toolCalls = {
  name: 'readFile',
  arguments: {
    path: 'package.json'
  }
}[];

ToolFactory.get(toolCalls[0].name).excute(modelToolCall[0].arguments);
```