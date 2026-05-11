/**
 * AHIVECORE 执行器 - 工具注册中心
 */

import { z } from 'zod';
import { ShellExecutor, createShellExecutor } from './shell-executor.js';
import { FileSystemExecutor, createFileSystemExecutor } from './fs-executor.js';
import { ProcessManager, getProcessManager } from './process-manager.js';
import { HttpExecutor, createHttpExecutor } from './http-executor.js';
import type { SecurityPolicy, ToolDefinition } from './types.js';
import { DEFAULT_SECURITY_POLICY } from './types.js';
import { webFetchTool } from './web-fetch.js';

// ============ 工具定义 ============

export const EXEC_TOOL: ToolDefinition = {
  name: 'exec',
  description: 'Execute a shell command.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    workdir: z.string().optional().describe('Working directory'),
    timeout: z.number().optional().describe('Timeout in milliseconds'),
  }),
  execute: async (params, signal) => {
    const executor = createShellExecutor();
    return executor.execute(params, signal);
  },
};

export const READ_FILE_TOOL: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file.',
  parameters: z.object({
    path: z.string().describe('The path to the file'),
  }),
  execute: async (params, signal) => {
    const executor = createFileSystemExecutor();
    return executor.readFile(params.path, 'utf-8', signal);
  },
};

export const WRITE_FILE_TOOL: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file.',
  parameters: z.object({
    path: z.string().describe('The path to the file'),
    content: z.string().describe('The content to write'),
  }),
  execute: async (params, signal) => {
    const executor = createFileSystemExecutor();
    return executor.writeFile(params.path, params.content, { mkdir: true }, signal);
  },
};

export const LIST_DIR_TOOL: ToolDefinition = {
  name: 'list_dir',
  description: 'List the contents of a directory.',
  parameters: z.object({
    path: z.string().describe('The path to the directory'),
    recursive: z.boolean().optional().describe('Whether to list recursively'),
  }),
  execute: async (params, signal) => {
    const executor = createFileSystemExecutor();
    return executor.listDir(params.path, params.recursive ?? false, signal);
  },
};

export const DELETE_FILE_TOOL: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file or directory.',
  parameters: z.object({
    path: z.string().describe('The path to delete'),
    recursive: z.boolean().optional().describe('Whether to delete recursively'),
  }),
  execute: async (params, signal) => {
    const executor = createFileSystemExecutor();
    return executor.delete(params.path, params.recursive ?? false, signal);
  },
};

export const HTTP_TOOL: ToolDefinition = {
  name: 'http_request',
  description: 'Make an HTTP request.',
  parameters: z.object({
    url: z.string().describe('The URL to request'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    body: z.string().optional().describe('Request body'),
  }),
  execute: async (params) => {
    const executor = createHttpExecutor();
    return executor.request(params.url, {
      method: params.method,
      body: params.body,
    });
  },
};

export const PROCESS_TOOL: ToolDefinition = {
  name: 'process',
  description: 'Manage background processes.',
  parameters: z.object({
    action: z.enum(['start', 'stop', 'poll', 'list']),
    sessionId: z.string().optional(),
    command: z.string().optional(),
  }),
  execute: async (params) => {
    const manager = getProcessManager();
    switch (params.action) {
      case 'start':
        return manager.start(params.command || '');
      case 'stop':
        return manager.stop(params.sessionId || '');
      case 'poll':
        return manager.poll(params.sessionId || '');
      case 'list':
        const list = await manager.list();
        return { success: true, output: JSON.stringify(list, null, 2) };
      default:
        return { success: false, output: `Unknown action: ${params.action}` };
    }
  },
};

export const GET_TIME_TOOL: ToolDefinition = {
  name: 'get_time',
  description: 'Get the current date and time.',
  parameters: z.object({}),
  execute: async () => {
    const now = new Date();
    return {
      success: true,
      output: {
        iso: now.toISOString(),
        local: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        timestamp: now.getTime(),
      },
    };
  },
};

// ============ 工具注册中心 ============

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private shellExecutor: ShellExecutor;
  private fsExecutor: FileSystemExecutor;
  private httpExecutor: HttpExecutor;
  private processManager: ProcessManager;

  constructor(policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) {
    this.shellExecutor = createShellExecutor(policy);
    this.fsExecutor = createFileSystemExecutor(process.cwd(), policy);
    this.httpExecutor = createHttpExecutor(policy);
    this.processManager = getProcessManager(policy);

    this.register(EXEC_TOOL);
    this.register(READ_FILE_TOOL);
    this.register(WRITE_FILE_TOOL);
    this.register(LIST_DIR_TOOL);
    this.register(DELETE_FILE_TOOL);
    this.register(HTTP_TOOL);
    this.register(PROCESS_TOOL);
    this.register(GET_TIME_TOOL);
    this.register(webFetchTool);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  async execute(name: string, params: any, signal?: AbortSignal): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(params, signal);
  }

  getFunctionDefinitions(): Array<{ name: string; description: string; parameters: any }> {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: this.zodToJsonSchema(tool.parameters),
    }));
  }

  private zodToJsonSchema(schema: z.ZodType): any {
    if (schema instanceof z.ZodObject) {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(schema.shape)) {
        properties[key] = this.zodToJsonSchema(value as z.ZodType);
        if (!(value instanceof z.ZodOptional)) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      };
    }

    if (schema instanceof z.ZodString) return { type: 'string' };
    if (schema instanceof z.ZodNumber) return { type: 'number' };
    if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
    if (schema instanceof z.ZodArray) return { type: 'array', items: this.zodToJsonSchema(schema.element) };
    if (schema instanceof z.ZodOptional) return this.zodToJsonSchema(schema.unwrap());
    if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };

    return {};
  }
}

let globalRegistry: ToolRegistry | null = null;

export function getToolRegistry(policy?: SecurityPolicy): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry(policy);
  }
  return globalRegistry;
}

export const BUILTIN_TOOLS = [
  EXEC_TOOL,
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  LIST_DIR_TOOL,
  DELETE_FILE_TOOL,
  HTTP_TOOL,
  PROCESS_TOOL,
  GET_TIME_TOOL,
  webFetchTool,
];