/**
 * AHIVECORE 工具调用解析器
 * 
 * 功能：
 * - 从模型回复中提取工具调用
 * - 执行工具并返回结果
 * - 组装最终回复
 */

import type { ToolDefinition } from './types.js';
import { getToolRegistry } from './registry.js';

// ============ 类型定义 ============

/**
 * 工具调用
 */
export interface ToolCall {
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, any>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string | object;
  /** 错误信息 */
  error?: string;
}

/**
 * 解析结果
 */
export interface ParseResult {
  /** 纯文本部分 */
  text: string;
  /** 提取的工具调用列表 */
  toolCalls: ToolCall[];
}

// ============ 解析函数 ============

/**
 * 查找匹配的闭合大括号
 * 正确处理嵌套JSON对象和字符串转义
 */
function findMatchingBrace(str: string, start: number): number {
  if (str[start] !== '{') return -1;
  
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = start; i < str.length; i++) {
    const char = str[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  
  return -1;
}

/**
 * 从模型回复中提取工具调用
 * 支持多种格式：
 * - [TOOL]{...}[/TOOL] 格式
 * - ```tool\n{...}\n``` 格式
 * - shell: command 格式 (简单命令格式)
 * - exec: command 格式
 * 
 * @param response 模型的回复内容
 * @returns 解析结果，包含纯文本和工具调用列表
 */
export function extractToolCalls(response: string): ParseResult {
  const toolCalls: ToolCall[] = [];
  let processedResponse = response;
  
  // ============ 格式 1: [TOOL]{...}[/TOOL] ============
  const startMarker = '[TOOL]';
  const endMarker = '[/TOOL]';
  
  let searchPos = 0;
  let textParts: string[] = [];
  let lastEnd = 0;
  
  while (true) {
    const startPos = processedResponse.indexOf(startMarker, searchPos);
    if (startPos === -1) break;
    
    const jsonStart = startPos + startMarker.length;
    const jsonEnd = findMatchingBrace(processedResponse, jsonStart);
    
    if (jsonEnd !== -1) {
      const jsonStr = processedResponse.slice(jsonStart, jsonEnd + 1).trim();
      if (jsonStr && jsonStr !== '{}') {
        try {
          const parsed = JSON.parse(jsonStr);
          
          // 验证必要字段
          if (parsed.name && typeof parsed.name === 'string') {
            toolCalls.push({
              name: parsed.name,
              arguments: parsed.arguments || {},
            });
            
            // 收集工具调用之前的文本
            textParts.push(processedResponse.slice(lastEnd, startPos));
            
            // 更新最后结束位置
            const endPos = processedResponse.indexOf(endMarker, jsonEnd);
            lastEnd = endPos !== -1 ? endPos + endMarker.length : jsonEnd + 1;
            searchPos = lastEnd;
            continue;
          }
        } catch (e) {
          // 解析失败，跳过这个匹配
          console.warn(`[ToolParser] 工具调用解析失败: ${jsonStr.substring(0, 100)}`);
        }
      }
    }
    
    // 未找到有效JSON，继续搜索
    const endPos = processedResponse.indexOf(endMarker, jsonStart);
    searchPos = endPos !== -1 ? endPos + endMarker.length : jsonStart + 1;
  }
  
  // 添加剩余文本
  textParts.push(processedResponse.slice(lastEnd));
  let remainingText = textParts.join('').trim();
  
  // ============ 格式 2: ```tool\n{...}\n``` ============
  const codeBlockPattern = /```tool\s*\n([\s\S]*?)```/gi;
  remainingText = remainingText.replace(codeBlockPattern, (match, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr.trim());
      if (parsed.name && typeof parsed.name === 'string') {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments || parsed.params || {},
        });
      }
      return ''; // 移除工具调用标记
    } catch (e) {
      console.warn(`[ToolParser] 代码块工具调用解析失败: ${jsonStr.substring(0, 100)}`);
      return match;
    }
  });
  
  // ============ 格式 3: shell: command 或 exec: command ============
  // 支持 "shell: dir F:\codex_space" 这样的简单格式
  const shellPattern = /^(shell|exec):\s*(.+?)(?:\n|$)/gm;
  remainingText = remainingText.replace(shellPattern, (match, toolName, command) => {
    const cmd = command.trim();
    if (cmd) {
      toolCalls.push({
        name: 'exec',
        arguments: { command: cmd },
      });
    }
    return ''; // 移除命令标记
  });
  
  // ============ 格式 4: 单行命令格式 !command ============
  const bangPattern = /^!\s*(.+?)(?:\n|$)/gm;
  remainingText = remainingText.replace(bangPattern, (match, command) => {
    const cmd = command.trim();
    if (cmd) {
      toolCalls.push({
        name: 'exec',
        arguments: { command: cmd },
      });
    }
    return '';
  });
  
  return { text: remainingText.trim(), toolCalls };
}

/**
 * 执行工具调用
 * 
 * @param toolCalls 工具调用列表
 * @param registry 工具注册中心（可选，默认使用全局实例）
 * @returns 执行结果列表
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  registry?: ReturnType<typeof getToolRegistry>
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const toolRegistry = registry || getToolRegistry();
  
  for (const call of toolCalls) {
    try {
      // 执行工具
      const result = await toolRegistry.execute(call.name, call.arguments);
      
      // 格式化输出
      const output = typeof result === 'string' 
        ? result 
        : JSON.stringify(result, null, 2);
      
      results.push({
        success: true,
        output,
      });
    } catch (e) {
      // 执行失败
      const errorMsg = e instanceof Error ? e.message : String(e);
      results.push({
        success: false,
        output: '',
        error: errorMsg,
      });
    }
  }
  
  return results;
}

/**
 * 组装最终回复
 * 
 * @param text 纯文本部分
 * @param toolCalls 工具调用列表
 * @param results 执行结果列表
 * @returns 最终回复字符串
 */
export function assembleResponse(
  text: string,
  toolCalls: ToolCall[],
  results: ToolResult[]
): string {
  if (toolCalls.length === 0) {
    return text;
  }
  
  let response = text;
  
  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    const result = results[i];
    
    // 状态图标
    const icon = result.success ? '✅' : '❌';
    
    // 格式化输出
    const output = typeof result.output === 'string' 
      ? result.output 
      : JSON.stringify(result.output, null, 2);
    
    // 如果有错误，显示错误信息
    if (!result.success && result.error) {
      response += `\n\n[${icon} 执行 ${call.name}]\n错误: ${result.error}`;
    } else {
      response += `\n\n[${icon} 执行 ${call.name}]\n${output}`;
    }
  }
  
  return response;
}

// ============ 完整处理函数 ============

/**
 * 处理模型回复（包含工具调用检测和执行）
 * 
 * @param response 模型回复
 * @param onProgress 进度回调（可选）
 * @returns 处理后的最终回复
 */
export async function processToolCalls(
  response: string,
  onProgress?: (info: { toolName: string; status: 'start' | 'success' | 'error'; message?: string }) => void
): Promise<string> {
  // 1. 提取工具调用
  const { text, toolCalls } = extractToolCalls(response);
  
  // 没有工具调用，直接返回
  if (toolCalls.length === 0) {
    return text;
  }
  
  // 2. 执行工具调用
  const results: ToolResult[] = [];
  const registry = getToolRegistry();
  
  for (const call of toolCalls) {
    // 通知开始
    onProgress?.({ toolName: call.name, status: 'start' });
    
    try {
      const result = await registry.execute(call.name, call.arguments);
      
      const output = typeof result === 'string' 
        ? result 
        : JSON.stringify(result, null, 2);
      
      results.push({ success: true, output });
      onProgress?.({ toolName: call.name, status: 'success' });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      results.push({ success: false, output: '', error: errorMsg });
      onProgress?.({ toolName: call.name, status: 'error', message: errorMsg });
    }
  }
  
  // 3. 组装最终回复
  return assembleResponse(text, toolCalls, results);
}

// ============ 工具调用格式化 ============

/**
 * 格式化工具调用为标记格式
 * 
 * @param name 工具名称
 * @param args 工具参数
 * @returns 格式化后的字符串
 */
export function formatToolCall(name: string, args: Record<string, any>): string {
  return `[TOOL]${JSON.stringify({ name, arguments: args })}[/TOOL]`;
}