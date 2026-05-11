/**
 * AHIVE Core - 安全工具类
 * 
 * 功能：
 * - 输入验证
 * - SQL 注入防护
 * - XSS 防护
 * - 路径遍历防护
 */

// ============ 类型定义 ============

export interface ValidationRule {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============ SQL 注入防护 ============

/**
 * SQL 注入危险字符模式
 */
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b)/gi,
  /(--)|(\/\*)|(\*\/)/g,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/gi,
  /(\b(OR|AND)\b\s+['"]\w+['"]\s*=\s*['"]\w+['"])/gi,
  /(;|\|)/g,
  /(\bUNION\b.*\bSELECT\b)/gi,
];

/**
 * 检测 SQL 注入
 */
export function detectSQLInjection(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 清理 SQL 注入危险字符
 */
export function sanitizeSQL(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  let sanitized = input;
  
  // 转义单引号
  sanitized = sanitized.replace(/'/g, "''");
  
  // 移除危险关键字（保留原意但防止注入）
  sanitized = sanitized.replace(/--/g, '');
  sanitized = sanitized.replace(/\/\*/g, '');
  sanitized = sanitized.replace(/\*\//g, '');
  
  return sanitized;
}

// ============ XSS 防护 ============

/**
 * XSS 危险字符模式
 */
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
];

/**
 * 检测 XSS 攻击
 */
export function detectXSS(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(input)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 清理 XSS 危险字符
 */
export function sanitizeXSS(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  let sanitized = input;
  
  // HTML 实体编码
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  
  sanitized = sanitized.replace(/[&<>"'/]/g, (char) => htmlEntities[char] || char);
  
  return sanitized;
}

// ============ 路径遍历防护 ============

/**
 * 检测路径遍历攻击
 */
export function detectPathTraversal(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  
  // 检测 ../ 或 ..\
  if (/\.\.[\/\\]/.test(input)) return true;
  
  // 检测绝对路径
  if (/^[\/\\]/.test(input)) return true;
  
  // 检测 Windows 盘符
  if (/^[a-zA-Z]:/.test(input)) return true;
  
  return false;
}

/**
 * 清理路径遍历危险字符
 */
export function sanitizePath(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  let sanitized = input;
  
  // 移除 ../ 和 ..\
  sanitized = sanitized.replace(/\.\.[\/\\]/g, '');
  
  // 移除绝对路径前缀
  sanitized = sanitized.replace(/^[\/\\]+/, '');
  sanitized = sanitized.replace(/^[a-zA-Z]:/, '');
  
  return sanitized;
}

// ============ 输入验证 ============

/**
 * 验证字符串
 */
export function validateString(value: any, rule: ValidationRule): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'string') {
    if (rule.required) {
      errors.push(`Expected string but got ${typeof value}`);
    }
    return { valid: errors.length === 0, errors };
  }
  
  if (rule.minLength !== undefined && value.length < rule.minLength) {
    errors.push(`String length ${value.length} is less than minimum ${rule.minLength}`);
  }
  
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    errors.push(`String length ${value.length} exceeds maximum ${rule.maxLength}`);
  }
  
  if (rule.pattern && !rule.pattern.test(value)) {
    errors.push(`String does not match pattern ${rule.pattern}`);
  }
  
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(`Value "${value}" is not in enum: ${rule.enum.join(', ')}`);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * 验证数字
 */
export function validateNumber(value: any, rule: ValidationRule): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'number' || isNaN(value)) {
    if (rule.required) {
      errors.push(`Expected number but got ${typeof value}`);
    }
    return { valid: errors.length === 0, errors };
  }
  
  if (rule.min !== undefined && value < rule.min) {
    errors.push(`Number ${value} is less than minimum ${rule.min}`);
  }
  
  if (rule.max !== undefined && value > rule.max) {
    errors.push(`Number ${value} exceeds maximum ${rule.max}`);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * 验证对象
 */
export function validateObject(value: any, rule: ValidationRule): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    if (rule.required) {
      errors.push(`Expected object but got ${typeof value}`);
    }
    return { valid: errors.length === 0, errors };
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * 验证数组
 */
export function validateArray(value: any, rule: ValidationRule): ValidationResult {
  const errors: string[] = [];
  
  if (!Array.isArray(value)) {
    if (rule.required) {
      errors.push(`Expected array but got ${typeof value}`);
    }
    return { valid: errors.length === 0, errors };
  }
  
  if (rule.minLength !== undefined && value.length < rule.minLength) {
    errors.push(`Array length ${value.length} is less than minimum ${rule.minLength}`);
  }
  
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    errors.push(`Array length ${value.length} exceeds maximum ${rule.maxLength}`);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * 验证输入
 */
export function validate(value: any, rule: ValidationRule): ValidationResult {
  // 检查必填
  if (rule.required && (value === undefined || value === null)) {
    return { valid: false, errors: ['Value is required'] };
  }
  
  // 非必填且为空
  if (!rule.required && (value === undefined || value === null)) {
    return { valid: true, errors: [] };
  }
  
  // 根据类型验证
  switch (rule.type) {
    case 'string':
      return validateString(value, rule);
    case 'number':
      return validateNumber(value, rule);
    case 'object':
      return validateObject(value, rule);
    case 'array':
      return validateArray(value, rule);
    case 'boolean':
      return { 
        valid: typeof value === 'boolean', 
        errors: typeof value === 'boolean' ? [] : [`Expected boolean but got ${typeof value}`] 
      };
    default:
      return { valid: false, errors: [`Unknown type: ${rule.type}`] };
  }
}

/**
 * 验证对象字段
 */
export function validateFields(obj: any, rules: Record<string, ValidationRule>): ValidationResult {
  const errors: string[] = [];
  
  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, errors: ['Expected object'] };
  }
  
  for (const [field, rule] of Object.entries(rules)) {
    const result = validate(obj[field], rule);
    if (!result.valid) {
      errors.push(...result.errors.map(err => `${field}: ${err}`));
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// ============ 综合安全检查 ============

/**
 * 安全检查结果
 */
export interface SecurityCheckResult {
  safe: boolean;
  threats: string[];
}

/**
 * 综合安全检查
 */
export function securityCheck(input: string): SecurityCheckResult {
  const threats: string[] = [];
  
  if (detectSQLInjection(input)) {
    threats.push('SQL injection detected');
  }
  
  if (detectXSS(input)) {
    threats.push('XSS attack detected');
  }
  
  if (detectPathTraversal(input)) {
    threats.push('Path traversal detected');
  }
  
  return {
    safe: threats.length === 0,
    threats,
  };
}

/**
 * 综合清理
 */
export function sanitize(input: string): string {
  let sanitized = input;
  
  // 先清理 XSS
  sanitized = sanitizeXSS(sanitized);
  
  // 再清理 SQL
  sanitized = sanitizeSQL(sanitized);
  
  // 最后清理路径
  sanitized = sanitizePath(sanitized);
  
  return sanitized;
}