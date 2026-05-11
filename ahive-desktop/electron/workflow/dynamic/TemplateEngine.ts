/**
 * 增强版模板引擎
 * 
 * 支持动态节点的模板变量替换
 */

import type { TemplateContext, PlannerModule } from './types';

/**
 * 模板引擎
 */
export class TemplateEngine {
  /**
   * 渲染模板字符串
   * @param template 模板字符串
   * @param context 上下文数据
   * @returns 渲染后的字符串
   */
  render(template: string, context: TemplateContext): string {
    if (!template || typeof template !== 'string') {
      return template;
    }
    
    // 1. 解析模板中的变量
    const variables = this.parseVariables(template);
    
    // 2. 替换变量
    let result = template;
    for (const variable of variables) {
      const value = this.resolveVariable(variable, context);
      const replacement = value !== undefined && value !== null 
        ? String(value) 
        : '';
      result = result.replace(new RegExp(`\\{\\{${this.escapeRegex(variable)}\\}\\}`, 'g'), replacement);
    }
    
    return result;
  }
  
  /**
   * 渲染对象（递归处理所有字符串值）
   * @param obj 对象
   * @param context 上下文数据
   * @returns 渲染后的对象
   */
  renderObject<T>(obj: T, context: TemplateContext): T {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj === 'string') {
      return this.render(obj, context) as unknown as T;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.renderObject(item, context)) as unknown as T;
    }
    
    if (typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.renderObject(value, context);
      }
      return result as T;
    }
    
    return obj;
  }
  
  /**
   * 解析模板中的变量
   * @param template 模板字符串
   * @returns 变量名列表
   */
  private parseVariables(template: string): string[] {
    const regex = /\{\{([^}]+)\}\}/g;
    const variables: string[] = [];
    let match;
    
    while ((match = regex.exec(template)) !== null) {
      const variable = match[1].trim();
      if (!variables.includes(variable)) {
        variables.push(variable);
      }
    }
    
    return variables;
  }
  
  /**
   * 解析变量路径，获取值
   * @param variable 变量表达式（如 "item.name", "context.assets.code"）
   * @param context 上下文数据
   * @returns 变量值
   */
  private resolveVariable(variable: string, context: TemplateContext): any {
    // 特殊变量处理
    if (variable === 'index') {
      return context.index ?? 0;
    }
    if (variable === 'batch') {
      return context.batch ?? 1;
    }
    
    // 路径解析
    const parts = variable.split('.');
    let value: any = context;
    
    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      
      // 处理数组索引访问 (如 items[0])
      const arrayMatch = part.match(/^([^\[]+)\[(\d+)\]$/);
      if (arrayMatch) {
        const arrayKey = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        value = value[arrayKey];
        if (Array.isArray(value)) {
          value = value[index];
        } else {
          return undefined;
        }
      } else {
        value = value[part];
      }
    }
    
    return value;
  }
  
  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  /**
   * 创建模板上下文
   * @param options 上下文选项
   * @returns 模板上下文
   */
  createContext(options: {
    workflowContext?: Record<string, any>;
    input?: Record<string, any>;
    item?: PlannerModule;
    index?: number;
    batch?: number;
    blackboard?: Map<string, any>;
    prevOutput?: Record<string, any>;
    nodeOutputs?: Map<string, Record<string, any>>;
  }): TemplateContext {
    const context: TemplateContext = {
      context: options.workflowContext || {},
      input: options.input || {},
      item: options.item,
      index: options.index,
      batch: options.batch,
    };
    
    // 添加黑板变量
    if (options.blackboard) {
      for (const [key, value] of options.blackboard) {
        context[key] = value;
      }
    }
    
    // 添加上游输出
    if (options.prevOutput) {
      context['prev-output'] = options.prevOutput;
    }
    
    // 添加特定节点输出
    if (options.nodeOutputs) {
      for (const [nodeId, output] of options.nodeOutputs) {
        context[`${nodeId}:output`] = output;
      }
    }
    
    return context;
  }
  
  /**
   * 验证模板是否包含未解析的变量
   * @param rendered 渲染后的字符串
   * @returns 是否包含未解析变量
   */
  hasUnresolvedVariables(rendered: string): boolean {
    const regex = /\{\{[^}]+\}\}/;
    return regex.test(rendered);
  }
  
  /**
   * 提取模板中的所有变量名
   * @param template 模板字符串
   * @returns 变量名列表
   */
  extractVariables(template: string): string[] {
    return this.parseVariables(template);
  }
}
