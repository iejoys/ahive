/**
 * 输出解析器
 * 从 Agent 回复中提取结构化数据
 */

import type { OutputMapping } from './types';

/**
 * 解析结果
 */
export interface ParsedOutput {
  variables: Record<string, unknown>;
  success: boolean;
  errors: Array<{ mapping: string; error: string }>;
}

/**
 * 输出解析器类
 * 
 * 支持的解析策略：
 * 1. JSON 直接解析
 * 2. Markdown 代码块提取
 * 3. 正则表达式提取
 * 4. JSONPath 路径提取
 */
export class OutputParser {
  private readonly MAX_OUTPUT_LENGTH = 100000;
  private readonly MAX_REGEX_BODY_LENGTH = 500;
  private readonly MAX_REGEX_FLAGS_LENGTH = 10;

  /**
   * 解析输出
   */
  parse(output: string, mappings: OutputMapping[]): ParsedOutput {
    const variables: Record<string, unknown> = {};
    const errors: Array<{ mapping: string; error: string }> = [];

    if (!output || !mappings || mappings.length === 0) {
      return { variables, success: true, errors };
    }

    const safeOutput = output.length > this.MAX_OUTPUT_LENGTH 
      ? output.slice(0, this.MAX_OUTPUT_LENGTH) 
      : output;

    const jsonData = this.tryParseJSON(safeOutput);

    for (const mapping of mappings) {
      try {
        let value: unknown;

        if (jsonData !== null) {
          value = this.extractByPath(jsonData, mapping.extractPath);
        } else {
          value = this.extractFromText(safeOutput, mapping);
        }

        if (value !== undefined) {
          variables[mapping.name] = value;
        } else if (mapping.required) {
          errors.push({
            mapping: mapping.name,
            error: `Required variable not found: ${mapping.extractPath}`,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          mapping: mapping.name,
          error: errorMessage,
        });
      }
    }

    return {
      variables,
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * 尝试解析 JSON
   */
  private tryParseJSON(text: string): unknown | null {
    // 1. 尝试直接解析
    try {
      return JSON.parse(text);
    } catch {
      // 继续
    }

    // 2. 尝试提取 JSON 代码块
    const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1]);
      } catch {
        // 继续
      }
    }

    // 3. 尝试提取任意代码块
    const codeBlockMatch = text.match(/```\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1]);
      } catch {
        // 继续
      }
    }

    // 4. 尝试找到 JSON 对象
    const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      try {
        return JSON.parse(jsonObjectMatch[0]);
      } catch {
        // 继续
      }
    }

    // 5. 尝试找到 JSON 数组
    const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
    if (jsonArrayMatch) {
      try {
        return JSON.parse(jsonArrayMatch[0]);
      } catch {
        // 继续
      }
    }

    return null;
  }

  /**
   * 通过路径提取值
   */
  private extractByPath(data: unknown, path: string): unknown {
    if (!data || !path) {
      return undefined;
    }

    let cleanPath = path.replace(/^\$\.?/, '');
    
    if (!cleanPath) {
      return data;
    }

    const keys = cleanPath.split(/[.\[\]]+/).filter(Boolean);
    let current: unknown = data;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (/^\d+$/.test(key)) {
        const index = parseInt(key, 10);
        if (Array.isArray(current)) {
          current = current[index];
        } else {
          return undefined;
        }
      } else {
        if (typeof current === 'object' && current !== null && key in current) {
          current = (current as Record<string, unknown>)[key];
        } else {
          return undefined;
        }
      }
    }

    return current;
  }

  /**
   * 从文本中提取值
   */
  private extractFromText(text: string, mapping: OutputMapping): unknown {
    const path = mapping.extractPath;

    // 正则表达式提取
    if (path.startsWith('regex:')) {
      return this.extractByRegex(text, path.slice(6));
    }

    // 行匹配
    if (path.startsWith('line:')) {
      const lineNum = parseInt(path.slice(5), 10);
      return this.extractLine(text, lineNum);
    }

    // 关键词提取
    if (path.startsWith('keyword:')) {
      return this.extractByKeyword(text, path.slice(8));
    }

    // 全文作为字符串
    if (path === '$' || path === '') {
      return text.trim();
    }

    return text.trim();
  }

  /**
   * 正则表达式提取
   */
  private extractByRegex(text: string, pattern: string): string | string[] | undefined {
    try {
      if (pattern.length > this.MAX_REGEX_BODY_LENGTH) {
        console.warn('[OutputParser] Regex pattern too long, truncated');
        pattern = pattern.slice(0, this.MAX_REGEX_BODY_LENGTH);
      }
      
      const match = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
      
      if (match) {
        const [, regexBody, flags] = match;
        const safeFlags = flags.slice(0, this.MAX_REGEX_FLAGS_LENGTH);
        
        if (this.isDangerousRegex(regexBody)) {
          console.warn('[OutputParser] Dangerous regex pattern blocked:', regexBody.slice(0, 50));
          return undefined;
        }
        
        const regex = new RegExp(regexBody, safeFlags);
        
        if (flags.includes('g')) {
          const results = [...text.matchAll(regex)];
          if (results.length > 0) {
            return results.map(r => r[1] ?? r[0]);
          }
        } else {
          const result = text.match(regex);
          if (result) {
            return result[1] ?? result[0];
          }
        }
      } else {
        if (this.isDangerousRegex(pattern)) {
          console.warn('[OutputParser] Dangerous regex pattern blocked');
          return undefined;
        }
        const regex = new RegExp(pattern);
        const result = text.match(regex);
        if (result) {
          return result[1] ?? result[0];
        }
      }
    } catch (error) {
      console.error('[OutputParser] Invalid regex:', pattern, error);
    }

    return undefined;
  }
  
  /**
   * 检测危险的正则模式
   */
  private isDangerousRegex(pattern: string): boolean {
    const nestedQuantifiers = /\([^)]*[+*?][^)]*\)[+*?]/;
    const overlappingQuantifiers = /[+*?][+*?]/;
    const backtracking = /\.(?:\*|\+).*\.(?:\*|\+)/;
    
    return nestedQuantifiers.test(pattern) || 
           overlappingQuantifiers.test(pattern) ||
           backtracking.test(pattern);
  }

  /**
   * 提取指定行
   */
  private extractLine(text: string, lineNum: number): string | undefined {
    const lines = text.split('\n');
    const index = lineNum > 0 ? lineNum - 1 : 0;
    return lines[index]?.trim();
  }

  /**
   * 关键词提取
   */
  private extractByKeyword(text: string, keyword: string): string | undefined {
    const pattern = new RegExp(`${keyword}[:\\s]+([^\\n]+)`, 'i');
    const match = text.match(pattern);
    return match ? match[1].trim() : undefined;
  }

  /**
   * 智能提取
   */
  smartExtract(output: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const jsonData = this.tryParseJSON(output);
    if (jsonData && typeof jsonData === 'object') {
      if (!Array.isArray(jsonData)) {
        Object.assign(result, jsonData);
      } else if (jsonData.length > 0) {
        result.items = jsonData;
      }
    }

    const codeBlocks = this.extractCodeBlocks(output);
    if (codeBlocks.length > 0) {
      result.codeBlocks = codeBlocks;
    }

    const links = this.extractLinks(output);
    if (links.length > 0) {
      result.links = links;
    }

    const filePaths = this.extractFilePaths(output);
    if (filePaths.length > 0) {
      result.filePaths = filePaths;
    }

    return result;
  }

  /**
   * 提取代码块
   */
  private extractCodeBlocks(output: string): Array<{ language: string; code: string }> {
    const blocks: Array<{ language: string; code: string }> = [];
    const pattern = /```(\w*)\s*\n([\s\S]*?)\n```/g;
    
    let match;
    while ((match = pattern.exec(output)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2],
      });
    }
    
    return blocks;
  }

  /**
   * 提取链接
   */
  private extractLinks(output: string): string[] {
    const pattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    return output.match(pattern) || [];
  }

  /**
   * 提取文件路径
   */
  private extractFilePaths(output: string): string[] {
    const patterns = [
      /(?:^|\s)(\/[\w./-]+)(?:\s|$)/gm,
      /(?:^|\s)([A-Za-z]:\\[\w./\\-]+)(?:\s|$)/gm,
      /(?:^|\s)(\.{1,2}\/[\w./-]+)(?:\s|$)/gm,
    ];
    
    const paths: string[] = [];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        paths.push(match[1]);
      }
    }
    
    return [...new Set(paths)];
  }
}