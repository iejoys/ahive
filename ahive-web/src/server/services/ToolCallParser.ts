/**
 * 工具调用解析器
 * 从 Agent 输出中解析 MCP/A2A 调用请求
 * 
 * 文档: MCP_A2A_INTEGRATION_DESIGN.md
 * 创建日期: 2026-03-05
 */

import type { ToolCall } from '@/shared';

/**
 * 工具调用解析器
 * 从 Agent 输出中解析 MCP/A2A 调用请求
 */
export class ToolCallParser {
  
  // 匹配 <CALL_TOOL: server="xxx", tool="xxx", params={...}>
  private callToolRegex = /<CALL_TOOL:\s*server="([^"]+)",\s*tool="([^"]+)",\s*params=(\{[^}]+\})>/g;
  
  // 匹配简化格式 <CALL_TOOL: tool="xxx", params={...}>
  private callToolSimpleRegex = /<CALL_TOOL:\s*tool="([^"]+)",\s*params=(\{[^}]+\})>/g;
  
  /**
   * 解析 Agent 输出中的工具调用
   */
  parseToolCalls(output: string): ToolCall[] {
    const calls: ToolCall[] = [];
    
    // 重置正则索引
    this.callToolRegex.lastIndex = 0;
    this.callToolSimpleRegex.lastIndex = 0;
    
    // 解析完整格式
    let match;
    while ((match = this.callToolRegex.exec(output)) !== null) {
      try {
        calls.push({
          server: match[1],
          tool: match[2],
          params: JSON.parse(match[3])
        });
      } catch {
        // 忽略 JSON 解析错误
        console.warn('[ToolCallParser] Failed to parse params:', match[3]);
      }
    }
    
    // 解析简化格式 (使用默认服务器)
    while ((match = this.callToolSimpleRegex.exec(output)) !== null) {
      try {
        calls.push({
          server: 'default',
          tool: match[1],
          params: JSON.parse(match[2])
        });
      } catch {
        console.warn('[ToolCallParser] Failed to parse params:', match[2]);
      }
    }
    
    return calls;
  }
  
  /**
   * 清理 Agent 输出，移除工具调用标签
   */
  cleanOutput(output: string): string {
    return output
      .replace(this.callToolRegex, '')
      .replace(this.callToolSimpleRegex, '')
      .replace(/\n\s*\n\s*\n/g, '\n\n')  // 移除多余空行
      .trim();
  }
  
  /**
   * 检查输出是否包含工具调用
   */
  hasToolCalls(output: string): boolean {
    this.callToolRegex.lastIndex = 0;
    this.callToolSimpleRegex.lastIndex = 0;
    return this.callToolRegex.test(output) || this.callToolSimpleRegex.test(output);
  }
  
  /**
   * 提取第一个工具调用
   */
  extractFirstToolCall(output: string): ToolCall | null {
    const calls = this.parseToolCalls(output);
    return calls.length > 0 ? calls[0] : null;
  }
  
  /**
   * 替换工具调用标签为结果
   */
  replaceToolCallWithResult(output: string, toolCall: ToolCall, result: unknown): string {
    const toolCallStr = `<CALL_TOOL: server="${toolCall.server}", tool="${toolCall.tool}", params=${JSON.stringify(toolCall.params)}>`;
    const resultStr = `[Tool Result: ${JSON.stringify(result)}]`;
    
    return output.replace(toolCallStr, resultStr);
  }
}

// 单例导出
export const toolCallParser = new ToolCallParser();