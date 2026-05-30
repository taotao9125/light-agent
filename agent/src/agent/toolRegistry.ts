
import type { ToolDefinition, ToolMeta } from './types';

class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any>>();

  register(name: string, tool: ToolDefinition<any, any>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  listDefinitions() {
    return [...this.tools.values()];
  }


  getTools() {
    return [...this.tools.values()];
  }

  getToolShapes(): ToolMeta[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));
  }
}

export default new ToolRegistry();

