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
   */
  private getValueByPath(obj: unknown, path: string): unknown {
    if (!obj || !path) {
      return undefined;
    }

    const keys = path.split(/[.\[\]]+/).filter(Boolean);
    let current: unknown = obj;

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
   */
  private processConditionals(template: string, variables: Record<string, unknown>): string {
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
          const context: Record<string, unknown> = {
            ...variables,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === array.length - 1,
          };
          
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
   * 提取模板中使用的变量名
   */
  extractVariables(template: string): string[] {
    const variables = new Set<string>();
    
    const simplePattern = /\{\{([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[\d+\])*)\}\}/g;
    let match;
    
    while ((match = simplePattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    
    const ifPattern = /\{\{#if\s+([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[\d+\])*)\}\}/g;
    while ((match = ifPattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    
    const eachPattern = /\{\{#each\s+([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[\d+\])*)\}\}/g;
    while ((match = eachPattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    
    return Array.from(variables);
  }
}