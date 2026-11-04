import type { Risk, ToolDef } from '../shared/types'

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef<any, any>>()

  register(tool: ToolDef<any, any>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`)
    }
    this.tools.set(tool.name, tool)
    return this
  }

  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  get(name: string): ToolDef<any, any> | undefined {
    return this.tools.get(name)
  }

  riskOf(name: string): Risk | undefined {
    return this.tools.get(name)?.risk
  }

  list(): ToolDef<any, any>[] {
    return [...this.tools.values()]
  }
}
