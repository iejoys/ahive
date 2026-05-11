/**
 * MCP API 通用客户端
 * 
 * 根据平台配置动态构建请求、解析响应
 */

import log from 'electron-log';
import type { 
  MCPApiPlatformConfig, 
  MCPApiConfig, 
  UnifiedMCPApiResponse,
  MCPApiServerConfig 
} from './MCPApiProtocolConfig';

/**
 * MCP API 客户端
 */
export class MCPApiClient {
  private platformConfig: MCPApiPlatformConfig;
  private userConfig: MCPApiConfig;

  constructor(platformConfig: MCPApiPlatformConfig, userConfig: MCPApiConfig) {
    this.platformConfig = platformConfig;
    this.userConfig = userConfig;
  }

  /**
   * 发送请求
   */
  async sendRequest(message: string): Promise<UnifiedMCPApiResponse> {
    const { request: requestConfig } = this.platformConfig;
    
    // 构建请求
    const { url, body, headers } = this.buildRequest(message);
    
    log.info(`[MCPApiClient] Sending request to: ${url}`);
    log.debug('[MCPApiClient] Request body:', JSON.stringify(body, null, 2));

    try {
      const response = await fetch(url, {
        method: requestConfig.method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestConfig.timeout || 300000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error(`[MCPApiClient] Request failed: ${response.status} ${response.statusText}`);
        return {
          id: '',
          status: 'failed',
          outputText: '',
          error: `HTTP ${response.status}: ${errorText}`
        };
      }

      const data = await response.json();
      log.debug('[MCPApiClient] Response:', JSON.stringify(data, null, 2));

      return this.parseResponse(data);
    } catch (error) {
      log.error('[MCPApiClient] Request error:', error);
      return {
        id: '',
        status: 'failed',
        outputText: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 构建请求
   */
  private buildRequest(message: string): { url: string; body: any; headers: Record<string, string> } {
    const { request: requestConfig } = this.platformConfig;
    const { fieldValues, mcpServers } = this.userConfig;

    // 构建变量上下文
    const context: Record<string, any> = {
      ...fieldValues,
      message
    };

    // 构建 MCP Server 配置
    const tools = this.buildMcpTools(mcpServers, context);

    // 替换模板变量
    const body = this.deepReplaceVariables(requestConfig.template, context);
    
    // 如果模板有 tools 字段，用构建的 tools 替换
    if (body.tools !== undefined) {
      body.tools = tools;
    }

    // 替换请求头变量
    const headers = this.deepReplaceVariables(requestConfig.headers || {}, context);

    // 构建完整 URL
    const endpoint = fieldValues.endpoint || '';
    const url = `${endpoint}${requestConfig.path}`;

    return { url, body, headers };
  }

  /**
   * 构建 MCP 工具配置
   */
  private buildMcpTools(
    mcpServers: MCPApiServerConfig[], 
    context: Record<string, any>
  ): any[] {
    const { platformType } = this.platformConfig;

    return mcpServers.map(server => {
      if (platformType === 'bailian' || platformType === 'openai') {
        // OpenAI 兼容格式
        return {
          type: 'mcp',
          server_protocol: 'sse',
          server_label: server.label,
          server_description: server.description || '',
          server_url: server.url,
          headers: this.deepReplaceVariables(server.headers || {}, context),
          require_approval: 'never'
        };
      } else if (platformType === 'anthropic') {
        // Anthropic 格式
        return {
          url: server.url,
          name: server.label
        };
      }
      return {};
    });
  }

  /**
   * 深度替换变量
   */
  private deepReplaceVariables(obj: any, context: Record<string, any>): any {
    if (typeof obj === 'string') {
      return this.replaceVariables(obj, context);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepReplaceVariables(item, context));
    }

    if (obj && typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.deepReplaceVariables(value, context);
      }
      return result;
    }

    return obj;
  }

  /**
   * 替换字符串中的变量
   */
  private replaceVariables(str: string, context: Record<string, any>): string {
    return str.replace(/\$\{(\w+)\}/g, (match, varName) => {
      if (varName in context) {
        const value = context[varName];
        return value !== undefined && value !== null ? String(value) : '';
      }
      return match;
    });
  }

  /**
   * 解析响应
   */
  private parseResponse(data: any): UnifiedMCPApiResponse {
    const { response: responseConfig } = this.platformConfig;
    const { paths } = responseConfig;

    // 提取文本
    const outputText = this.extractByPath(data, paths.text) || '';

    // 提取用量
    const usage = paths.usage ? {
      inputTokens: this.extractByPath(data, paths.inputTokens!) || 0,
      outputTokens: this.extractByPath(data, paths.outputTokens!) || 0,
      totalTokens: this.extractByPath(data, paths.totalTokens!) || 0
    } : undefined;

    // 提取错误
    const error = paths.error ? this.extractByPath(data, responseConfig.error?.messagePath || paths.error) : undefined;

    return {
      id: data.id || '',
      status: error ? 'failed' : 'completed',
      outputText,
      usage,
      error,
      raw: data
    };
  }

  /**
   * 根据 JSONPath 提取值
   */
  private extractByPath(obj: any, path: string): any {
    if (!path) return undefined;

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      // 处理数组索引和过滤器
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      const filterMatch = part.match(/^(\w+)\[\?\(@\.(\w+)==['"](.+)['"]\)\]$/);

      if (arrayMatch) {
        const [, key, index] = arrayMatch;
        current = current[key]?.[parseInt(index)];
      } else if (filterMatch) {
        const [, key, filterKey, filterValue] = filterMatch;
        const arr = current[key];
        if (Array.isArray(arr)) {
          current = arr.find(item => item[filterKey] === filterValue);
        } else {
          return undefined;
        }
      } else {
        current = current[part];
      }
    }

    return current;
  }
}