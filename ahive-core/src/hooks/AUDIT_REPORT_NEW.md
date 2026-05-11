# AHIVECORE Hooks 模块代码审计报告

**审计日期**: 2025-01-XX  
**审计范围**: `F:\ahive_project\AHIVECORE\src\hooks`  
**审计版本**: 基于 codex-rs/hooks 实现

---

## 📊 文件统计

| 文件 | 行数 | 大小 | 职责 |
|------|------|------|------|
| `index.ts` | ~15 | 410 B | 模块入口导出 |
| `types.ts` | ~250 | 6.9 KB | 核心类型定义 |
| `schema.ts` | ~130 | 4.0 KB | JSON Schema 定义 |
| `engine/index.ts` | ~320 | 11.4 KB | Hook 引擎核心 |
| `engine/command-runner.ts` | ~130 | 4.0 KB | 命令执行器 |
| `engine/config.ts` | ~140 | 3.4 KB | 配置解析 |
| `engine/discovery.ts` | ~150 | 4.6 KB | Hook 发现机制 |
| `engine/dispatcher.ts` | ~200 | 5.5 KB | Hook 分发器 |
| `engine/output-parser.ts` | ~130 | 3.9 KB | 输出解析器 |
| `events/index.ts` | ~5 | 146 B | 事件模块导出 |
| `events/session-start.ts` | ~70 | 1.7 KB | SessionStart 事件 |
| `events/stop.ts` | ~90 | 2.2 KB | Stop 事件 |
| **总计** | **~1630** | **~48 KB** | - |

---

## 🔴 P0 严重问题 (Critical)

### P0-001: 命令注入漏洞

**文件**: `engine/command-runner.ts:45-55`  
**严重程度**: 🔴 严重

```typescript
// 问题代码
const proc = spawn(shellCmd, shellArgs, {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
```

**问题描述**:  
`handler.command` 直接传递给 shell 执行，没有任何转义或验证。攻击者可以通过 `hooks.json` 注入恶意命令。

**攻击场景**:
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "rm -rf /; echo 'pwned'"
      }]
    }]
  }
}
```

**修复建议**:
```typescript
// 1. 添加命令白名单验证
const ALLOWED_COMMANDS = ['node', 'python', 'bash', 'sh', 'powershell'];
const firstToken = handler.command.split(/\s+/)[0];
if (!ALLOWED_COMMANDS.includes(firstToken)) {
  throw new Error(`Disallowed command: ${firstToken}`);
}

// 2. 或者使用参数化执行
const proc = spawn(shellCmd, [...shellArgs, '--', handler.command], {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  shell: false, // 禁用 shell 解析
});
```

---

### P0-002: 敏感信息泄露风险

**文件**: `engine/index.ts:75-85`, `engine/index.ts:130-145`  
**严重程度**: 🔴 严重

```typescript
// 问题代码
const inputJson = JSON.stringify({
  session_id: request.sessionId,
  transcript_path: request.transcriptPath ?? null,
  cwd: request.cwd,
  // ...
});
```

**问题描述**:  
Hook 输入数据通过 stdin 传递给外部命令，可能包含敏感信息（如 transcript_path 中的对话内容）。这些数据会被写入进程内存和可能的日志文件。

**修复建议**:
```typescript
// 1. 添加敏感字段脱敏选项
interface SessionStartRequest {
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  // 添加敏感字段标记
  _sensitiveFields?: string[];
}

// 2. 在日志中脱敏
logger.debug(`[HookCommand] 输入: ${redactSensitive(inputJson)}`);

// 3. 提供配置选项禁用敏感数据传递
```

---

### P0-003: 超时后进程未完全终止

**文件**: `engine/command-runner.ts:60-70`  
**严重程度**: 🔴 严重

```typescript
// 问题代码
const timeoutId = setTimeout(() => {
  if (!resolved) {
    resolved = true;
    proc.kill();  // 可能无法杀死子进程树
    // ...
  }
}, timeoutMs);
```

**问题描述**:  
`proc.kill()` 默认只发送 SIGTERM 到主进程，子进程可能继续运行。在 Windows 上行为不一致。

**修复建议**:
```typescript
import { spawn } from 'child_process';
import { kill } from 'tree-kill'; // 需要添加依赖

const timeoutId = setTimeout(() => {
  if (!resolved) {
    resolved = true;
    // 使用 tree-kill 杀死整个进程树
    kill(proc.pid!, 'SIGKILL', (err) => {
      if (err) {
        logger.warn(`[HookCommand] 无法杀死进程 ${proc.pid}: ${err.message}`);
      }
    });
    // ...
  }
}, timeoutMs);
```

---

## 🟠 P1 重要问题 (High)

### P1-001: 类型断言不安全

**文件**: `engine/discovery.ts:135-140`  
**严重程度**: 🟠 重要

```typescript
// 问题代码
const config = json as Record<string, unknown>;
// ...
const group = groups[i] as Record<string, unknown>;
```

**问题描述**:  
使用 `as` 类型断言绕过类型检查，可能导致运行时错误。

**修复建议**:
```typescript
// 使用类型守卫
function isMatcherGroup(value: unknown): value is MatcherGroupJson {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.hooks);
}
```

---

### P1-002: JSON 解析无校验

**文件**: `engine/discovery.ts:55-60`  
**严重程度**: 🟠 重要

```typescript
// 问题代码
const content = await fs.readFile(hooksPath, 'utf-8');
const json: HooksFileJson = JSON.parse(content);
```

**问题描述**:  
直接将 JSON 解析结果断言为 `HooksFileJson`，没有运行时校验。恶意或损坏的配置可能导致意外行为。

**修复建议**:
```typescript
import Ajv from 'ajv';

const ajv = new Ajv();
const validateHooksFile = ajv.compile(HOOKS_FILE_SCHEMA);

const content = await fs.readFile(hooksPath, 'utf-8');
const json = JSON.parse(content);

if (!validateHooksFile(json)) {
  throw new Error(`Invalid hooks.json: ${JSON.stringify(validateHooksFile.errors)}`);
}
```

---

### P1-003: 正则表达式 DoS 风险

**文件**: `engine/dispatcher.ts:30-35`  
**严重程度**: 🟠 重要

```typescript
// 问题代码
try {
  const regex = new RegExp(handler.matcher, 'i');
  return regex.test(sessionStartSource);
} catch {
  return false;
}
```

**问题描述**:  
用户提供的 `matcher` 可能包含恶意正则表达式，导致 ReDoS 攻击。

**修复建议**:
```typescript
// 1. 限制正则表达式复杂度
const MAX_REGEX_LENGTH = 100;
const MAX_MATCH_TIME = 100; // ms

if (handler.matcher.length > MAX_REGEX_LENGTH) {
  logger.warn(`[HookDispatcher] matcher 过长，跳过: ${handler.matcher}`);
  return false;
}

// 2. 使用 safe-regex 库检测危险正则
import safeRegex from 'safe-regex';
if (!safeRegex(handler.matcher)) {
  logger.warn(`[HookDispatcher] 不安全的正则表达式: ${handler.matcher}`);
  return false;
}

// 3. 添加超时保护
const regex = new RegExp(handler.matcher, 'i');
// 使用 regexp-match-timeout 或类似库
```

---

### P1-004: 缺少输入验证

**文件**: `engine/index.ts:60-85`  
**严重程度**: 🟠 重要

```typescript
// 问题代码
async runSessionStart(request: SessionStartRequest): Promise<SessionStartOutcome> {
  const matched = selectHandlers(
    this.handlers,
    HookEventName.SessionStart,
    request.source
  );
  // 没有验证 request 的有效性
}
```

**问题描述**:  
所有 `run*` 方法都没有验证输入参数的有效性，可能导致意外行为。

**修复建议**:
```typescript
// 添加输入验证函数
function validateSessionStartRequest(req: SessionStartRequest): string[] {
  const errors: string[] = [];
  if (!req.sessionId?.trim()) errors.push('sessionId is required');
  if (!req.cwd?.trim()) errors.push('cwd is required');
  if (!req.model?.trim()) errors.push('model is required');
  if (!req.permissionMode?.trim()) errors.push('permissionMode is required');
  if (!['startup', 'resume', 'clear'].includes(req.source)) {
    errors.push('source must be startup, resume, or clear');
  }
  return errors;
}

async runSessionStart(request: SessionStartRequest): Promise<SessionStartOutcome> {
  const errors = validateSessionStartRequest(request);
  if (errors.length > 0) {
    throw new Error(`Invalid request: ${errors.join(', ')}`);
  }
  // ...
}
```

---

### P1-005: 错误处理不完整

**文件**: `engine/command-runner.ts:90-110`  
**严重程度**: 🟠 重要

```typescript
// 问题代码
proc.on('error', (err: Error) => {
  if (!resolved) {
    resolved = true;
    clearTimeout(timeoutId);
    // 只处理了 error 事件，没有处理其他异常情况
  }
});
```

**问题描述**:  
缺少对以下情况的处理：
- 子进程内存溢出
- 子进程信号中断
- stdout/stderr 缓冲区溢出

**修复建议**:
```typescript
// 添加缓冲区大小限制
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

let stdoutSize = 0;
let stderrSize = 0;

if (proc.stdout) {
  proc.stdout.on('data', (data: Buffer) => {
    stdoutSize += data.length;
    if (stdoutSize > MAX_BUFFER_SIZE) {
      proc.kill();
      resolved = true;
      resolve({
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        exitCode: null,
        stdout: stdout.slice(0, MAX_BUFFER_SIZE),
        stderr,
        error: 'stdout buffer overflow',
      });
      return;
    }
    stdout += data.toString();
  });
}
```

---

### P1-006: 并发执行无限制

**文件**: `engine/dispatcher.ts:60-70`  
**严重程度**: 🟠 重要

```typescript
// 问题代码
export async function executeHandlers(
  shell: CommandShell,
  handlers: ConfiguredHandler[],
  inputJson: string,
  cwd: string
): Promise<CommandRunResult[]> {
  // 并行执行所有 handler
  const promises = handlers.map((handler) => executeHandler(shell, handler, inputJson, cwd));
  return Promise.all(promises);
}
```

**问题描述**:  
所有 Hook 并行执行，没有并发限制。如果有大量 Hook，可能导致资源耗尽。

**修复建议**:
```typescript
import pLimit from 'p-limit';

const MAX_CONCURRENT_HOOKS = 5;

export async function executeHandlers(
  shell: CommandShell,
  handlers: ConfiguredHandler[],
  inputJson: string,
  cwd: string
): Promise<CommandRunResult[]> {
  if (handlers.length === 0) {
    return [];
  }

  const limit = pLimit(MAX_CONCURRENT_HOOKS);
  
  const promises = handlers.map((handler) => 
    limit(() => executeHandler(shell, handler, inputJson, cwd))
  );
  
  return Promise.all(promises);
}
```

---

## 🟡 P2 改进建议 (Medium)

### P2-001: 缺少日志级别控制

**文件**: 多处使用 `logger.debug/info/warn`  
**严重程度**: 🟡 改进

```typescript
// 当前代码
logger.debug(`[HookCommand] 执行: ${shellCmd} ${shellArgs.join(' ')}`);
logger.info(`[HookDiscovery] 发现 hooks 配置: ${hooksPath}`);
```

**问题描述**:  
日志输出没有统一的格式和级别控制，可能泄露敏感信息。

**修复建议**:
```typescript
// 创建专用的 HookLogger
class HookLogger {
  private prefix = '[HookEngine]';
  
  debug(message: string, data?: Record<string, unknown>) {
    if (process.env.HOOK_DEBUG === 'true') {
      console.debug(`${this.prefix} ${message}`, data ?? '');
    }
  }
  
  // 自动脱敏敏感字段
  info(message: string, data?: Record<string, unknown>) {
    const sanitized = data ? this.sanitize(data) : undefined;
    console.info(`${this.prefix} ${message}`, sanitized ?? '');
  }
  
  private sanitize(data: Record<string, unknown>): Record<string, unknown> {
    const SENSITIVE_FIELDS = ['transcript_path', 'last_assistant_message'];
    const result = { ...data };
    for (const field of SENSITIVE_FIELDS) {
      if (result[field]) {
        result[field] = '[REDACTED]';
      }
    }
    return result;
  }
}
```

---

### P2-002: 硬编码默认值

**文件**: `engine/config.ts:90-95`  
**严重程度**: 🟡 改进

```typescript
// 问题代码
handlers.push({
  // ...
  timeoutSec: hookConfig.timeout_sec ?? 600, // 硬编码 10 分钟
  // ...
});
```

**问题描述**:  
超时时间等配置硬编码，应该提取为常量或配置项。

**修复建议**:
```typescript
// 创建配置常量
export const HOOK_DEFAULTS = {
  TIMEOUT_SEC: 60,        // 默认 1 分钟
  MAX_TIMEOUT_SEC: 3600,  // 最大 1 小时
  MIN_TIMEOUT_SEC: 1,     // 最小 1 秒
} as const;

// 使用时
const timeoutSec = Math.min(
  Math.max(hookConfig.timeout_sec ?? HOOK_DEFAULTS.TIMEOUT_SEC, HOOK_DEFAULTS.MIN_TIMEOUT_SEC),
  HOOK_DEFAULTS.MAX_TIMEOUT_SEC
);
```

---

### P2-003: 缺少单元测试覆盖

**文件**: 整个模块  
**严重程度**: 🟡 改进

**问题描述**:  
未发现测试文件，关键逻辑缺少测试覆盖：
- `selectHandlers` 的 matcher 匹配逻辑
- `parseSessionStart` / `parseStop` 的解析逻辑
- 超时处理逻辑
- 错误处理逻辑

**修复建议**:
```typescript
// 添加测试文件: engine/__tests__/dispatcher.test.ts
describe('selectHandlers', () => {
  it('should filter by event name', () => {
    const handlers: ConfiguredHandler[] = [
      { eventName: HookEventName.SessionStart, command: 'echo 1', timeoutSec: 60, sourcePath: '', displayOrder: 0 },
      { eventName: HookEventName.Stop, command: 'echo 2', timeoutSec: 60, sourcePath: '', displayOrder: 1 },
    ];
    
    const result = selectHandlers(handlers, HookEventName.SessionStart);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('echo 1');
  });
  
  it('should match SessionStart source with regex', () => {
    // ...
  });
});
```

---

### P2-004: 类型定义冗余

**文件**: `types.ts` 和 `schema.ts`  
**严重程度**: 🟡 改进

**问题描述**:  
`types.ts` 中的 TypeScript 类型与 `schema.ts` 中的 JSON Schema 存在重复定义，维护困难。

**修复建议**:
```typescript
// 使用工具从 JSON Schema 生成 TypeScript 类型
// 或使用 zod 定义类型并自动生成 schema
import { z } from 'zod';

export const SessionStartRequestSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  transcriptPath: z.string().optional(),
  model: z.string(),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']),
  source: z.enum(['startup', 'resume', 'clear']),
});

export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;
```

---

### P2-005: 缺少资源清理

**文件**: `engine/command-runner.ts`  
**严重程度**: 🟡 改进

```typescript
// 问题代码
const proc = spawn(shellCmd, shellArgs, { ... });
// 没有显式清理资源
```

**问题描述**:  
子进程资源没有显式清理，可能导致资源泄漏。

**修复建议**:
```typescript
// 添加 AbortController 支持
export async function runCommand(
  shell: CommandShell,
  handler: ConfiguredHandler,
  inputJson: string,
  cwd: string,
  signal?: AbortSignal
): Promise<CommandRunResult> {
  return new Promise((resolve) => {
    const proc = spawn(shellCmd, shellArgs, { ... });
    
    // 监听外部取消信号
    signal?.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });
    
    // 确保所有流都被清理
    const cleanup = () => {
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      proc.stdin?.destroy();
    };
    
    proc.on('close', () => {
      cleanup();
      // ...
    });
  });
}
```

---

### P2-006: 缺少指标收集

**文件**: 整个模块  
**严重程度**: 🟡 改进

**问题描述**:  
缺少性能指标收集，无法监控 Hook 执行情况。

**修复建议**:
```typescript
// 添加指标收集
interface HookMetrics {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

class HookMetricsCollector {
  private metrics = new Map<string, HookMetrics>();
  
  recordExecution(eventName: string, durationMs: number, status: 'success' | 'failure' | 'timeout') {
    const key = eventName;
    const current = this.metrics.get(key) ?? {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
    };
    
    current.totalExecutions++;
    current[`${status}Count`]++;
    current.avgDurationMs = (current.avgDurationMs * (current.totalExecutions - 1) + durationMs) / current.totalExecutions;
    current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
    
    this.metrics.set(key, current);
  }
  
  getMetrics(): Map<string, HookMetrics> {
    return this.metrics;
  }
}
```

---

## 📋 代码规范问题

### 规范-001: 不一致的命名

**问题**: 部分变量使用 camelCase，部分使用 snake_case
```typescript
// types.ts
sessionId: string;  // camelCase ✓
session_id: string; // snake_case (JSON 字段) - 应该统一
```

**建议**: 在代码中使用 camelCase，仅在 JSON 序列化时转换。

---

### 规范-002: 缺少 JSDoc 注释

**问题**: 部分公共 API 缺少文档注释
```typescript
// 缺少文档
export function selectHandlers(
  handlers: ConfiguredHandler[],
  eventName: HookEventName,
  sessionStartSource?: string
): ConfiguredHandler[] {
```

**建议**:
```typescript
/**
 * 选择匹配指定事件的 Handler
 * 
 * @param handlers - 所有已配置的 Handler 列表
 * @param eventName - 目标事件名称
 * @param sessionStartSource - SessionStart 事件的来源 (仅对 SessionStart 有效)
 * @returns 匹配的 Handler 列表
 * 
 * @example
 * ```ts
 * const matched = selectHandlers(handlers, HookEventName.SessionStart, 'startup');
 * ```
 */
export function selectHandlers(
  handlers: ConfiguredHandler[],
  eventName: HookEventName,
  sessionStartSource?: string
): ConfiguredHandler[] {
```

---

### 规范-003: 魔法数字

**问题**: 存在未命名的常量
```typescript
// engine/index.ts
if (result.exitCode === 2) { // 魔法数字 2
```

**建议**:
```typescript
// 定义常量
const HOOK_EXIT_CODES = {
  SUCCESS: 0,
  BLOCK: 2,
  ERROR: 1,
} as const;

if (result.exitCode === HOOK_EXIT_CODES.BLOCK) {
```

---

## 📊 模块评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **代码质量** | ⭐⭐⭐☆☆ | 结构清晰，但存在安全问题 |
| **类型安全** | ⭐⭐⭐⭐☆ | TypeScript 类型完整，但有断言问题 |
| **错误处理** | ⭐⭐⭐☆☆ | 基本覆盖，但不够健壮 |
| **安全性** | ⭐⭐☆☆☆ | 存在命令注入等严重漏洞 |
| **性能** | ⭐⭐⭐☆☆ | 基本可用，缺少并发控制 |
| **可维护性** | ⭐⭐⭐⭐☆ | 代码组织良好，文档完善 |
| **测试覆盖** | ⭐☆☆☆☆ | 缺少测试文件 |

### 综合评分: ⭐⭐⭐☆☆ (3/5)

---

## 🔧 修复优先级建议

### 立即修复 (P0)
1. **命令注入防护** - 添加命令白名单和参数化执行
2. **敏感信息脱敏** - 日志和数据传递时脱敏
3. **进程清理** - 使用 tree-kill 确保子进程终止

### 短期修复 (P1)
1. 添加输入验证
2. 实现 JSON Schema 校验
3. 添加正则表达式安全检查
4. 实现并发限制
5. 完善错误处理

### 中期改进 (P2)
1. 添加单元测试
2. 统一配置管理
3. 实现指标收集
4. 添加资源清理
5. 改进日志系统

---

## 📝 总结

该 Hook 模块整体架构设计合理，参考了 codex-rs 的实现，代码组织清晰。但存在以下主要问题：

1. **安全性不足**: 命令注入风险是最严重的问题，需要立即修复
2. **健壮性欠缺**: 输入验证、错误处理、资源清理都不够完善
3. **测试缺失**: 没有发现测试文件，无法保证代码质量

建议按照优先级逐步修复，特别是 P0 级别的安全问题应该在上线前解决。