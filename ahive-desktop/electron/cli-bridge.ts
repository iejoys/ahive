import { spawn, exec } from 'child_process';
import { join } from 'path';
import { app } from 'electron';
import log from 'electron-log';
import { existsSync } from 'fs';

export interface CLIResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  model?: string;
  status?: string;
}

// ==================== 安全配置 ====================

/** 允许的智能体名称字符（支持中文、空格等） */
const SAFE_AGENT_NAME_PATTERN = /^[\w\s\u4e00-\u9fa5-]{1,64}$/;

/** 最大消息长度 */
const MAX_MESSAGE_LENGTH = 100000;

/**
 * 验证智能体名称安全性
 * 允许：中文、英文、数字、下划线、空格、连字符
 * 禁止：Shell 注入字符如 ; | & $ ` 等
 */
export function validateAgentName(name: string): boolean {
  // 空值检查
  if (!name || typeof name !== 'string') return false;
  // 长度检查
  if (name.length > 64) return false;
  // 字符检查
  return SAFE_AGENT_NAME_PATTERN.test(name);
}

/**
 * 验证消息内容安全性
 */
export function validateMessage(message: string): boolean {
  return typeof message === 'string' && 
         message.length > 0 && 
         message.length <= MAX_MESSAGE_LENGTH;
}

// ==================== CLI 路径管理 ====================

/**
 * 获取 OpenClaw CLI 路径信息（支持开发和打包环境）
 * 返回 { program, scriptPath } 而非命令字符串
 */
export function getOpenClawPathInfo(): { program: string; scriptPath: string | null } {
  // 打包后的环境
  if (app.isPackaged) {
    const resourcesPath = process.resourcesPath;
    
    // 检查 extraResources
    const extraPath = join(resourcesPath, 'openclaw', 'openclaw.mjs');
    if (existsSync(extraPath)) {
      return { program: 'node', scriptPath: extraPath };
    }
    
    // 检查 app.asar.unpacked
    const unpackedPath = join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'openclaw', 'openclaw.mjs');
    if (existsSync(unpackedPath)) {
      return { program: 'node', scriptPath: unpackedPath };
    }
  }
  
  // 开发环境：尝试本地 node_modules
  const devPath = join(__dirname, '..', 'node_modules', 'openclaw', 'openclaw.mjs');
  if (existsSync(devPath)) {
    return { program: 'node', scriptPath: devPath };
  }
  
  // 回退到全局命令（无脚本路径）
  return { program: 'openclaw', scriptPath: null };
}

/**
 * 获取 OpenClaw CLI 路径（兼容旧代码）
 * @deprecated 建议使用 getOpenClawPathInfo() 以获得更好的安全性
 */
function getOpenClawPath(): string {
  const { program, scriptPath } = getOpenClawPathInfo();
  return scriptPath ? `node "${scriptPath}"` : program;
}

// ==================== 安全的 CLI 执行 ====================

/**
 * 安全执行 CLI 命令（使用 spawn，不使用 shell）
 * 这是推荐的方式，参数作为数组传递，不会被 shell 解析
 */
export function executeCLISafe(
  program: string,
  args: string[],
  options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
): Promise<CLIResult> {
  return new Promise((resolve) => {
    log.info(`[CLI Safe] Executing: ${program} ${args.join(' ')}`);
    
    const child = spawn(program, args, {
      shell: false,  // 关键：禁用 shell
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      timeout: options?.timeout || 60000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        log.info(`[CLI Safe] Success, output length: ${stdout.length}`);
        resolve({
          success: true,
          stdout,
          stderr
        });
      } else {
        log.error(`[CLI Safe] Failed with code ${code}: ${stderr}`);
        resolve({
          success: false,
          stdout,
          stderr,
          error: `进程退出，错误码: ${code}`
        });
      }
    });

    child.on('error', (err) => {
      log.error(`[CLI Safe] Process error:`, err.message);
      resolve({
        success: false,
        stdout: '',
        stderr: '',
        error: err.message
      });
    });
  });
}

/**
 * 执行本地 CLI 命令（兼容旧代码）
 * 注意：此函数仍使用 exec，应逐步迁移到 executeCLISafe
 */
export function executeCLI(command: string, options?: {
  encoding?: BufferEncoding;
  timeout?: number;
}): Promise<CLIResult> {
  return new Promise((resolve) => {
    exec(command, { 
      encoding: options?.encoding || 'utf8',
      timeout: options?.timeout || 30000 
    }, (error, stdout, stderr) => {
      if (error) {
        log.error(`CLI 执行失败: ${command}`, error.message);
        resolve({
          success: false,
          stdout,
          stderr,
          error: error.message
        });
      } else {
        log.info(`CLI 执行成功: ${command}`);
        resolve({
          success: true,
          stdout,
          stderr
        });
      }
    });
  });
}

// ==================== OpenClaw 特定功能 ====================

/**
 * 安全获取 OpenClaw 智能体列表
 */
export async function getOpenClawAgents(): Promise<AgentInfo[]> {
  const { program, scriptPath } = getOpenClawPathInfo();
  
  const args = scriptPath 
    ? [scriptPath, 'agents', 'list']
    : ['agents', 'list'];
  
  log.info(`[Agents] Fetching agent list...`);
  const result = await executeCLISafe(program, args);
  
  if (!result.success || !result.stdout) {
    log.warn('获取智能体列表失败:', result.error);
    return [];
  }
  
  const lines = result.stdout.split('\n');
  const agents: AgentInfo[] = [];
  
  // YAML 格式: "- name" 或 "- name (alias)"
  const regex = /^- (\w+)/;
  
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      agents.push({
        id: `agent-${match[1]}`,
        name: match[1]
      });
    }
  }
  
  log.info(`[Agents] Found ${agents.length} agents`);
  return agents;
}

/**
 * 安全地向智能体发送消息
 * 使用 spawn 参数化，避免命令注入
 */
export async function sendMessageToAgent(
  agentName: string,
  message: string
): Promise<CLIResult> {
  // 输入验证
  if (!validateAgentName(agentName)) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `无效的智能体名称: ${agentName}`
    };
  }
  
  if (!validateMessage(message)) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: '消息内容无效或过长'
    };
  }
  
  const { program, scriptPath } = getOpenClawPathInfo();
  
  // 构建参数数组 - message 作为单独参数，不会被 shell 解析
  const args = scriptPath
    ? [scriptPath, 'agent', '--agent', agentName, '--message', message, '--json', '--timeout', '60']
    : ['agent', '--agent', agentName, '--message', message, '--json', '--timeout', '60'];
  
  log.info(`[Agent Message] Sending to ${agentName}...`);
  
  const result = await executeCLISafe(program, args, { timeout: 90000 });
  
  return result;
}

/**
 * 安全检查网关状态
 */
export async function checkGatewayStatus(): Promise<{ running: boolean; port?: string }> {
  const { program, scriptPath } = getOpenClawPathInfo();
  
  const args = scriptPath
    ? [scriptPath, 'gateway', 'status']
    : ['gateway', 'status'];
  
  const result = await executeCLISafe(program, args);
  
  if (result.success && result.stdout.includes('Listening:')) {
    const portMatch = result.stdout.match(/Listening:[\s\S]*?:(\d+)/);
    if (portMatch) {
      return { running: true, port: portMatch[1] };
    }
  }
  
  return { running: false };
}

/**
 * 执行 OpenClaw 命令
 * @deprecated 建议使用 executeCLISafe
 */
export async function runOpenClawCommand(args: string[]): Promise<CLIResult> {
  const { program, scriptPath } = getOpenClawPathInfo();
  
  const fullArgs = scriptPath ? [scriptPath, ...args] : args;
  return executeCLISafe(program, fullArgs);
}

// 导出兼容旧代码的函数
export { getOpenClawPath };