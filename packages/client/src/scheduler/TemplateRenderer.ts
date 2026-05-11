/**
 * 模板渲染器
 * 支持变量插值、条件渲染、循环渲染
 */

/**
 * 模板渲染器类
 * 
 * 支持的语法：
 * - 变量插值: {{variableName}}
 * - 路径访问: {{user.name}}, {{items[0]}}
 * - 条件渲染: {{#if condition}}...{{/if}}
 * - 循环渲染: {{#each items}}...{{/each}}
 */
export class TemplateRenderer {
  private readonly MAX_DEPTH = 10;
  private readonly MAX_TEMPLATE_LENGTH = 100000;

  /**
   * 渲染模板
   * @param template 模板字符串
   * @param variables 变量对象
   * @returns 渲染后的字符串
   */
  render(template: string, variables: Record<string, unknown>): string {
    // 安全检查
    if (template.length > this.MAX_TEMPLATE_LENGTH) {
      console.warn('[TemplateRenderer] Template too long, truncating');
      template = template.slice(0, this.MAX_TEMPLATE_LENGTH);
    }

    let result = template;
    let depth = 0;

    // 循环处理，直到没有更多替换
    while (depth < this.MAX_DEPTH) {
      const previous = result;
      
      // 1. 处理条件渲染
      result = this.processConditionals(result, variables);
      
      // 2. 处理循环渲染
      result = this.processLoops(result, variables);
      
      // 3. 处理变量插值
      result = this.processVariables(result, variables);
      
      // 如果没有变化，退出循环
      if (result === previous) {
        break;
      }
      
      depth++;
    }

    return result;
  }

  /**
   * 处理变量插值
   */
  private processVariables(template: string, variables: Record<string, unknown>): string {
    // 匹配 {{variableName}} 或 {{path.to.value}}
    return template.replace(
      /\{\{([^}]+)\}\}/g,
      (_, path: string) => {
        const trimmedPath = path.trim();
        const value = this.getValueByPath(variables, trimmedPath);
        return this.stringifyValue(value);
      }
    );
  }

  /**
   * 通过路径获取值
   * 支持: user.name, items[0], data.nested.value
   */
  private getValueByPath(obj: unknown, path: string): unknown {
    if (!obj || !path) {
      return undefined;
    }

    // 分割路径 (处理 . 和 [] 两种形式)
    const keys = path.split(/[.\[\]]+/).filter(Boolean);
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // 数组索引
      if (/^\d+$/.test(key)) {
        const index = parseInt(key, 10);
        if (Array.isArray(current)) {
          current = current[index];
        } else {
          return undefined;
        }
      } else {
        // 对象属性
        if (typeof current === 'object' && key in current) {
          current = (current as Record<string, unknown>)[key];
        } else {
          return undefined;
        }
      }
    }

    return current;
  }

  /**
   * 将值转换为字符串
   */
  private stringifyValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    
    if (typeof value === 'string') {
      return value;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    
    if (Array.isArray(value)) {
      return value.map(v => this.stringifyValue(v)).join(', ');
    }
    
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return '[Object]';
      }
    }
    
    return String(value);
  }

  /**
   * 处理条件渲染
   * {{#if condition}}content{{/if}}
   * {{#if condition}}content{{else}}alternative{{/if}}
   */
  private processConditionals(template: string, variables: Record<string, unknown>): string {
    // 匹配 {{#if condition}}...{{/if}} 或 {{#if condition}}...{{else}}...{{/if}}
    const ifPattern = /\{\{#if\s+(\S+?)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
    
    return template.replace(
      ifPattern,
      (_, conditionPath: string, trueContent: string, falseContent: string = '') => {
        const conditionValue = this.getValueByPath(variables, conditionPath.trim());
        
        if (this.isTruthy(conditionValue)) {
          return trueContent;
        } else {
          return falseContent;
        }
      }
    );
  }

  /**
   * 处理循环渲染
   * {{#each items}}内容 {{this.name}} {{/each}}
   * {{#each items}}内容 {{@index}} {{this}} {{/each}}
   */
  private processLoops(template: string, variables: Record<string, unknown>): string {
    const eachPattern = /\{\{#each\s+(\S+?)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    
    return template.replace(
      eachPattern,
      (_, arrayPath: string, itemTemplate: string) => {
        const array = this.getValueByPath(variables, arrayPath.trim());
        
        if (!Array.isArray(array)) {
          return '';
        }
        
        return array.map((item, index) => {
          // 创建迭代上下文
          const context: Record<string, unknown> = {
            ...variables,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === array.length - 1,
          };
          
          // 处理 item 内部的变量
          return this.processVariables(itemTemplate, context);
        }).join('');
      }
    );
  }

  /**
   * 判断值是否为真
   */
  private isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    
    if (typeof value === 'boolean') {
      return value;
    }
    
    if (typeof value === 'number') {
      return value !== 0;
    }
    
    if (typeof value === 'string') {
      return value.length > 0 && value.toLowerCase() !== 'false';
    }
    
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    
    if (typeof value === 'object') {
      return Object.keys(value).length > 0;
    }
    
    return Boolean(value);
  }

  /**
   * 验证模板语法
   */
  validate(template: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // 检查未闭合的条件块
    const ifOpenCount = (template.match(/\{\{#if\b/g) || []).length;
    const ifCloseCount = (template.match(/\{\{\/if\}\}/g) || []).length;
    if (ifOpenCount !== ifCloseCount) {
      errors.push(`Unclosed if blocks: ${ifOpenCount} opened, ${ifCloseCount} closed`);
    }
    
    // 检查未闭合的循环块
    const eachOpenCount = (template.match(/\{\{#each\b/g) || []).length;
    const eachCloseCount = (template.match(/\{\{\/each\}\}/g) || []).length;
    if (eachOpenCount !== eachCloseCount) {
      errors.push(`Unclosed each blocks: ${eachOpenCount} opened, ${eachCloseCount} closed`);
    }
    
    // 检查变量语法
    const variableMatches = template.match(/\{\{[^}]*[^}\s][^}]*\}\}/g) || [];
    for (const match of variableMatches) {
      // 跳过控制结构
      if (match.startsWith('{{#') || match.startsWith('{{/')) {
        continue;
      }
      
      // 检查变量名是否有效
      const varName = match.slice(2, -2).trim();
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$.\[\]]*$/.test(varName)) {
        errors.push(`Invalid variable name: ${match}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 提取模板中使用的变量名
   */
  extractVariables(template: string): string[] {
    const variables = new Set<string>();
    
    // 匹配简单变量
    const simplePattern = /\{\{([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[\d+\])*)\}\}/g;
    let match;
    
    while ((match = simplePattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    
    // 匹配条件中的变量
    const ifPattern = /\{\{#if\s+([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[\d+\])*)\}\}/g;
    while ((match = ifPattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    
    // 匹配循环中的数组
    const eachPattern = /\{\{#each\s+([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[\d+\])*)\}\}/g;
    while ((match = eachPattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    
    return Array.from(variables);
  }
}

// 单例导出
export const templateRenderer = new TemplateRenderer();