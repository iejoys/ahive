/**
 * 参数过滤器
 * 防止访问敏感路径和执行危险操作
 * 
 * 文档: MCP_A2A_INTEGRATION_DESIGN.md
 * 创建日期: 2026-03-05
 */

/**
 * 参数过滤器
 */
export class ParameterFilter {
  /** 路径黑名单 */
  private pathBlacklist = [
    '/etc/passwd',
    '/etc/shadow',
    '/etc/hosts',
    '/root/.ssh',
    '/root/.bashrc',
    'C:\\Windows\\System32',
    '~/.ssh',
    '.env',
    'credentials',
    'secrets',
    'private_key',
    'id_rsa',
    'id_ed25519',
    '.pem',
    '.key',
  ];

  /** 危险命令模式 */
  private dangerousPatterns = [
    /rm\s+-rf/i,
    /rm\s+-fr/i,
    /sudo\s+/i,
    /chmod\s+777/i,
    />\s*\/dev\//i,
    /\|\s*sh\b/i,
    /\|\s*bash\b/i,
    /\|\s*zsh\b/i,
    /`[^`]+`/,          // 反引号命令
    /\$\([^)]+\)/,       // 命令替换 $()
    /\$\{[^}]+\}/,       // 变量替换 ${}
    /;\s*rm\b/i,         // 命令链
    /\|\|\s*rm\b/i,
    /&&\s*rm\b/i,
  ];

  /** 敏感字段名 */
  private sensitiveKeys = [
    'password',
    'passwd',
    'token',
    'secret',
    'key',
    'credential',
    'apikey',
    'api_key',
    'private_key',
    'access_token',
    'refresh_token',
    'auth',
    'authorization',
  ];

  /**
   * 检查参数是否安全
   */
  isSafe(params: Record<string, unknown>): { safe: boolean; reason?: string } {
    const str = JSON.stringify(params);
    
    // 检查路径黑名单
    for (const blacklisted of this.pathBlacklist) {
      if (str.toLowerCase().includes(blacklisted.toLowerCase())) {
        return { safe: false, reason: `Access to '${blacklisted}' is forbidden` };
      }
    }
    
    // 检查危险模式
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(str)) {
        return { safe: false, reason: `Dangerous pattern detected: ${pattern.source}` };
      }
    }
    
    return { safe: true };
  }

  /**
   * 过滤参数中的敏感信息
   */
  filter(params: Record<string, unknown>): Record<string, unknown> {
    const filtered = { ...params };
    
    for (const key of Object.keys(filtered)) {
      // 检查键名是否敏感
      for (const sensitive of this.sensitiveKeys) {
        if (key.toLowerCase().includes(sensitive)) {
          filtered[key] = '[REDACTED]';
          break;
        }
      }
      
      // 递归处理嵌套对象
      if (typeof filtered[key] === 'object' && filtered[key] !== null) {
        filtered[key] = this.filter(filtered[key] as Record<string, unknown>);
      }
    }
    
    return filtered;
  }

  /**
   * 验证文件路径
   */
  isPathAllowed(path: string, allowedRoots: string[] = []): boolean {
    // 规范化路径
    const normalizedPath = this.normalizePath(path);
    
    // 检查黑名单
    for (const blacklisted of this.pathBlacklist) {
      if (normalizedPath.toLowerCase().includes(blacklisted.toLowerCase())) {
        return false;
      }
    }
    
    // 如果指定了允许的根目录，检查路径是否在允许范围内
    if (allowedRoots.length > 0) {
      return allowedRoots.some(root => 
        normalizedPath.startsWith(this.normalizePath(root))
      );
    }
    
    return true;
  }

  /**
   * 检查命令是否安全
   */
  isCommandSafe(command: string): { safe: boolean; reason?: string } {
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(command)) {
        return { safe: false, reason: `Dangerous command pattern: ${pattern.source}` };
      }
    }
    
    return { safe: true };
  }

  /**
   * 添加自定义黑名单路径
   */
  addToBlacklist(path: string): void {
    if (!this.pathBlacklist.includes(path)) {
      this.pathBlacklist.push(path);
    }
  }

  /**
   * 添加自定义危险模式
   */
  addDangerousPattern(pattern: RegExp): void {
    this.dangerousPatterns.push(pattern);
  }

  /**
   * 添加自定义敏感键
   */
  addSensitiveKey(key: string): void {
    const lowerKey = key.toLowerCase();
    if (!this.sensitiveKeys.includes(lowerKey)) {
      this.sensitiveKeys.push(lowerKey);
    }
  }

  // ===== 私有方法 =====

  /**
   * 规范化路径
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/\.\./g, '')
      .toLowerCase();
  }
}

// 单例导出
export const parameterFilter = new ParameterFilter();