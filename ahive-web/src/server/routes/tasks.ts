import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import { agents } from './agents.js';

// ==================== 输入验证 ====================

/** 允许的命令字符：字母、数字、空格、常见标点 */
const SAFE_TASK_PATTERN = /^[\w\s\-.,!?()\[\]{}@#$%&*+=:;"'\/\\]{1,10000}$/;

/** 危险命令关键词 */
const DANGEROUS_PATTERNS = [
  /;\s*(rm|del|format|shutdown|reboot|kill|pkill|sudo|su|chmod|chown)/i,
  /\|\s*(rm|del|format|shutdown)/i,
  /`[^`]*`/,
  /\$\([^)]*\)/,
  /\$\{[^}]*\}/,
  />\s*\//,
  /2>&1/,
];

/** 验证任务内容安全性 */
function validateTaskInput(task: string): { valid: boolean; error?: string } {
  if (!task || typeof task !== 'string') {
    return { valid: false, error: '任务内容不能为空' };
  }
  
  if (task.length > 10000) {
    return { valid: false, error: '任务内容过长，最大10000字符' };
  }
  
  if (!SAFE_TASK_PATTERN.test(task)) {
    return { valid: false, error: '任务内容包含不允许的字符' };
  }
  
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(task)) {
      return { valid: false, error: '任务内容包含潜在危险的命令' };
    }
  }
  
  return { valid: true };
}

/** 验证工作目录路径 */
function validateCwd(cwd?: string): { valid: boolean; error?: string } {
  if (!cwd) return { valid: true };
  
  // 只允许绝对路径，且不能包含路径遍历
  if (!cwd.startsWith('/') && !cwd.match(/^[A-Za-z]:\\/)) {
    return { valid: false, error: '工作目录必须是绝对路径' };
  }
  
  if (cwd.includes('..')) {
    return { valid: false, error: '工作目录不能包含路径遍历' };
  }
  
  return { valid: true };
}

// ==================== 类型定义 ====================

interface Task {
  id: string;
  agentId: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
}

interface CreateTaskRequest {
  agentId: string;
  task: string;
  context?: {
    cwd?: string;
    env?: Record<string, string>;
  };
}

// ==================== 路由定义 ====================

const router = Router();

// In-memory task storage
const tasks: Map<string, Task> = new Map();

// Get all tasks
router.get('/', (req, res) => {
  const taskList = Array.from(tasks.values()).sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(taskList);
});

// Get tasks by agent
router.get('/agent/:agentId', (req, res) => {
  const agentTasks = Array.from(tasks.values())
    .filter(t => t.agentId === req.params.agentId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(agentTasks);
});

// Get single task
router.get('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: '任务未找到' });
  }
  res.json(task);
});

// Create and execute task
router.post('/', async (req, res) => {
  const data: CreateTaskRequest = req.body;
  
  // 输入验证
  const taskValidation = validateTaskInput(data.task);
  if (!taskValidation.valid) {
    return res.status(400).json({ error: taskValidation.error });
  }
  
  if (data.context?.cwd) {
    const cwdValidation = validateCwd(data.context.cwd);
    if (!cwdValidation.valid) {
      return res.status(400).json({ error: cwdValidation.error });
    }
  }
  
  // Check if agent exists
  const agent = agents.get(data.agentId);
  if (!agent) {
    return res.status(404).json({ error: '智能体未找到' });
  }

  // Check if agent is busy
  if (agent.status === 'working') {
    return res.status(409).json({ error: '智能体正忙，请稍后再试' });
  }

  // Create task
  const task: Task = {
    id: uuidv4(),
    agentId: data.agentId,
    task: data.task,
    status: 'pending',
    output: [],
    createdAt: new Date().toISOString(),
  };
  
  tasks.set(task.id, task);

  // Start executing
  executeTask(task, agent, data.context);

  res.status(201).json(task);
});

// Delete task
router.delete('/:id', (req, res) => {
  if (!tasks.has(req.params.id)) {
    return res.status(404).json({ error: '任务未找到' });
  }
  tasks.delete(req.params.id);
  res.status(204).send();
});

// ==================== 任务执行逻辑 ====================

async function executeTask(task: Task, agent: any, context?: any) {
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  
  // Update agent status
  agent.status = 'working';
  
  console.log(`[Task ${task.id}] Starting task on agent ${agent.name}: ${task.task}`);

  try {
    if (agent.type === 'opencode') {
      // Execute using opencode
      await executeOpenCode(task, context);
    } else if (agent.type === 'mcp') {
      // Execute using MCP
      await executeMCP(task, context);
    } else {
      // Mock execution
      await executeMock(task);
    }
  } catch (error: any) {
    console.error(`[Task ${task.id}] Error:`, error.message);
    task.output.push(`[ERROR] ${error.message}`);
    task.status = 'failed';
  } finally {
    task.completedAt = new Date().toISOString();
    agent.status = 'idle';
    console.log(`[Task ${task.id}] Completed with status: ${task.status}`);
  }
}

// OpenCode executor - 安全版本，不使用 shell
async function executeOpenCode(task: Task, context?: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = context?.cwd || globalThis.process.cwd();
    
    // 安全执行：不使用 shell，参数直接传递
    // 这样 task.task 会被作为单个参数传递，不会被 shell 解析
    const child = spawn('opencode', ['run', task.task], {
      cwd,
      shell: false,  // 关键：禁用 shell，防止命令注入
      env: { ...globalThis.process.env, ...context?.env },
      timeout: 120000,  // 2分钟超时
    });

    child.stdout.on('data', (data: Buffer) => {
      const output = data.toString();
      task.output.push(output);
      console.log(`[Task ${task.id}] ${output}`);
    });

    child.stderr.on('data', (data: Buffer) => {
      const output = `[ERROR] ${data.toString()}`;
      task.output.push(output);
      console.error(`[Task ${task.id}] ${output}`);
    });

    child.on('close', (code) => {
      task.exitCode = code ?? undefined;
      task.status = code === 0 ? 'completed' : 'failed';
      resolve();
    });

    child.on('error', (error) => {
      // 如果 opencode 命令不存在，尝试用 node 执行
      if (error.message.includes('ENOENT')) {
        console.warn('[Task] opencode command not found, falling back to mock execution');
        executeMock(task).then(resolve).catch(reject);
      } else {
        reject(error);
      }
    });
  });
}

// MCP executor (placeholder)
async function executeMCP(task: Task, context?: any): Promise<void> {
  // Simulate MCP tool execution
  const delay = Math.random() * 3000 + 2000;
  await new Promise(resolve => setTimeout(resolve, delay));
  
  task.output.push(`[MCP] Executing task: ${task.task}`);
  task.output.push(`[MCP] Using tools: web-search, file-read`);
  task.output.push(`[MCP] Task completed successfully`);
  task.status = 'completed';
}

// Mock executor
async function executeMock(task: Task): Promise<void> {
  // Simulate task execution with various outputs
  const steps = [
    `[Mock] Starting task...`,
    `[Mock] Analyzing requirements...`,
    `[Mock] Processing...`,
    `[Mock] Generating output...`,
    `[Mock] Task completed!`
  ];

  for (const step of steps) {
    task.output.push(step);
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  task.status = 'completed';
}

export { router as tasksRouter, tasks };