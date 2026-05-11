/**
 * A2A 协议请求生成器
 * 
 * 根据协议配置动态生成 HTTP 请求
 */

import log from 'electron-log';
import type { 
  A2AProtocolConfig, 
  RequestContext, 
  ParsedRequest,
  EndpointConfig,
  RequestTemplateConfig 
} from './A2AProtocolConfig';

export class A2ARequestBuilder {
  /**
   * 构建发送消息的请求
   */
  buildSendMessageRequest(
    protocol: A2AProtocolConfig,
    endpoint: string,
    context: RequestContext
  ): ParsedRequest {
    const config = protocol.sendMessage;
    
    // 解析路径中的变量
    const resolvedPath = this.resolveVariables(config.path, context);
    
    // 构建完整 URL
    const url = `${endpoint}${resolvedPath}`;
    
    // 构建请求头
    const headers = this.buildHeaders(protocol, config, context);
    
    // 构建请求体
    const body = this.buildRequestBody(config.request, context);
    
    return {
      url,
      method: config.method,
      headers,
      body,
      timeout: config.timeout || protocol.defaultTimeout
    };
  }

  /**
   * 构建 SSE 请求
   */
  buildSSERequest(
    protocol: A2AProtocolConfig,
    endpoint: string,
    context: RequestContext
  ): ParsedRequest {
    if (!protocol.sse) {
      throw new Error('SSE not configured for this protocol');
    }

    const config = protocol.sse.endpoint;
    const resolvedPath = this.resolveVariables(config.path, context);
    const url = `${endpoint}${resolvedPath}`;
    const headers = this.buildHeaders(protocol, config, context);
    
    // SSE 特定头
    headers['Accept'] = 'text/event-stream';
    headers['Cache-Control'] = 'no-cache';

    return {
      url,
      method: config.method,
      headers,
      body: config.method === 'POST' ? this.buildRequestBody(protocol.sendMessage.request, context) : undefined,
      timeout: config.timeout
    };
  }

  /**
   * 构建创建 Session 的请求
   */
  buildCreateSessionRequest(
    protocol: A2AProtocolConfig,
    endpoint: string,
    context: RequestContext
  ): ParsedRequest | null {
    if (!protocol.session?.create) {
      return null;
    }

    const config = protocol.session.create;
    const resolvedPath = this.resolveVariables(config.path, context);
    const url = `${endpoint}${resolvedPath}`;
    const headers = this.buildHeaders(protocol, config, context);

    return {
      url,
      method: config.method,
      headers,
      body: { directory: context.custom?.directory || process.cwd() },
      timeout: config.timeout
    };
  }

  /**
   * 构建请求头
   */
  private buildHeaders(
    protocol: A2AProtocolConfig,
    endpointConfig: EndpointConfig,
    context: RequestContext
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...endpointConfig.headers
    };

    // 添加认证头
    const authHeader = this.buildAuthHeader(protocol, context);
    if (authHeader) {
      headers[authHeader.name] = authHeader.value;
    }

    // 解析 headers 中的变量
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        headers[key] = this.resolveVariables(value, context);
      }
    }

    return headers;
  }

  /**
   * 构建认证头
   */
  private buildAuthHeader(
    protocol: A2AProtocolConfig,
    context: RequestContext
  ): { name: string; value: string } | null {
    const auth = protocol.auth;
    
    if (auth.type === 'none') {
      return null;
    }

    const headerName = auth.header || 'Authorization';
    const apiKey = context.apiKey || '';

    switch (auth.type) {
      case 'bearer':
        return {
          name: headerName,
          value: `${auth.prefix || 'Bearer '}${apiKey}`
        };
      
      case 'basic':
        // apiKey 格式: username:password
        const encoded = Buffer.from(apiKey).toString('base64');
        return {
          name: headerName,
          value: `Basic ${encoded}`
        };
      
      case 'api-key':
        if (auth.location === 'header') {
          return {
            name: headerName,
            value: apiKey
          };
        }
        return null;
      
      default:
        return null;
    }
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(
    templateConfig: RequestTemplateConfig,
    context: RequestContext
  ): any {
    // 深拷贝模板
    const body = JSON.parse(JSON.stringify(templateConfig.template));
    
    // 递归替换变量
    return this.replaceVariables(body, context);
  }

  /**
   * 递归替换对象中的变量
   */
  private replaceVariables(obj: any, context: RequestContext): any {
    if (typeof obj === 'string') {
      return this.resolveVariables(obj, context);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.replaceVariables(item, context));
    }
    
    if (obj !== null && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceVariables(value, context);
      }
      return result;
    }
    
    return obj;
  }

  /**
   * 解析字符串中的变量
   * 支持 ${variableName} 格式
   */
  private resolveVariables(str: string, context: RequestContext): string {
    if (typeof str !== 'string') {
      return str;
    }

    return str.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const value = this.getVariableValue(varName, context);
      return value !== undefined ? String(value) : `\${${varName}}`;
    });
  }

  /**
   * 获取变量值
   * 
   * 支持从 context.message (JSON字符串) 中解析字段
   * 例如: message = '{"type":"capability_update","action":"update",...}'
   * 可以提取: type, action, payload 等字段
   */
  private getVariableValue(varName: string, context: RequestContext): any {
    // 基础变量映射
    const varMap: Record<string, any> = {
      message: context.message,
      model: context.model,
      provider: context.provider,
      agentId: context.agentId,
      sessionId: context.sessionId,
      stream: context.stream ?? false,
      userId: context.userId,
      webhookUrl: context.webhookUrl,
      taskId: context.custom?.taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    // 先检查基础变量
    if (varMap[varName] !== undefined) {
      return varMap[varName];
    }

    // 检查 custom 字段
    if (context.custom?.[varName] !== undefined) {
      return context.custom[varName];
    }

    // 尝试从 message (JSON字符串) 中解析字段
    // 支持 capability_update, skill_register 等系统消息
    if (context.message && typeof context.message === 'string') {
      try {
        const parsed = JSON.parse(context.message);
        if (parsed && typeof parsed === 'object' && parsed[varName] !== undefined) {
          return parsed[varName];
        }
      } catch {
        // message 不是 JSON，忽略
      }
    }

    return undefined;
  }
}

// 导出单例
export const requestBuilder = new A2ARequestBuilder();