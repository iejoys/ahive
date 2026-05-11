/**
 * RPC 路由
 * 处理 /rpc 相关请求 - 远程过程调用
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { AgentExecutor } from '../executor/interface.js';
import { parseBody, sendJson, sendError, getQueryParam } from './utils.js';
import { logger } from '../utils/index.js';

/**
 * RPC 方法映射
 */
interface RPCMethod {
  name: string;
  handler: (params: any, context: RPCContext) => Promise<any>;
  description: string;
}

interface RPCContext {
  executor: AgentExecutor;
  app?: any;
  sessionId?: string;
}

/**
 * RPC 路由处理器
 */
export class RPCRouteHandler {
  private methods: Map<string, RPCMethod> = new Map();
  
  constructor(private executor: AgentExecutor, private app?: any) {
    this.registerDefaultMethods();
  }
  
  /**
   * 注册默认 RPC 方法
   */
  private registerDefaultMethods(): void {
    // 执行命令
    this.registerMethod({
      name: 'exec',
      description: 'Execute a shell command',
      handler: async (params, context) => {
        const { command, workdir, timeout } = params;
        if (!command) {
          throw new Error('command is required');
        }
        
        // RPC 方法需要通过 app.toolLoopExecutor 或其他方式执行
        // 这里返回模拟结果，实际实现需要调用工具系统
        return {
          success: true,
          message: 'RPC exec method - requires tool system integration',
          params: { command, workdir, timeout }
        };
      }
    });
    
    // 读取文件
    this.registerMethod({
      name: 'read_file',
      description: 'Read file contents',
      handler: async (params, context) => {
        const { path, encoding, offset, limit } = params;
        if (!path) {
          throw new Error('path is required');
        }
        
        return {
          success: true,
          message: 'RPC read_file method - requires tool system integration',
          params: { path, encoding, offset, limit }
        };
      }
    });
    
    // 写入文件
    this.registerMethod({
      name: 'write_file',
      description: 'Write file contents',
      handler: async (params, context) => {
        const { path, content, encoding, mkdir } = params;
        if (!path || content === undefined) {
          throw new Error('path and content are required');
        }
        
        return {
          success: true,
          message: 'RPC write_file method - requires tool system integration',
          params: { path, content, encoding, mkdir }
        };
      }
    });
    
    // 列出目录
    this.registerMethod({
      name: 'list_dir',
      description: 'List directory contents',
      handler: async (params, context) => {
        const { path, recursive } = params;
        if (!path) {
          throw new Error('path is required');
        }
        
        return {
          success: true,
          message: 'RPC list_dir method - requires tool system integration',
          params: { path, recursive }
        };
      }
    });
    
    // 删除文件/目录
    this.registerMethod({
      name: 'delete',
      description: 'Delete file or directory',
      handler: async (params, context) => {
        const { path, recursive } = params;
        if (!path) {
          throw new Error('path is required');
        }
        
        return {
          success: true,
          message: 'RPC delete method - requires tool system integration',
          params: { path, recursive }
        };
      }
    });
    
    // 创建目录
    this.registerMethod({
      name: 'mkdir',
      description: 'Create directory',
      handler: async (params, context) => {
        const { path } = params;
        if (!path) {
          throw new Error('path is required');
        }
        
        return {
          success: true,
          message: 'RPC mkdir method - requires tool system integration',
          params: { path }
        };
      }
    });
    
    // 搜索文件
    this.registerMethod({
      name: 'Grep',
      description: 'Search files for pattern using ripgrep',
      handler: async (params, context) => {
        const { pattern, path, output_mode, glob, head_limit } = params;
        const ignoreCase = params['-i'];
        if (!pattern) {
          throw new Error('pattern is required');
        }

        return {
          success: true,
          message: 'RPC Grep method - requires tool system integration',
          params: { pattern, path, output_mode, glob, '-i': ignoreCase, head_limit }
        };
      }
    });
    
    // 获取系统信息
    this.registerMethod({
      name: 'get_system_info',
      description: 'Get system information',
      handler: async (params, context) => {
        return {
          success: true,
          message: 'RPC get_system_info method - requires tool system integration',
          params: {}
        };
      }
    });
    
    // 获取时间
    this.registerMethod({
      name: 'get_time',
      description: 'Get current time',
      handler: async (params, context) => {
        return {
          success: true,
          message: 'RPC get_time method - requires tool system integration',
          params: {}
        };
      }
    });
    
    // Web 请求
    this.registerMethod({
      name: 'web_fetch',
      description: 'Fetch web page content',
      handler: async (params, context) => {
        const { url, extract_mode, max_chars } = params;
        if (!url) {
          throw new Error('url is required');
        }
        
        return {
          success: true,
          message: 'RPC web_fetch method - requires tool system integration',
          params: { url, extract_mode, max_chars }
        };
      }
    });
    
    // 查看图片
    this.registerMethod({
      name: 'view_image',
      description: 'View image file',
      handler: async (params, context) => {
        const { path } = params;
        if (!path) {
          throw new Error('path is required');
        }
        
        return {
          success: true,
          message: 'RPC view_image method - requires tool system integration',
          params: { path }
        };
      }
    });
    
    // 编辑文件
    this.registerMethod({
      name: 'edit_file',
      description: 'Edit file contents',
      handler: async (params, context) => {
        const { path, oldContent, newContent } = params;
        if (!path || oldContent === undefined || newContent === undefined) {
          throw new Error('path, oldContent, and newContent are required');
        }
        
        return {
          success: true,
          message: 'RPC edit_file method - requires tool system integration',
          params: { path, oldContent, newContent }
        };
      }
    });
    
    // 应用补丁
    this.registerMethod({
      name: 'apply_patch',
      description: 'Apply patch to file',
      handler: async (params, context) => {
        const { path, patch, expected_rejects } = params;
        if (!path || !patch) {
          throw new Error('path and patch are required');
        }
        
        return {
          success: true,
          message: 'RPC apply_patch method - requires tool system integration',
          params: { path, patch, expected_rejects }
        };
      }
    });
  }
  
  /**
   * 注册 RPC 方法
   */
  registerMethod(method: RPCMethod): void {
    this.methods.set(method.name, method);
    logger.info(`[RPC] 注册方法: ${method.name}`);
  }
  
  /**
   * 注销 RPC 方法
   */
  unregisterMethod(name: string): boolean {
    return this.methods.delete(name);
  }
  
  /**
   * 获取所有方法
   */
  listMethods(): Array<{ name: string; description: string }> {
    return Array.from(this.methods.values()).map(m => ({
      name: m.name,
      description: m.description
    }));
  }
  
  /**
   * 处理 RPC 请求
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method || 'POST';
    
    // GET /rpc - 列出所有方法
    if (method === 'GET') {
      sendJson(res, 200, {
        success: true,
        methods: this.listMethods()
      });
      return;
    }
    
    // POST /rpc - 执行方法
    if (method === 'POST') {
      try {
        const body = await parseBody(req);
        
        if (!body.method) {
          sendError(res, 400, 'method is required');
          return;
        }
        
        const rpcMethod = this.methods.get(body.method);
        if (!rpcMethod) {
          sendError(res, 404, `Method not found: ${body.method}`);
          return;
        }
        
        const context: RPCContext = {
          executor: this.executor,
          app: this.app,
          sessionId: body.sessionId
        };
        
        const result = await rpcMethod.handler(body.params || {}, context);
        
        sendJson(res, 200, {
          success: true,
          result
        });
      } catch (error) {
        logger.error('[RPC] 请求处理失败:', error);
        sendError(res, 500, error instanceof Error ? error.message : 'Internal error');
      }
      return;
    }
    
    sendError(res, 405, 'Method not allowed');
  }
}

/**
 * RPC 路由函数
 */
export async function rpcRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: AgentExecutor,
  app?: any
): Promise<boolean> {
  const url = req.url || '';
  
  if (url.startsWith('/rpc')) {
    const handler = new RPCRouteHandler(executor, app);
    await handler.handleRequest(req, res);
    return true;
  }
  
  return false;
}

/**
 * 创建 RPC 路由处理器
 */
export function createRPCHandler(executor: AgentExecutor, app?: any): RPCRouteHandler {
  return new RPCRouteHandler(executor, app);
}