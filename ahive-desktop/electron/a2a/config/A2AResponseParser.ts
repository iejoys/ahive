/**
 * A2A 协议响应解析器
 * 
 * 根据协议配置解析 HTTP 响应
 */

import log from 'electron-log';
import type { 
  A2AProtocolConfig, 
  ParsedResponse,
  ResponseParserConfig 
} from './A2AProtocolConfig';

export class A2AResponseParser {
  /**
   * 解析同步消息响应
   */
  parseMessageResponse(
    protocol: A2AProtocolConfig,
    response: any
  ): ParsedResponse {
    const config = protocol.sendMessage.response;
    
    return {
      messageId: this.extractValue(response, config.paths.messageId),
      status: this.extractStatus(response, config),
      text: this.extractText(response, config),
      error: this.extractValue(response, config.paths.error),
      raw: response,
      usage: this.extractUsage(response, config)
    };
  }

  /**
   * 提取文本内容
   */
  private extractText(response: any, config: ResponseParserConfig): string {
    const textPath = config.paths.text;
    if (!textPath) {
      return '';
    }

    const value = this.extractValue(response, textPath);
    
    if (value === undefined || value === null) {
      return '';
    }

    // 处理数组
    if (Array.isArray(value)) {
      switch (config.textExtraction) {
        case 'single':
          return value[0] || '';
        case 'concat':
          return value.join(config.arraySeparator || '\n');
        case 'array':
        default:
          return value.join('\n');
      }
    }

    return String(value);
  }

  /**
   * 提取状态
   */
  private extractStatus(response: any, config: ResponseParserConfig): ParsedResponse['status'] {
    const statusPath = config.paths.status;
    if (!statusPath) {
      return 'completed';
    }

    const rawStatus = this.extractValue(response, statusPath);
    
    if (!rawStatus) {
      return 'completed';
    }

    // 映射状态值
    if (config.statusMapping) {
      const mapped = config.statusMapping[String(rawStatus)];
      if (mapped) {
        return mapped;
      }
    }

    // 直接返回（如果已是有效状态）
    const validStatuses = ['pending', 'working', 'completed', 'failed', 'canceled'];
    if (validStatuses.includes(String(rawStatus))) {
      return rawStatus as ParsedResponse['status'];
    }

    return 'completed';
  }

  /**
   * 提取使用量
   */
  private extractUsage(response: any, config: ResponseParserConfig): ParsedResponse['usage'] | undefined {
    const usagePath = config.paths.usage;
    if (!usagePath) {
      return undefined;
    }

    const usage = this.extractValue(response, usagePath);
    if (!usage || typeof usage !== 'object') {
      return undefined;
    }

    return {
      inputTokens: usage.input_tokens ?? usage.inputTokens,
      outputTokens: usage.output_tokens ?? usage.outputTokens,
      totalTokens: usage.total_tokens ?? usage.totalTokens
    };
  }

  /**
   * 根据 JSONPath 提取值
   */
  private extractValue(obj: any, path: string | undefined): any {
    if (!path || !obj) {
      return undefined;
    }

    // 简化的 JSONPath 实现
    // 支持: "a.b.c", "a[0].b", "a[?(@.type=='text')].text"
    
    try {
      // 处理过滤器表达式
      if (path.includes('[?(@.')) {
        return this.extractWithFilter(obj, path);
      }

      // 标准路径解析
      const parts = path.split(/[.\[\]]+/).filter(Boolean);
      let current = obj;

      for (const part of parts) {
        if (current === null || current === undefined) {
          return undefined;
        }
        
        if (/^\d+$/.test(part)) {
          current = current[parseInt(part, 10)];
        } else {
          current = current[part];
        }
      }

      return current;
    } catch (error) {
      log.warn(`[A2AResponseParser] Failed to extract path ${path}:`, error);
      return undefined;
    }
  }

  /**
   * 处理带过滤器的 JSONPath
   */
  private extractWithFilter(obj: any, path: string): any {
    // 解析: "parts[?(@.type=='text')].text"
    const match = path.match(/^(\w+)\[\?\(@\.(\w+)==['"](\w+)['"]\)\]\.(\w+)$/);
    
    if (!match) {
      return undefined;
    }

    const [, arrayName, fieldName, fieldValue, resultField] = match;
    const array = obj[arrayName];
    
    if (!Array.isArray(array)) {
      return undefined;
    }

    // 查找匹配项
    const matched = array.filter(item => item[fieldName] === fieldValue);
    
    // 提取结果字段
    return matched.map(item => item[resultField]);
  }

  /**
   * 解析 SSE 事件数据
   */
  parseSSEEvent(
    protocol: A2AProtocolConfig,
    eventType: string,
    data: any
  ): { type: string; text?: string; done?: boolean; error?: string } {
    const events = protocol.sse?.events;
    if (!events) {
      return { type: 'unknown' };
    }

    // 连接成功
    if (eventType === events.connected) {
      return { type: 'connected' };
    }

    // 心跳
    if (eventType === events.heartbeat) {
      return { type: 'heartbeat' };
    }

    // 文本增量
    if (events.textDelta && eventType === events.textDelta.eventType) {
      const text = this.extractValue(data, events.textDelta.textField);
      return { type: 'text_delta', text: String(text || '') };
    }

    // 文本完成
    if (events.textDone && eventType === events.textDone.eventType) {
      const text = this.extractValue(data, events.textDone.textField);
      return { type: 'text_done', text: String(text || '') };
    }

    // 消息完成
    if (events.messageComplete && eventType === events.messageComplete.eventType) {
      return { type: 'complete', done: true };
    }

    // 错误
    if (events.error && eventType === events.error.eventType) {
      const error = this.extractValue(data, events.error.dataPath);
      return { type: 'error', error: String(error || 'Unknown error') };
    }

    return { type: 'unknown' };
  }
}

// 导出单例
export const responseParser = new A2AResponseParser();