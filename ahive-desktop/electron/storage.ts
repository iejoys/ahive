/**
 * 数据存储模块
 * 负责将定时任务、工作流、黑板等数据持久化到本地 JSON 文件
 */

import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import log from 'electron-log';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// ========== 工作流模板类型 ==========

export interface WorkflowTemplateData {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  tags: string[];
  isOfficial: boolean;
  source?: 'local' | 'online';
  sourceUrl?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
}

export interface WorkflowTemplateLibrary {
  version: string;
  templates: WorkflowTemplateData[];
}

// ========== 敏感字段加密 ==========

/**
 * 敏感字段列表 - 这些字段的值将被加密存储
 */
const SENSITIVE_FIELDS = [
  'apiKey', 'api_key', 'secret', 'password', 'token',
  'credential', 'accessToken', 'refreshToken', 'privateKey'
];

/**
 * 加密密钥（基于用户数据目录生成，确保跨版本稳定）
 */
function getEncryptionKey(): Buffer {
  // 使用 userData 目录而非 appPath，确保应用更新后密钥稳定
  const userDataPath = app.getPath('userData');
  const salt = 'ahive-encryption-salt-v1';
  return scryptSync(userDataPath, salt, 32);
}

/**
 * 加密敏感值
 */
function encryptValue(value: string): string {
  if (!value || typeof value !== 'string') return value;
  try {
    const key = getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `ENC:${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    log.error('[Storage] Encryption failed:', error);
    return value;
  }
}

/**
 * 解密敏感值
 */
function decryptValue(encryptedValue: string): string {
  if (!encryptedValue || typeof encryptedValue !== 'string' || !encryptedValue.startsWith('ENC:')) {
    return encryptedValue;
  }
  try {
    const key = getEncryptionKey();
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) return encryptedValue;

    const iv = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    log.error('[Storage] Decryption failed:', error);
    return encryptedValue;
  }
}

/**
 * 检查字段名是否为敏感字段
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.some(sf => lowerName.includes(sf.toLowerCase()));
}

/**
 * 递归加密对象中的敏感字段
 */
function encryptSensitiveFields(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => encryptSensitiveFields(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key) && typeof value === 'string') {
      result[key] = encryptValue(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = encryptSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 递归解密对象中的敏感字段
 */
function decryptSensitiveFields(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => decryptSensitiveFields(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key) && typeof value === 'string') {
      result[key] = decryptValue(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = decryptSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}


// 数据存储目录
const getDataDir = (): string => {
  const baseDir = app.isPackaged
    ? join(process.resourcesPath, '..')
    : join(__dirname, '..');

  const dataDir = join(baseDir, 'data');

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    log.info('[Storage] Created data directory:', dataDir);
  }

  return dataDir;
};

// 数据文件路径
const getFilePath = (filename: string): string => {
  return join(getDataDir(), filename);
};

// ========== 类型定义 ==========

export interface ScheduledTaskData {
  id: string;
  name: string;
  description?: string;
  targetType: 'workflow' | 'agent';
  workflowId?: string;
  agentId?: string;
  taskPrompt?: string;
  triggerType: 'once' | 'interval' | 'cron';
  cronExpression?: string;
  intervalMs?: number;
  scheduledTime?: string;
  nextRunAt?: string;
  enabled: boolean;
  lastRunAt?: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRunData {
  id: string;
  scheduledTaskId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
  error?: string;
  duration?: number;
}

export interface AppData {
  scheduledTasks: ScheduledTaskData[];
  scheduledTaskRuns: Record<string, ScheduledTaskRunData[]>;
  lastUpdated: string;
}

// ========== 工作流数据类型 ==========

export interface WorkflowNode {
  id: string;
  type: 'agent' | 'group' | 'condition' | 'parallel' | 'human';
  agentId?: string;
  groupId?: string;
  name: string;
  description?: string;
  position: { x: number; y: number };
  config?: {
    agentId?: string;
    taskTemplate?: string;
    inputs?: any[];
    outputs?: any[];
    timeout?: number;
    retryCount?: number;
    conditions?: any[];
    defaultNode?: string;
    branches?: string[];
    mergeType?: 'all' | 'any';
    reviewTitle?: string;
    reviewDescription?: string;
    reviewOptions?: any[];
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: any;
  conditionFailTarget?: string;
  createdAt?: string;
}

export interface WorkflowData {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BlackboardVariableEntry {
  key: string;
  value: any;
  type: 'public' | 'private' | 'protected';
  owner?: string;
  version: number;
  updatedAt: string;
  description?: string;
}

export interface BlackboardEventData {
  type: string;
  timestamp: string;
  data: any;
  source?: string;
}

export interface BlackboardState {
  variables: BlackboardVariableEntry[];
  events: BlackboardEventData[];
  lastUpdated: string;
}

export interface ExecutionState {
  instanceId: string;
  workflowId: string;
  status: 'idle' | 'running' | 'paused' | 'waiting-review' | 'completed' | 'failed';
  currentNodeId: string;
  executionPath: string[];
  startedAt: string;
  completedAt?: string;
  error?: string;
  history: any[];
}

// ========== 文件常量 ==========

const DATA_FILE = 'app-data.json';
const WORKFLOWS_FILE = 'workflows.json';  // 旧文件，不再使用
const WORKFLOWS_DIR = 'workflows';         // 新的工作流目录
const INVALID_CHARS = /[\/\\:*?"<>|]/g;    // 不允许的文件名字符

// ========== AppData 操作 ==========

function getDefaultData(): AppData {
  return {
    scheduledTasks: [],
    scheduledTaskRuns: {},
    lastUpdated: new Date().toISOString(),
  };
}

export function loadData(): AppData {
  const filePath = getFilePath(DATA_FILE);

  try {
    if (!existsSync(filePath)) {
      log.info('[Storage] Data file not found, returning defaults');
      return getDefaultData();
    }

    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as AppData;

    log.info('[Storage] Loaded data from:', filePath);
    return data;
  } catch (error) {
    log.error('[Storage] Failed to load data:', error);
    return getDefaultData();
  }
}

export function saveData(data: AppData): boolean {
  const filePath = getFilePath(DATA_FILE);

  try {
    const content = JSON.stringify({
      ...data,
      lastUpdated: new Date().toISOString(),
    }, null, 2);

    writeFileSync(filePath, content, 'utf-8');
    log.info('[Storage] Saved data to:', filePath);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save data:', error);
    return false;
  }
}

// ========== 定时任务操作 ==========

export function getScheduledTasks(): ScheduledTaskData[] {
  const data = loadData();
  return data.scheduledTasks;
}

export function saveScheduledTask(task: ScheduledTaskData): boolean {
  const data = loadData();

  const existingIndex = data.scheduledTasks.findIndex(t => t.id === task.id);
  if (existingIndex >= 0) {
    data.scheduledTasks[existingIndex] = task;
  } else {
    data.scheduledTasks.push(task);
  }

  return saveData(data);
}

export function deleteScheduledTask(taskId: string): boolean {
  const data = loadData();
  data.scheduledTasks = data.scheduledTasks.filter(t => t.id !== taskId);
  delete data.scheduledTaskRuns[taskId];
  return saveData(data);
}

export function toggleScheduledTask(taskId: string, enabled: boolean): boolean {
  const data = loadData();
  const task = data.scheduledTasks.find(t => t.id === taskId);
  if (task) {
    task.enabled = enabled;
    task.updatedAt = new Date().toISOString();
    return saveData(data);
  }
  return false;
}

// ========== 执行记录操作 ==========

export function getTaskRuns(taskId: string): ScheduledTaskRunData[] {
  const data = loadData();
  return data.scheduledTaskRuns[taskId] || [];
}

export function addTaskRun(run: ScheduledTaskRunData): boolean {
  const data = loadData();

  if (!data.scheduledTaskRuns[run.scheduledTaskId]) {
    data.scheduledTaskRuns[run.scheduledTaskId] = [];
  }

  const runs = data.scheduledTaskRuns[run.scheduledTaskId];
  const existingIndex = runs.findIndex(r => r.id === run.id);
  if (existingIndex >= 0) {
    runs[existingIndex] = run;
  } else {
    runs.push(run);
  }

  return saveData(data);
}

export function getAllTaskRuns(): Record<string, ScheduledTaskRunData[]> {
  const data = loadData();
  return data.scheduledTaskRuns;
}

// ========== 工作流操作（目录存储） ==========

/** 清理文件名，移除不允许的字符 */
function sanitizeFileName(name: string): string {
  return name
    .replace(INVALID_CHARS, '_')
    .trim()
    .slice(0, 100); // 限制长度
}

/** 获取工作流目录 */
function getWorkflowsDir(): string {
  const dir = join(getDataDir(), WORKFLOWS_DIR);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log.info('[Storage] Created workflows directory:', dir);
  }
  
  return dir;
}

/** 扫描目录加载所有工作流（文件名作为工作流名称） */
export function getWorkflows(): WorkflowData[] {
  const dir = getWorkflowsDir();
  const workflows: WorkflowData[] = [];
  
  try {
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const filePath = join(dir, file);
        const content = readFileSync(filePath, 'utf-8');
        const workflow = JSON.parse(content) as WorkflowData;
        
        // 文件名作为工作流名称（去掉 .json 后缀）
        const nameFromFile = file.replace('.json', '');
        workflow.name = nameFromFile;
        
        workflows.push(workflow);
      } catch (error) {
        log.warn('[Storage] Failed to load workflow file:', file);
      }
    }
    
    log.info('[Storage] Loaded', workflows.length, 'workflows from directory');
  } catch (error) {
    log.error('[Storage] Failed to scan workflows directory:', error);
  }
  
  return workflows;
}

/** 获取单个工作流（按 ID 查找） */
export function getWorkflow(workflowId: string): WorkflowData | undefined {
  const workflows = getWorkflows();
  return workflows.find(w => w.id === workflowId);
}

/** 获取工作流（按名称/文件名查找） */
export function getWorkflowByName(name: string): WorkflowData | undefined {
  const dir = getWorkflowsDir();
  const fileName = sanitizeFileName(name);
  const filePath = join(dir, `${fileName}.json`);
  
  if (!existsSync(filePath)) {
    return undefined;
  }
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const workflow = JSON.parse(content) as WorkflowData;
    workflow.name = fileName; // 文件名作为名称
    return workflow;
  } catch {
    return undefined;
  }
}

/** 检查工作流名称是否存在（直接检查文件） */
export function workflowNameExists(name: string, _excludeId?: string): boolean {
  const dir = getWorkflowsDir();
  const fileName = sanitizeFileName(name);
  const filePath = join(dir, `${fileName}.json`);
  return existsSync(filePath);
}

/** 保存工作流（文件名 = 工作流名称） */
export function saveWorkflow(workflow: WorkflowData): boolean {
  const dir = getWorkflowsDir();
  
  // 清理文件名
  const fileName = sanitizeFileName(workflow.name);
  if (!fileName) {
    log.error('[Storage] Invalid workflow name:', workflow.name);
    return false;
  }
  
  const filePath = join(dir, `${fileName}.json`);
  
  try {
    const now = new Date().toISOString();
    const data = {
      ...workflow,
      name: fileName, // 确保名称与文件名一致
      createdAt: workflow.createdAt || now,
      updatedAt: now
    };
    
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    log.info('[Storage] Saved workflow:', fileName);
    
    // 生成项目配置提示词文件
    try {
      generateProjectPromptFiles(workflow);
    } catch (promptError) {
      log.warn('[Storage] Failed to generate project prompt files:', promptError);
      // 不影响主流程
    }
    
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save workflow:', error);
    return false;
  }
}

/** 删除工作流 */
export function deleteWorkflow(workflowId: string): boolean {
  const dir = getWorkflowsDir();
  const workflows = getWorkflows();
  const workflow = workflows.find(w => w.id === workflowId);
  
  if (!workflow) {
    log.warn('[Storage] Workflow not found:', workflowId);
    return false;
  }
  
  const fileName = sanitizeFileName(workflow.name);
  const filePath = join(dir, `${fileName}.json`);
  
  if (!existsSync(filePath)) {
    log.warn('[Storage] Workflow file not found:', filePath);
    return false;
  }
  
  try {
    unlinkSync(filePath);
    log.info('[Storage] Deleted workflow:', fileName);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to delete workflow:', error);
    return false;
  }
}

/** 重命名工作流（重命名文件） */
export function renameWorkflow(oldName: string, newName: string): boolean {
  const dir = getWorkflowsDir();
  
  const oldFileName = sanitizeFileName(oldName);
  const newFileName = sanitizeFileName(newName);
  
  if (!oldFileName || !newFileName) {
    log.error('[Storage] Invalid workflow name');
    return false;
  }
  
  const oldPath = join(dir, `${oldFileName}.json`);
  const newPath = join(dir, `${newFileName}.json`);
  
  // 检查旧文件是否存在
  if (!existsSync(oldPath)) {
    log.warn('[Storage] Old workflow file not found:', oldFileName);
    return false;
  }
  
  // 检查新名称是否已存在
  if (existsSync(newPath)) {
    log.warn('[Storage] Workflow with new name already exists:', newFileName);
    return false;
  }
  
  try {
    // 读取旧文件内容
    const content = readFileSync(oldPath, 'utf-8');
    const workflow = JSON.parse(content);
    
    // 更新名称和更新时间
    workflow.name = newFileName;
    workflow.updatedAt = new Date().toISOString();
    
    // 写入新文件
    writeFileSync(newPath, JSON.stringify(workflow, null, 2), 'utf-8');
    
    // 删除旧文件
    unlinkSync(oldPath);
    
    log.info('[Storage] Renamed workflow:', oldFileName, '->', newFileName);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to rename workflow:', error);
    return false;
  }
}

/** 从 JSON 内容导入工作流 */
export function importWorkflowFromContent(
  content: string,
  customName?: string
): { success: boolean; workflow?: WorkflowData; error?: string } {
  try {
    const data = JSON.parse(content);
    
    // 验证结构
    if (!data.name || !data.nodes || !Array.isArray(data.nodes)) {
      return { success: false, error: '无效的工作流格式：缺少 name 或 nodes 字段' };
    }
    
    // 生成新 ID
    const newId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = customName || data.name;
    
    // 检查名称冲突
    if (workflowNameExists(name)) {
      return { success: false, error: `工作流名称 "${name}" 已存在，请使用其他名称` };
    }
    
    const workflow: WorkflowData = {
      ...data,
      id: newId,
      name,
      nodes: data.nodes || [],
      edges: data.edges || [],
      isActive: data.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // 保存
    if (saveWorkflow(workflow)) {
      return { success: true, workflow };
    } else {
      return { success: false, error: '保存工作流失败' };
    }
  } catch (error) {
    return { 
      success: false, 
      error: `解析失败: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

/** 获取工作流文件列表（返回文件名，不含扩展名） */
export function listWorkflowFiles(): string[] {
  const dir = getWorkflowsDir();
  
  try {
    return readdirSync(dir)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => f.replace('.json', ''));
  } catch {
    return [];
  }
}

// ========== 部门数据类型 ==========

export interface DepartmentMember {
  agentId: string;
  role: 'leader' | 'member' | 'reviewer';
  joinedAt: string;
}

export interface InternalWorkflow {
  id: string;
  name: string;
  triggerCondition: string;
  workflowId: string;
  triggerType: 'manual' | 'auto' | 'webhook' | 'schedule';
  schedule?: string;
  enabled: boolean;
}

export interface DepartmentSettings {
  autoAssign: boolean;
  assignStrategy: 'round-robin' | 'least-loaded' | 'skill-based';
  notifyOnTask: boolean;
  maxConcurrentTasks?: number;
}

export interface DepartmentData {
  id: string;
  name: string;
  icon: string;
  description: string;
  members: DepartmentMember[];
  internalWorkflows: InternalWorkflow[];
  blackboard: Record<string, unknown>;
  settings: DepartmentSettings;
  createdAt: string;
  updatedAt: string;
}

// ========== 部门数据操作 ==========

const DEPARTMENTS_FILE = 'departments.json';

function loadDepartmentsData(): DepartmentData[] {
  const filePath = getFilePath(DEPARTMENTS_FILE);
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as DepartmentData[];
    }
  } catch (error) {
    log.error('[Storage] Failed to load departments data:', error);
  }
  return [];
}

function saveDepartmentsData(departments: DepartmentData[]): boolean {
  const filePath = getFilePath(DEPARTMENTS_FILE);
  try {
    writeFileSync(filePath, JSON.stringify(departments, null, 2), 'utf-8');
    log.info('[Storage] Saved', departments.length, 'departments');
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save departments data:', error);
    return false;
  }
}

export function getDepartments(): DepartmentData[] {
  return loadDepartmentsData();
}

export function getDepartment(departmentId: string): DepartmentData | undefined {
  const departments = loadDepartmentsData();
  return departments.find(d => d.id === departmentId);
}

export function saveDepartment(department: DepartmentData): boolean {
  const departments = loadDepartmentsData();
  const index = departments.findIndex(d => d.id === department.id);
  
  if (index >= 0) {
    departments[index] = { ...department, updatedAt: new Date().toISOString() };
  } else {
    departments.push({
      ...department,
      createdAt: department.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  
  return saveDepartmentsData(departments);
}

export function deleteDepartment(departmentId: string): boolean {
  const departments = loadDepartmentsData();
  const filtered = departments.filter(d => d.id !== departmentId);
  
  if (filtered.length === departments.length) {
    return false; // 未找到要删除的部门
  }
  
  return saveDepartmentsData(filtered);
}

export function saveDepartments(departments: DepartmentData[]): boolean {
  return saveDepartmentsData(departments);
}

export function addDepartmentMember(departmentId: string, member: DepartmentMember): boolean {
  const departments = loadDepartmentsData();
  const department = departments.find(d => d.id === departmentId);
  
  if (!department) return false;
  
  // 检查成员是否已存在
  if (department.members.some(m => m.agentId === member.agentId)) {
    return false;
  }
  
  department.members.push(member);
  department.updatedAt = new Date().toISOString();
  
  return saveDepartmentsData(departments);
}

export function removeDepartmentMember(departmentId: string, agentId: string): boolean {
  const departments = loadDepartmentsData();
  const department = departments.find(d => d.id === departmentId);
  
  if (!department) return false;
  
  const originalLength = department.members.length;
  department.members = department.members.filter(m => m.agentId !== agentId);
  
  if (department.members.length === originalLength) {
    return false; // 未找到要删除的成员
  }
  
  department.updatedAt = new Date().toISOString();
  return saveDepartmentsData(departments);
}

// ========== 中断记录类型 ==========

export interface InterruptionRecordData {
  id: string;
  nodeId: string;
  workflowId: string;
  workflowName?: string;
  agentId: string;
  agentName?: string;
  reason: string;
  interruptedAt: string;
  recoveredAt?: string;
  taskState?: {
    nodeId: string;
    nodeName: string;
    workflowId: string;
    status: string;
    executor?: string;
    startedAt?: string;
    expectedDuration?: number;
    progress?: number;
  };
}

// ========== 中断记录操作 ==========

const INTERRUPTIONS_FILE = 'interruptions.json';

function loadInterruptionsData(): InterruptionRecordData[] {
  const filePath = getFilePath(INTERRUPTIONS_FILE);
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as InterruptionRecordData[];
    }
  } catch (error) {
    log.error('[Storage] Failed to load interruptions data:', error);
  }
  return [];
}

function saveInterruptionsData(interruptions: InterruptionRecordData[]): boolean {
  const filePath = getFilePath(INTERRUPTIONS_FILE);
  try {
    writeFileSync(filePath, JSON.stringify(interruptions, null, 2), 'utf-8');
    log.info('[Storage] Saved', interruptions.length, 'interruption records');
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save interruptions data:', error);
    return false;
  }
}

export function getInterruptions(): InterruptionRecordData[] {
  return loadInterruptionsData();
}

export function getUnrecoveredInterruptions(): InterruptionRecordData[] {
  return loadInterruptionsData().filter(i => !i.recoveredAt);
}

export function saveInterruption(interruption: InterruptionRecordData): boolean {
  const interruptions = loadInterruptionsData();
  const index = interruptions.findIndex(i => i.id === interruption.id);
  
  if (index >= 0) {
    interruptions[index] = interruption;
  } else {
    interruptions.push(interruption);
  }
  
  return saveInterruptionsData(interruptions);
}

export function markInterruptionRecovered(id: string): boolean {
  const interruptions = loadInterruptionsData();
  const interruption = interruptions.find(i => i.id === id);
  
  if (!interruption) return false;
  
  interruption.recoveredAt = new Date().toISOString();
  return saveInterruptionsData(interruptions);
}

export function deleteInterruption(id: string): boolean {
  const interruptions = loadInterruptionsData();
  const filtered = interruptions.filter(i => i.id !== id);
  
  if (filtered.length === interruptions.length) {
    return false;
  }
  
  return saveInterruptionsData(filtered);
}

export function cleanupOldInterruptions(daysToKeep: number = 30): number {
  const interruptions = loadInterruptionsData();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  
  const filtered = interruptions.filter(i => {
    // 保留未恢复的记录
    if (!i.recoveredAt) return true;
    // 保留近期恢复的记录
    return new Date(i.recoveredAt) >= cutoff;
  });
  
  const removed = interruptions.length - filtered.length;
  if (removed > 0) {
    saveInterruptionsData(filtered);
    log.info(`[Storage] Cleaned up ${removed} old interruption records`);
  }
  
  return removed;
}

// ========== 消息队列类型 ==========

export interface QueuedMessage {
  from: string;
  message: string;
  timestamp: string;
  type: string;
  nodeId?: string;
  workflowId?: string;
}

export type MessageQueueData = Record<string, QueuedMessage[]>;

// ========== 消息队列操作 ==========

const MESSAGE_QUEUE_FILE = 'message-queue.json';

function loadMessageQueueData(): MessageQueueData {
  const filePath = getFilePath(MESSAGE_QUEUE_FILE);
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as MessageQueueData;
    }
  } catch (error) {
    log.error('[Storage] Failed to load message queue data:', error);
  }
  return {};
}

function saveMessageQueueData(queue: MessageQueueData): boolean {
  const filePath = getFilePath(MESSAGE_QUEUE_FILE);
  try {
    writeFileSync(filePath, JSON.stringify(queue, null, 2), 'utf-8');
    const totalMessages = Object.values(queue).reduce((sum, msgs) => sum + msgs.length, 0);
    log.info(`[Storage] Saved message queue with ${totalMessages} messages for ${Object.keys(queue).length} agents`);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save message queue data:', error);
    return false;
  }
}

export function getMessageQueue(): MessageQueueData {
  return loadMessageQueueData();
}

export function getQueuedMessages(agentId: string): QueuedMessage[] {
  const queue = loadMessageQueueData();
  return queue[agentId] || [];
}

export function addQueuedMessage(agentId: string, message: QueuedMessage): boolean {
  const queue = loadMessageQueueData();
  
  if (!queue[agentId]) {
    queue[agentId] = [];
  }
  
  // 限制每个 Agent 最多缓存 100 条消息
  if (queue[agentId].length >= 100) {
    queue[agentId].shift(); // 移除最旧的消息
  }
  
  queue[agentId].push(message);
  return saveMessageQueueData(queue);
}

export function clearQueuedMessages(agentId: string): boolean {
  const queue = loadMessageQueueData();
  
  if (!queue[agentId]) return true;
  
  delete queue[agentId];
  return saveMessageQueueData(queue);
}

export function clearAllQueuedMessages(): boolean {
  return saveMessageQueueData({});
}

// ========== 黑板状态操作（分文件存储） ==========

/** 全局变量文件 */
const GLOBAL_VARIABLES_FILE = 'global_variables.json';

/** 工作流状态目录 */
const WORKFLOW_STATES_DIR = 'workflow-states';

/** 工作流变量文件名 */
const WORKFLOW_VARIABLES_FILE = 'variables.json';

/** 工作流执行状态文件名 */
const WORKFLOW_EXECUTION_STATE_FILE = 'execution_state.json';

/** 全局变量数据结构 */
export interface GlobalVariablesState {
  version: number;
  variables: BlackboardVariableEntry[];
  lastUpdated: string;
}

/** 工作流变量数据结构 */
export interface WorkflowVariablesState {
  workflowId: string;
  workflowName?: string;
  version: number;
  variables: BlackboardVariableEntry[];
  lastUpdated: string;
}

/** 获取工作流状态目录 */
function getWorkflowStatesDir(): string {
  const dir = join(getDataDir(), WORKFLOW_STATES_DIR);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log.info('[Storage] Created workflow states directory:', dir);
  }
  
  return dir;
}

/** 获取指定工作流的数据目录 */
export function getWorkflowDataDir(workflowId: string): string {
  const baseDir = getWorkflowStatesDir();
  const workflowDir = join(baseDir, workflowId);
  
  if (!existsSync(workflowDir)) {
    mkdirSync(workflowDir, { recursive: true });
    log.info('[Storage] Created workflow data directory:', workflowId);
  }
  
  return workflowDir;
}

// ========== 全局变量操作 ==========

/** 加载全局变量 */
function loadGlobalVariablesData(): GlobalVariablesState {
  const filePath = getFilePath(GLOBAL_VARIABLES_FILE);
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as GlobalVariablesState;
    }
  } catch (error) {
    log.error('[Storage] Failed to load global variables:', error);
  }
  return {
    version: 1,
    variables: [],
    lastUpdated: new Date().toISOString()
  };
}

/** 保存全局变量 */
function saveGlobalVariablesData(state: GlobalVariablesState): boolean {
  const filePath = getFilePath(GLOBAL_VARIABLES_FILE);
  try {
    const data = {
      ...state,
      version: state.version + 1,
      lastUpdated: new Date().toISOString()
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    log.info('[Storage] Saved global variables:', data.variables.length, 'entries');
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save global variables:', error);
    return false;
  }
}

/** 获取全局变量 */
export function getGlobalVariables(): GlobalVariablesState {
  return loadGlobalVariablesData();
}

/** 保存全局变量 */
export function saveGlobalVariables(state: GlobalVariablesState): boolean {
  return saveGlobalVariablesData(state);
}

/** 更新全局变量 */
export function updateGlobalVariable(entry: BlackboardVariableEntry): boolean {
  const state = loadGlobalVariablesData();
  
  const existingIndex = state.variables.findIndex(v => v.key === entry.key);
  if (existingIndex >= 0) {
    state.variables[existingIndex] = entry;
  } else {
    state.variables.push(entry);
  }
  
  return saveGlobalVariablesData(state);
}

/** 删除全局变量 */
export function deleteGlobalVariable(key: string): boolean {
  const state = loadGlobalVariablesData();
  state.variables = state.variables.filter(v => v.key !== key);
  return saveGlobalVariablesData(state);
}

// ========== 工作流变量操作 ==========

/** 加载工作流变量 */
function loadWorkflowVariablesData(workflowId: string): WorkflowVariablesState {
  const workflowDir = getWorkflowDataDir(workflowId);
  const filePath = join(workflowDir, WORKFLOW_VARIABLES_FILE);
  
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as WorkflowVariablesState;
    }
  } catch (error) {
    log.error('[Storage] Failed to load workflow variables:', workflowId, error);
  }
  return {
    workflowId,
    version: 1,
    variables: [],
    lastUpdated: new Date().toISOString()
  };
}

/** 保存工作流变量 */
function saveWorkflowVariablesData(state: WorkflowVariablesState): boolean {
  const workflowDir = getWorkflowDataDir(state.workflowId);
  const filePath = join(workflowDir, WORKFLOW_VARIABLES_FILE);
  
  try {
    const data = {
      ...state,
      version: state.version + 1,
      lastUpdated: new Date().toISOString()
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    log.info('[Storage] Saved workflow variables:', state.workflowId, data.variables.length, 'entries');
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save workflow variables:', state.workflowId, error);
    return false;
  }
}

/** 获取工作流变量 */
export function getWorkflowVariables(workflowId: string): WorkflowVariablesState {
  return loadWorkflowVariablesData(workflowId);
}

/** 保存工作流变量 */
export function saveWorkflowVariables(state: WorkflowVariablesState): boolean {
  return saveWorkflowVariablesData(state);
}

/** 更新工作流变量 */
export function updateWorkflowVariable(workflowId: string, entry: BlackboardVariableEntry): boolean {
  const state = loadWorkflowVariablesData(workflowId);
  
  const existingIndex = state.variables.findIndex(v => v.key === entry.key);
  if (existingIndex >= 0) {
    state.variables[existingIndex] = entry;
  } else {
    state.variables.push(entry);
  }
  
  return saveWorkflowVariablesData(state);
}

/** 删除工作流变量 */
export function deleteWorkflowVariable(workflowId: string, key: string): boolean {
  const state = loadWorkflowVariablesData(workflowId);
  state.variables = state.variables.filter(v => v.key !== key);
  return saveWorkflowVariablesData(state);
}

/** 清空工作流变量 */
export function clearWorkflowVariables(workflowId: string): boolean {
  const state = loadWorkflowVariablesData(workflowId);
  state.variables = [];
  return saveWorkflowVariablesData(state);
}

/** 删除工作流数据目录（删除工作流时调用） */
export function deleteWorkflowDataDir(workflowId: string): boolean {
  const workflowDir = join(getWorkflowStatesDir(), workflowId);
  
  if (!existsSync(workflowDir)) {
    return true; // 目录不存在，视为成功
  }
  
  try {
    const { rmSync } = require('fs');
    rmSync(workflowDir, { recursive: true, force: true });
    log.info('[Storage] Deleted workflow data directory:', workflowId);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to delete workflow data directory:', workflowId, error);
    return false;
  }
}

/** 获取所有工作流的变量 */
export function getAllWorkflowVariables(): Record<string, WorkflowVariablesState> {
  const statesDir = getWorkflowStatesDir();
  const result: Record<string, WorkflowVariablesState> = {};
  
  try {
    const dirs = readdirSync(statesDir, { withFileTypes: true });
    
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const workflowId = dir.name;
        const filePath = join(statesDir, workflowId, WORKFLOW_VARIABLES_FILE);
        
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            result[workflowId] = JSON.parse(content) as WorkflowVariablesState;
          } catch (error) {
            log.warn('[Storage] Failed to load workflow variables:', workflowId);
          }
        }
      }
    }
  } catch (error) {
    log.error('[Storage] Failed to scan workflow states directory:', error);
  }
  
  return result;
}

// ========== 兼容旧 API ==========

/** 黑板状态（兼容旧格式） */
const BLACKBOARD_FILE = 'blackboard.json';

function loadBlackboardData(): BlackboardState {
  // 新版本：合并全局变量和当前活动工作流变量
  const globalState = loadGlobalVariablesData();
  
  // 尝试加载当前活动工作流的变量（如果有）
  // 这里返回全局变量，前端会根据当前工作流ID分别加载
  return {
    variables: globalState.variables,
    events: [],
    lastUpdated: globalState.lastUpdated
  };
}

function saveBlackboardData(state: BlackboardState): boolean {
  // 新版本：根据变量中的 scope 字段分别保存
  const globalVariables: BlackboardVariableEntry[] = [];
  const workflowVariablesMap: Record<string, BlackboardVariableEntry[]> = {};
  
  for (const entry of state.variables) {
    // 检查变量是否有 scope 字段
    if ((entry as any).scope === 'workflow' && (entry as any).workflowId) {
      const workflowId = (entry as any).workflowId;
      if (!workflowVariablesMap[workflowId]) {
        workflowVariablesMap[workflowId] = [];
      }
      workflowVariablesMap[workflowId].push(entry);
    } else {
      globalVariables.push(entry);
    }
  }
  
  // 保存全局变量
  if (globalVariables.length > 0) {
    saveGlobalVariablesData({
      version: 1,
      variables: globalVariables,
      lastUpdated: new Date().toISOString()
    });
  }
  
  // 保存各工作流变量
  for (const [workflowId, variables] of Object.entries(workflowVariablesMap)) {
    saveWorkflowVariablesData({
      workflowId,
      version: 1,
      variables,
      lastUpdated: new Date().toISOString()
    });
  }
  
  return true;
}

export function getBlackboardState(): BlackboardState {
  return loadBlackboardData();
}

export function saveBlackboardState(state: BlackboardState): boolean {
  return saveBlackboardData(state);
}

export function updateBlackboardVariable(entry: BlackboardVariableEntry): boolean {
  // 根据变量的 scope 字段决定保存位置
  if ((entry as any).scope === 'workflow' && (entry as any).workflowId) {
    return updateWorkflowVariable((entry as any).workflowId, entry);
  }
  return updateGlobalVariable(entry);
}

export function deleteBlackboardVariable(key: string): boolean {
  // 删除全局变量
  const globalState = loadGlobalVariablesData();
  const globalDeleted = globalState.variables.some(v => v.key === key);
  
  if (globalDeleted) {
    globalState.variables = globalState.variables.filter(v => v.key !== key);
    saveGlobalVariablesData(globalState);
    return true;
  }
  
  // 如果全局变量中没有，尝试从所有工作流变量中删除
  const workflowVars = getAllWorkflowVariables();
  for (const [workflowId, state] of Object.entries(workflowVars)) {
    if (state.variables.some(v => v.key === key)) {
      state.variables = state.variables.filter(v => v.key !== key);
      saveWorkflowVariablesData(state);
      return true;
    }
  }
  
  return false;
}

export function addBlackboardEvent(event: BlackboardEventData): boolean {
  // 事件不再持久化，只在内存中记录
  // 如果需要持久化事件，可以添加专门的事件存储
  return true;
}

// ========== 执行状态操作 ==========

export function getExecutionState(instanceId: string): ExecutionState | undefined {
  const data = loadData() as AppData & { executionStates?: Record<string, ExecutionState> };
  return data.executionStates?.[instanceId];
}

export function getAllExecutionStates(): Record<string, ExecutionState> {
  const data = loadData() as AppData & { executionStates?: Record<string, ExecutionState> };
  return data.executionStates || {};
}

export function saveExecutionState(state: ExecutionState): boolean {
  const data = loadData() as AppData & { executionStates?: Record<string, ExecutionState> };

  if (!data.executionStates) {
    data.executionStates = {};
  }

  data.executionStates[state.instanceId] = state;
  return saveData(data);
}

export function deleteExecutionState(instanceId: string): boolean {
  const data = loadData() as AppData & { executionStates?: Record<string, ExecutionState> };
  if (data.executionStates) {
    delete data.executionStates[instanceId];
  }
  return saveData(data);
}

export function cleanupExecutionStates(): number {
  const data = loadData() as AppData & { executionStates?: Record<string, ExecutionState> };
  if (!data.executionStates) return 0;

  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const [instanceId, state] of Object.entries(data.executionStates)) {
    const startedAt = new Date(state.startedAt).getTime();
    if (now - startedAt > maxAge) {
      delete data.executionStates[instanceId];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveData(data);
    log.info(`[Storage] Cleaned ${cleaned} expired execution states`);
  }

  return cleaned;
}

export function getDataDirectory(): string {
  return getDataDir();
}

// ========== 工作流执行日志类型 ==========

/** 节点执行日志条目 */
export interface NodeExecutionLogEntry {
  nodeId: string;
  nodeName: string;
  agentId?: string;
  agentName?: string;
  timeline: {
    startedAt: string;
    completedAt?: string;
    duration?: number;
  };
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  input: {
    prompt: string;
    variables: string[];
  };
  output: {
    raw: string;
    extracted: Record<string, unknown>;
  };
  error?: string;
  retryCount: number;
  protocolCommands: Array<{
    type: string;
    target?: string;
    request?: string;
    result?: string;
  }>;
}

/** 工作流执行日志 */
export interface WorkflowExecutionLog {
  logId: string;
  instanceId: string;
  workflowId: string;
  workflowName: string;
  triggerType: 'manual' | 'scheduled' | 'api';
  triggeredBy?: string;
  timeline: {
    startedAt: string;
    completedAt?: string;
    duration?: number;
  };
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  nodes: NodeExecutionLogEntry[];
  blackboardSnapshot?: {
    variables: Record<string, unknown>;
    events: Array<{ type: string; timestamp: string; data: unknown }>;
  };
  error?: string;
  metadata: {
    version: string;
    clientVersion: string;
    platform: string;
  };
}

/** 日志索引条目 */
export interface WorkflowLogIndexEntry {
  logId: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  duration?: number;
  nodeCount: number;
  errorCount: number;
  filePath: string;
}

/** 日志索引 */
export interface WorkflowLogIndex {
  logs: WorkflowLogIndexEntry[];
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    totalDuration: number;
    lastUpdated: string;
  };
  retentionDays: number;
}

// ========== 工作流日志目录操作 ==========

const WORKFLOW_LOGS_DIR = 'workflow-logs';
const WORKFLOW_LOGS_INDEX = 'index.json';

/** 获取日志目录路径 */
function getWorkflowLogsDir(): string {
  const logsDir = join(getDataDir(), WORKFLOW_LOGS_DIR);

  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
    log.info('[Storage] Created workflow logs directory:', logsDir);
  }

  return logsDir;
}

/** 生成日志文件名 */
function generateLogFileName(workflowId: string, startedAt: string): string {
  const date = new Date(startedAt);
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
  return `${workflowId}-${dateStr}-${timeStr}.json`;
}

/** 加载日志索引 */
function loadLogIndex(): WorkflowLogIndex {
  const indexPath = join(getWorkflowLogsDir(), WORKFLOW_LOGS_INDEX);

  try {
    if (!existsSync(indexPath)) {
      return {
        logs: [],
        stats: {
          totalRuns: 0,
          successfulRuns: 0,
          failedRuns: 0,
          totalDuration: 0,
          lastUpdated: new Date().toISOString()
        },
        retentionDays: 30
      };
    }

    const content = readFileSync(indexPath, 'utf-8');
    return JSON.parse(content) as WorkflowLogIndex;
  } catch (error) {
    log.error('[Storage] Failed to load log index:', error);
    return {
      logs: [],
      stats: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        totalDuration: 0,
        lastUpdated: new Date().toISOString()
      },
      retentionDays: 30
    };
  }
}

/** 保存日志索引 */
function saveLogIndex(index: WorkflowLogIndex): boolean {
  const indexPath = join(getWorkflowLogsDir(), WORKFLOW_LOGS_INDEX);

  try {
    index.stats.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(index, null, 2);
    writeFileSync(indexPath, content, 'utf-8');
    log.info('[Storage] Saved log index, total logs:', index.logs.length);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save log index:', error);
    return false;
  }
}

/** 保存工作流执行日志 */
export function saveWorkflowExecutionLog(executionLog: WorkflowExecutionLog): boolean {
  const logsDir = getWorkflowLogsDir();
  const fileName = generateLogFileName(executionLog.workflowId, executionLog.timeline.startedAt);
  const filePath = join(logsDir, fileName);

  try {
    // 保存日志文件
    const content = JSON.stringify(executionLog, null, 2);
    writeFileSync(filePath, content, 'utf-8');
    log.info('[Storage] Saved workflow log:', fileName);

    // 更新索引
    const index = loadLogIndex();

    const indexEntry: WorkflowLogIndexEntry = {
      logId: executionLog.logId,
      workflowId: executionLog.workflowId,
      workflowName: executionLog.workflowName,
      startedAt: executionLog.timeline.startedAt,
      completedAt: executionLog.timeline.completedAt,
      status: executionLog.status,
      duration: executionLog.timeline.duration,
      nodeCount: executionLog.nodes.length,
      errorCount: executionLog.nodes.filter(n => n.status === 'failed').length,
      filePath: fileName
    };

    // 检查是否已存在
    const existingIndex = index.logs.findIndex(l => l.logId === executionLog.logId);
    if (existingIndex >= 0) {
      index.logs[existingIndex] = indexEntry;
    } else {
      index.logs.unshift(indexEntry); // 最新的在前面
    }

    // 更新统计
    index.stats.totalRuns = index.logs.length;
    index.stats.successfulRuns = index.logs.filter(l => l.status === 'completed').length;
    index.stats.failedRuns = index.logs.filter(l => l.status === 'failed').length;
    index.stats.totalDuration = index.logs.reduce((sum, l) => sum + (l.duration || 0), 0);

    saveLogIndex(index);

    return true;
  } catch (error) {
    log.error('[Storage] Failed to save workflow log:', error);
    return false;
  }
}

/** 获取工作流执行日志 */
export function getWorkflowExecutionLog(logId: string): WorkflowExecutionLog | undefined {
  const index = loadLogIndex();
  const entry = index.logs.find(l => l.logId === logId);

  if (!entry) return undefined;

  const filePath = join(getWorkflowLogsDir(), entry.filePath);

  try {
    if (!existsSync(filePath)) return undefined;
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as WorkflowExecutionLog;
  } catch (error) {
    log.error('[Storage] Failed to load workflow log:', error);
    return undefined;
  }
}

/** 获取工作流执行日志列表 */
export function getWorkflowExecutionLogs(options?: {
  workflowId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): WorkflowLogIndexEntry[] {
  const index = loadLogIndex();

  let logs = index.logs;

  // 筛选
  if (options?.workflowId) {
    logs = logs.filter(l => l.workflowId === options.workflowId);
  }
  if (options?.status) {
    logs = logs.filter(l => l.status === options.status);
  }

  // 分页
  const offset = options?.offset || 0;
  const limit = options?.limit || 50;

  return logs.slice(offset, offset + limit);
}

/** 删除工作流执行日志 */
export function deleteWorkflowExecutionLog(logId: string): boolean {
  const index = loadLogIndex();
  const entry = index.logs.find(l => l.logId === logId);

  if (!entry) return false;

  try {
    // 删除文件
    const filePath = join(getWorkflowLogsDir(), entry.filePath);
    if (existsSync(filePath)) {
      const { unlinkSync } = require('fs');
      unlinkSync(filePath);
    }

    // 更新索引
    index.logs = index.logs.filter(l => l.logId !== logId);
    index.stats.totalRuns = index.logs.length;
    index.stats.successfulRuns = index.logs.filter(l => l.status === 'completed').length;
    index.stats.failedRuns = index.logs.filter(l => l.status === 'failed').length;

    saveLogIndex(index);

    log.info('[Storage] Deleted workflow log:', logId);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to delete workflow log:', error);
    return false;
  }
}

/** 清理过期日志 */
export function cleanupWorkflowExecutionLogs(retentionDays?: number): number {
  const index = loadLogIndex();
  const days = retentionDays || index.retentionDays || 30;
  const now = Date.now();
  const maxAge = days * 24 * 60 * 60 * 1000;

  let cleaned = 0;
  const logsToKeep: WorkflowLogIndexEntry[] = [];

  for (const entry of index.logs) {
    const startedAt = new Date(entry.startedAt).getTime();
    if (now - startedAt > maxAge) {
      // 删除文件
      try {
        const filePath = join(getWorkflowLogsDir(), entry.filePath);
        if (existsSync(filePath)) {
          const { unlinkSync } = require('fs');
          unlinkSync(filePath);
        }
        cleaned++;
      } catch (error) {
        log.warn('[Storage] Failed to delete old log file:', entry.filePath);
      }
    } else {
      logsToKeep.push(entry);
    }
  }

  if (cleaned > 0) {
    index.logs = logsToKeep;
    index.stats.totalRuns = index.logs.length;
    index.stats.successfulRuns = index.logs.filter(l => l.status === 'completed').length;
    index.stats.failedRuns = index.logs.filter(l => l.status === 'failed').length;
    saveLogIndex(index);
    log.info(`[Storage] Cleaned ${cleaned} expired workflow logs`);
  }

  return cleaned;
}

export function getWorkflowLogStats(): WorkflowLogIndex['stats'] {
  const index = loadLogIndex();
  return index.stats;
}

/** 重建日志索引 - 扫描日志文件并重建索引 */
export function rebuildWorkflowLogIndex(): number {
  const logsDir = getWorkflowLogsDir();
  const { readdirSync } = require('fs');

  let rebuilt = 0;
  const newIndex: WorkflowLogIndex = {
    logs: [],
    stats: {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalDuration: 0,
      lastUpdated: new Date().toISOString()
    },
    retentionDays: 30
  };

  try {
    const files = readdirSync(logsDir).filter((f: string) => f.endsWith('.json') && f !== WORKFLOW_LOGS_INDEX);

    for (const file of files) {
      try {
        const filePath = join(logsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const log = JSON.parse(content) as WorkflowExecutionLog;

        const entry: WorkflowLogIndexEntry = {
          logId: log.logId,
          workflowId: log.workflowId,
          workflowName: log.workflowName,
          startedAt: log.timeline.startedAt,
          completedAt: log.timeline.completedAt,
          status: log.status,
          duration: log.timeline.duration,
          nodeCount: log.nodes?.length || 0,
          errorCount: log.nodes?.filter(n => n.status === 'failed').length || 0,
          filePath: file
        };

        newIndex.logs.push(entry);
        rebuilt++;
      } catch (err) {
        log.warn('[Storage] Failed to parse log file:', file, err);
      }
    }

    // 按时间排序（最新的在前）
    newIndex.logs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    // 更新统计
    newIndex.stats.totalRuns = newIndex.logs.length;
    newIndex.stats.successfulRuns = newIndex.logs.filter(l => l.status === 'completed').length;
    newIndex.stats.failedRuns = newIndex.logs.filter(l => l.status === 'failed').length;
    newIndex.stats.totalDuration = newIndex.logs.reduce((sum, l) => sum + (l.duration || 0), 0);

    saveLogIndex(newIndex);
    log.info('[Storage] Rebuilt log index, total logs:', rebuilt);

  } catch (error) {
    log.error('[Storage] Failed to rebuild log index:', error);
  }

  return rebuilt;
}

// ========== MCP/A2A 协议配置 ==========

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  enabledTools?: string[];  // 已启用的工具列表
  disabledTools?: string[]; // 已禁用的工具列表
  createdAt?: string;
  updatedAt?: string;
}

/** MCP Server 运行时状态 */
export interface MCPServerStatus {
  id: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  availableTools: MCPTool[];
  lastHeartbeat: string;
  error?: string;
}

/** MCP 工具描述 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema?: any;
}

export interface A2AAgentConfig {
  id: string;
  name: string;
  endpoint: string;
  agentId: string;
  webhookUrl?: string;
  protocolType?: 'a2a-standard' | 'openclaw' | 'opencode' | 'ahivecore';
  apiKey?: string;
  sessionKey?: string;  // 会话标识符，用于维持 OpenClaw session
  enabled: boolean;
  customFields?: Record<string, any>;  // 动态字段存储
  createdAt?: string;
  updatedAt?: string;
}

/** A2A Agent Card - Agent 元数据描述 */
export interface A2AAgentCard {
  agentId: string;
  name: string;
  description: string;
  url: string;
  capabilities: Array<{ name: string; description: string }>;
  version: string;
}

/** A2A 任务状态 */
export interface A2ATaskStatus {
  id: string;
  status: 'pending' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  message?: {
    role: 'user' | 'agent';
    content: string;
  };
  error?: string;
  artifacts?: A2AArtifact[];
}

/** A2A 产物 */
export interface A2AArtifact {
  id: string;
  type: string;
  name?: string;
  content?: string;
  url?: string;
}

/** 协议配置数据 */
interface ProtocolConfigData {
  mcpServers: MCPServerConfig[];
  a2aAgents: A2AAgentConfig[];
  mcpApiConfigs?: MCPApiConfig[];  // 新增：MCP API 配置
  npmRegistry?: 'auto' | 'china' | 'official';
  mcpApiEndpoint?: string; // 新增：可配置的 MCP API 端点
  mcpInstructionTemplate?: {
    usage: string;
    url_pattern: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  // 邮件服务配置
  email?: {
    serviceUrl?: string;      // 邮件服务 API URL
    apiKey?: string;          // API Key（加密存储）
    from?: string;            // 发件人地址
  };
  lastUpdated: string;
}

// ========== MCP API 配置类型 ==========

/** MCP API 平台类型 */
export type MCPApiPlatformType = 'bailian' | 'openai' | 'anthropic';

/** MCP API 中的 MCP Server 配置 */
export interface MCPApiServerConfig {
  label: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
}

/** MCP API 用户配置实例 */
export interface MCPApiConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  platformType: MCPApiPlatformType;
  fieldValues: Record<string, any>;
  mcpServers: MCPApiServerConfig[];
  createdAt?: string;
  updatedAt?: string;
}

const PROTOCOL_CONFIG_FILE = 'protocol-config.json';

function getDefaultProtocolConfig(): ProtocolConfigData {
  return {
    mcpServers: [],
    a2aAgents: [],
    npmRegistry: 'auto',
    mcpApiEndpoint: 'http://127.0.0.1:3002', // 默认端点
    mcpInstructionTemplate: {
      usage: 'Call MCP tools via HTTP POST requests',
      url_pattern: '{apiEndpoint}/mcp/{serverId}/{toolName}', // 修复：增加 /mcp/
      method: 'POST',
      headers: {
        'X-Agent-Key': '{agentKey}',
        'Content-Type': 'application/json'
      },
      body: 'JSON object containing tool parameters'
    },
    lastUpdated: new Date().toISOString()
  };
}

export function getProtocolConfig(): ProtocolConfigData {
  const filePath = getFilePath(PROTOCOL_CONFIG_FILE);

  try {
    if (!existsSync(filePath)) {
      log.info('[Storage] Protocol config file not found, returning defaults');
      return getDefaultProtocolConfig();
    }

    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as ProtocolConfigData;

    log.info('[Storage] Loaded protocol config from:', filePath,
      'MCP servers:', data.mcpServers?.length || 0,
      'A2A agents:', data.a2aAgents?.length || 0);
    return data;
  } catch (error) {
    log.error('[Storage] Failed to load protocol config:', error);
    return getDefaultProtocolConfig();
  }
}

function saveProtocolConfigData(data: ProtocolConfigData): boolean {
  const filePath = getFilePath(PROTOCOL_CONFIG_FILE);

  try {
    data.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(data, null, 2);
    writeFileSync(filePath, content, 'utf-8');
    log.info('[Storage] Saved protocol config to:', filePath);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save protocol config:', error);
    return false;
  }
}

// 导出的保存函数
export function saveProtocolConfig(data: ProtocolConfigData): boolean {
  return saveProtocolConfigData(data);
}

// ========== MCP Server 操作 ==========

export function getMCPServers(): MCPServerConfig[] {
  const config = getProtocolConfig();
  return config.mcpServers || [];
}

export function getMCPServer(id: string): MCPServerConfig | undefined {
  const servers = getMCPServers();
  return servers.find(s => s.id === id);
}

export function saveMCPServer(server: MCPServerConfig): boolean {
  const config = getProtocolConfig();

  if (!config.mcpServers) {
    config.mcpServers = [];
  }

  const existingIndex = config.mcpServers.findIndex(s => s.id === server.id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    config.mcpServers[existingIndex] = {
      ...server,
      updatedAt: now
    };
  } else {
    config.mcpServers.push({
      ...server,
      createdAt: server.createdAt || now,
      updatedAt: now
    });
  }

  return saveProtocolConfigData(config);
}

export function deleteMCPServer(id: string): boolean {
  const config = getProtocolConfig();
  config.mcpServers = config.mcpServers.filter(s => s.id !== id);
  return saveProtocolConfigData(config);
}

export function toggleMCPServer(id: string, enabled: boolean): boolean {
  const config = getProtocolConfig();
  const server = config.mcpServers.find(s => s.id === id);
  if (server) {
    server.enabled = enabled;
    server.updatedAt = new Date().toISOString();
    return saveProtocolConfigData(config);
  }
  return false;
}

// ========== A2A Agent 操作 ==========

export function getA2AAgents(): A2AAgentConfig[] {
  const config = getProtocolConfig();
  return config.a2aAgents || [];
}

export function getA2AAgent(id: string): A2AAgentConfig | undefined {
  const agents = getA2AAgents();
  return agents.find(a => a.id === id);
}

export function saveA2AAgent(agent: A2AAgentConfig): boolean {
  const config = getProtocolConfig();

  if (!config.a2aAgents) {
    config.a2aAgents = [];
  }

  const existingIndex = config.a2aAgents.findIndex(a => a.id === agent.id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    config.a2aAgents[existingIndex] = {
      ...agent,
      updatedAt: now
    };
  } else {
    config.a2aAgents.push({
      ...agent,
      createdAt: agent.createdAt || now,
      updatedAt: now
    });
  }

  return saveProtocolConfigData(config);
}

export function deleteA2AAgent(id: string): boolean {
  const config = getProtocolConfig();
  config.a2aAgents = config.a2aAgents.filter(a => a.id !== id);
  return saveProtocolConfigData(config);
}

export function toggleA2AAgent(id: string, enabled: boolean): boolean {
  const config = getProtocolConfig();
  const agent = config.a2aAgents.find(a => a.id === id);
  if (agent) {
    agent.enabled = enabled;
    agent.updatedAt = new Date().toISOString();
    return saveProtocolConfigData(config);
  }
  return false;
}

// ========== MCP API 配置操作 ==========

export function getMCPApiConfigs(): MCPApiConfig[] {
  const config = getProtocolConfig();
  return config.mcpApiConfigs || [];
}

export function getMCPApiConfig(id: string): MCPApiConfig | undefined {
  const configs = getMCPApiConfigs();
  return configs.find(c => c.id === id);
}

export function saveMCPApiConfig(mcpApiConfig: MCPApiConfig): boolean {
  const config = getProtocolConfig();

  if (!config.mcpApiConfigs) {
    config.mcpApiConfigs = [];
  }

  const existingIndex = config.mcpApiConfigs.findIndex(c => c.id === mcpApiConfig.id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    config.mcpApiConfigs[existingIndex] = {
      ...mcpApiConfig,
      updatedAt: now
    };
  } else {
    config.mcpApiConfigs.push({
      ...mcpApiConfig,
      createdAt: mcpApiConfig.createdAt || now,
      updatedAt: now
    });
  }

  return saveProtocolConfigData(config);
}

export function deleteMCPApiConfig(id: string): boolean {
  const config = getProtocolConfig();
  config.mcpApiConfigs = config.mcpApiConfigs?.filter(c => c.id !== id) || [];
  return saveProtocolConfigData(config);
}

export function toggleMCPApiConfig(id: string, enabled: boolean): boolean {
  const config = getProtocolConfig();
  const mcpApiConfig = config.mcpApiConfigs?.find(c => c.id === id);
  if (mcpApiConfig) {
    mcpApiConfig.enabled = enabled;
    mcpApiConfig.updatedAt = new Date().toISOString();
    return saveProtocolConfigData(config);
  }
  return false;
}

// ========== Agent 技能持久化 ==========

// Agent 数据存储文件
const AGENTS_FILE = 'agents.json';

// Agent 持久化数据类型
export interface AgentPersistData {
  id: string;
  name: string;
  equippedSkills: string[];
  createdAt?: string;
  updatedAt: string;
}

export interface AgentsStorage {
  agents: AgentPersistData[];
  lastUpdated: string;
}

// 获取默认 Agent 存储
function getDefaultAgentsStorage(): AgentsStorage {
  return {
    agents: [],
    lastUpdated: new Date().toISOString()
  };
}

// 读取 Agent 存储
function getAgentsStorage(): AgentsStorage {
  const filePath = getFilePath(AGENTS_FILE);

  if (!existsSync(filePath)) {
    const defaultStorage = getDefaultAgentsStorage();
    writeFileSync(filePath, JSON.stringify(defaultStorage, null, 2), 'utf-8');
    return defaultStorage;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log.error('[Storage] Failed to read agents storage:', error);
    return getDefaultAgentsStorage();
  }
}

// 保存 Agent 存储
function saveAgentsStorage(storage: AgentsStorage): boolean {
  try {
    storage.lastUpdated = new Date().toISOString();
    const filePath = getFilePath(AGENTS_FILE);
    writeFileSync(filePath, JSON.stringify(storage, null, 2), 'utf-8');
    log.info('[Storage] Saved agents storage:', storage.agents.length, 'agents');
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save agents storage:', error);
    return false;
  }
}

// 获取所有 Agent
export function getAgents(): AgentPersistData[] {
  const storage = getAgentsStorage();
  return storage.agents || [];
}

// 获取单个 Agent
export function getAgent(id: string): AgentPersistData | undefined {
  const agents = getAgents();
  return agents.find(a => a.id === id);
}

// 保存 Agent
export function saveAgent(agent: AgentPersistData): boolean {
  const storage = getAgentsStorage();

  if (!storage.agents) {
    storage.agents = [];
  }

  const existingIndex = storage.agents.findIndex(a => a.id === agent.id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    storage.agents[existingIndex] = {
      ...agent,
      updatedAt: now
    };
  } else {
    storage.agents.push({
      ...agent,
      createdAt: agent.createdAt || now,
      updatedAt: now
    });
  }

  return saveAgentsStorage(storage);
}

// 更新 Agent 技能
export function updateAgentSkills(id: string, skills: string[]): boolean {
  const storage = getAgentsStorage();

  if (!storage.agents) {
    storage.agents = [];
  }

  const existingIndex = storage.agents.findIndex(a => a.id === id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    storage.agents[existingIndex].equippedSkills = skills;
    storage.agents[existingIndex].updatedAt = now;
  } else {
    // Agent 不存在，创建新记录
    storage.agents.push({
      id,
      name: '',
      equippedSkills: skills,
      createdAt: now,
      updatedAt: now
    });
  }

  return saveAgentsStorage(storage);
}

// 删除 Agent
export function deleteAgent(id: string): boolean {
  const storage = getAgentsStorage();
  storage.agents = storage.agents.filter(a => a.id !== id);
  return saveAgentsStorage(storage);
}

// 批量保存 Agents
export function saveAgents(agents: AgentPersistData[]): boolean {
  const storage: AgentsStorage = {
    agents,
    lastUpdated: new Date().toISOString()
  };
  return saveAgentsStorage(storage);
}

// ========== 工作流模板操作 ==========

const WORKFLOW_TEMPLATES_FILE = 'workflow-templates.json';

/** 加载模板库 */
function loadWorkflowTemplatesData(): WorkflowTemplateLibrary {
  const filePath = getFilePath(WORKFLOW_TEMPLATES_FILE);

  try {
    if (!existsSync(filePath)) {
      log.info('[Storage] Workflow templates file not found, returning empty library');
      return { version: '1.0.0', templates: [] };
    }

    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as WorkflowTemplateLibrary;

    log.info('[Storage] Loaded workflow templates from:', filePath, 'count:', data.templates?.length || 0);
    return data;
  } catch (error) {
    log.error('[Storage] Failed to load workflow templates:', error);
    return { version: '1.0.0', templates: [] };
  }
}

/** 保存模板库 */
function saveWorkflowTemplatesData(data: WorkflowTemplateLibrary): boolean {
  const filePath = getFilePath(WORKFLOW_TEMPLATES_FILE);

  try {
    const content = JSON.stringify(data, null, 2);
    writeFileSync(filePath, content, 'utf-8');
    log.info('[Storage] Saved workflow templates to:', filePath, 'count:', data.templates.length);
    return true;
  } catch (error) {
    log.error('[Storage] Failed to save workflow templates:', error);
    return false;
  }
}

/** 获取所有工作流模板 */
export function getWorkflowTemplates(): WorkflowTemplateData[] {
  const data = loadWorkflowTemplatesData();
  return data.templates || [];
}

/** 获取单个工作流模板 */
export function getWorkflowTemplate(templateId: string): WorkflowTemplateData | undefined {
  const templates = getWorkflowTemplates();
  return templates.find(t => t.id === templateId);
}

/** 保存工作流模板 */
export function saveWorkflowTemplate(template: WorkflowTemplateData): boolean {
  const data = loadWorkflowTemplatesData();

  if (!data.templates) {
    data.templates = [];
  }

  const existingIndex = data.templates.findIndex(t => t.id === template.id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    data.templates[existingIndex] = {
      ...template,
      createdAt: template.createdAt || now
    };
  } else {
    data.templates.push({
      ...template,
      createdAt: template.createdAt || now
    });
  }

  return saveWorkflowTemplatesData(data);
}

/** 删除工作流模板 */
export function deleteWorkflowTemplate(templateId: string): boolean {
  const data = loadWorkflowTemplatesData();
  data.templates = data.templates.filter(t => t.id !== templateId);
  return saveWorkflowTemplatesData(data);
}

// ========== 项目配置提示词生成 ==========

/**
 * 从工作流所有 variable 节点生成项目配置提示词文件
 * 
 * 生成规则：
 * - 公共信息（无 agentId）→ projectinfo_prompt.md
 * - 专用信息（有 agentId）→ projectinfo_{agentId}_prompt.md
 * 
 * 支持多个 variable 节点，合并所有变量
 */
function generateProjectPromptFiles(workflow: WorkflowData): void {
  // 找到所有 variable 节点
  const variableNodes = workflow.nodes.filter(n => n.type === 'variable');
  
  if (variableNodes.length === 0) {
    log.info('[Storage] No variable node found, skip generating project prompt files');
    return;
  }
  
  log.info(`[Storage] Found ${variableNodes.length} variable nodes in workflow ${workflow.id}`);
  
  // 获取工作流状态目录
  const workflowDir = getWorkflowDataDir(workflow.id);
  
  // 合并所有 variable 节点的变量（后面的节点覆盖前面的同名变量）
  const publicVarMap: Map<string, any> = new Map();  // 公共变量：key = 变量名
  const privateVarMap: Map<string, Map<string, any>> = new Map();  // 专用变量：key = agentId, value = Map<变量名, 变量>
  const allGroups: any[] = [];
  
  for (const node of variableNodes) {
    const config = (node as any).config?.variableConfig;
    
    if (!config) {
      log.info(`[Storage] No variableConfig in node ${node.id}, skip`);
      continue;
    }
    
    // 提取变量列表
    let nodeVariables: any[];
    
    if (config.version === 'v2' && Array.isArray(config.variables)) {
      nodeVariables = config.variables;
      log.info(`[Storage] Extracted ${config.variables.length} variables from V2 node ${node.id}`);
    } else if (config.name && config.value) {
      // 旧版单变量格式 - 转换为 V2 格式
      nodeVariables = [{
        name: config.name,
        value: config.value,
        type: config.type || 'string',
        enabled: true,
      }];
      log.info(`[Storage] Converted legacy variable ${config.name} from node ${node.id}`);
    } else {
      continue;
    }
    
    // 合并分组信息（去重）
    if (Array.isArray(config.groups)) {
      for (const group of config.groups) {
        if (!allGroups.find(g => g.id === group.id)) {
          allGroups.push(group);
        }
      }
    }
    
    // 处理变量（后面的覆盖前面的）
    for (const varItem of nodeVariables) {
      // 跳过禁用的变量
      if (varItem.enabled === false) {
        continue;
      }
      
      const varName = varItem.name || varItem.key || 'unknown';
      
      if (varItem.agentId) {
        // 专用参数：按 agentId 分组，同名变量覆盖
        if (!privateVarMap.has(varItem.agentId)) {
          privateVarMap.set(varItem.agentId, new Map());
        }
        privateVarMap.get(varItem.agentId)!.set(varName, varItem);
      } else {
        // 公共参数：同名变量覆盖
        publicVarMap.set(varName, varItem);
      }
    }
  }
  
  // 统计
  const publicVars = Array.from(publicVarMap.values());
  const privateVars = new Map<string, any[]>();
  for (const [agentId, varMap] of privateVarMap) {
    privateVars.set(agentId, Array.from(varMap.values()));
  }
  
  const totalVars = publicVars.length + Array.from(privateVars.values()).reduce((sum, arr) => sum + arr.length, 0);
  
  if (totalVars === 0) {
    log.info('[Storage] No variables found in any variable node, skip generating');
    return;
  }
  
  log.info(`[Storage] Total ${totalVars} unique variables (${publicVars.length} public, ${privateVars.size} private agents), ${allGroups.length} groups`);
  
  log.info(`[Storage] Public vars: ${publicVars.length}, Private agents: ${privateVars.size}`);
  
  // 生成公共信息文件（不加协作规范）
  if (publicVars.length > 0) {
    const content = generatePromptMarkdown(workflow, publicVars, allGroups, null, false);
    const filePath = join(workflowDir, 'projectinfo_prompt.md');
    writeFileSync(filePath, content, 'utf-8');
    log.info('[Storage] Generated public project prompt file:', filePath);
  }
  
  // 生成专用信息文件（加协作规范）
  for (const [agentId, vars] of privateVars) {
    if (vars.length > 0) {
      const content = generatePromptMarkdown(workflow, vars, allGroups, agentId, true);
      const filePath = join(workflowDir, `projectinfo_${agentId}_prompt.md`);
      writeFileSync(filePath, content, 'utf-8');
      log.info(`[Storage] Generated private project prompt file for ${agentId}: ${filePath}`);
    }
  }
  
  // 为指挥官（ahivecore）单独生成提示词文件（加协作规范）
  const ahivecoreContent = generatePromptMarkdown(workflow, publicVars, allGroups, 'ahivecore', true);
  const ahivecoreFilePath = join(workflowDir, 'projectinfo_ahivecore_prompt.md');
  writeFileSync(ahivecoreFilePath, ahivecoreContent, 'utf-8');
  log.info(`[Storage] Generated commander prompt file: ${ahivecoreFilePath}`);
}

/**
 * 生成提示词内容（简洁格式，适合 Agent 理解）
 * 
 * 格式设计原则：
 * 1. 简洁明了，变量名和值直接对应
 * 2. 不使用复杂 JSON 块，Agent 更容易解析
 * 3. 头部包含版本和时间，便于追踪
 */
function generatePromptMarkdown(
  workflow: WorkflowData,
  variables: any[],
  _groups: any[],
  agentId: string | null,
  includeCollaborationSpec: boolean = false
): string {
  const now = new Date();
  const timestamp = now.toISOString();
  
  // 文件头部
  const lines: string[] = [];
  
  // 版本和时间信息
  lines.push(`# 【${workflow.name}】项目配置信息`);
  lines.push('');
  lines.push(`版本: v1.0`);
  lines.push(`更新时间: ${timestamp}`);
  lines.push(`工作流ID: ${workflow.id}`);
  
  if (agentId) {
    lines.push(`适用智能体: ${agentId}`);
  } else {
    lines.push(`适用智能体: 全部`);
  }
  
  lines.push('');
  lines.push('---');
  lines.push('');
  
  // 配置内容
  lines.push('以下是本项目的关键配置参数，请在执行任务时参考使用：');
  lines.push('');
  
  // 直接列出变量
  for (const varItem of variables) {
    const name = varItem.name || varItem.key || 'unknown';
    let value = varItem.value || '';
    
    // 敏感信息隐藏
    if (varItem.sensitive) {
      lines.push(`${name}: [已配置，值隐藏]`);
      if (varItem.description) {
        lines.push(`  # ${varItem.description}`);
      }
      continue;
    }
    
    // 处理 JSON 类型 - 展开为多行
    if (varItem.type === 'json' || varItem.type === 'array' || varItem.type === 'object') {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          // 展开对象为多行
          addObjectToLines(lines, name, parsed, 0);
          lines.push('');
          continue;
        } else if (Array.isArray(parsed)) {
          // 数组直接显示
          lines.push(`${name}: ${JSON.stringify(parsed)}`);
          if (varItem.description) {
            lines.push(`  # ${varItem.description}`);
          }
          continue;
        }
      } catch {
        // 解析失败，保持原样
      }
    }
    
    // 普通值
    lines.push(`${name}: ${value}`);
    if (varItem.description) {
      lines.push(`  # ${varItem.description}`);
    }
  }
  
  lines.push('');
  lines.push('---');
  lines.push('');
  
  // 只在专用提示词中追加协作规范
  if (includeCollaborationSpec && agentId) {
    const collaborationSpec = loadCollaborationSpec(agentId);
    if (collaborationSpec) {
      lines.push(collaborationSpec);
      lines.push('');
    }
  }
  
  lines.push('*此配置文件由工作流系统自动生成，请勿手动修改*');
  
  return lines.join('\n');
}

/**
 * 加载协作规范
 * - 指挥官（agentId 为 null 或 'ahivecore'）：加载 Commander-Workflow-Collaboration-Specification.md
 * - 执行 Agent：加载 Execution-Agent-Workflow-Collaboration-Specification.md
 */
function loadCollaborationSpec(agentId: string | null): string {
  const isCommander = !agentId || agentId === 'ahivecore';
  const specFileName = isCommander 
    ? 'Commander-Workflow-Collaboration-Specification.md'
    : 'Execution-Agent-Workflow-Collaboration-Specification.md';
  
  // 协作规范文件放在 workflow-states 根目录下
  const workflowStatesDir = getWorkflowStatesDir();
  const specFilePath = join(workflowStatesDir, specFileName);
  
  log.info(`[Storage] 尝试加载协作规范: ${specFilePath}`);
  
  if (existsSync(specFilePath)) {
    const content = readFileSync(specFilePath, 'utf-8');
    log.info(`[Storage] ✅ 成功加载协作规范: ${specFileName}`);
    return `# 工作流协作规范\n\n${content}`;
  }
  
  log.warn(`[Storage] ⚠️ 协作规范文件不存在: ${specFilePath}`);
  return '';
}

/**
 * 格式化值（简化显示，支持嵌套展开）
 */
function formatValue(value: any, indent: number = 0): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const prefix = '  '.repeat(indent);
  
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      // 数组：直接显示 JSON
      return JSON.stringify(value);
    } else {
      // 对象：展开为多行
      const lines: string[] = [];
      for (const [k, v] of Object.entries(value)) {
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          // 嵌套对象：递归展开
          lines.push(`${prefix}${k}:`);
          lines.push(formatValue(v, indent + 1));
        } else {
          lines.push(`${prefix}${k}: ${formatValue(v, 0)}`);
        }
      }
      return lines.join('\n');
    }
  }
  
  return String(value);
}

/**
 * 将对象添加到行数组（递归展开嵌套对象）
 */
function addObjectToLines(lines: string[], name: string, obj: Record<string, any>, indent: number): void {
  const prefix = '  '.repeat(indent);
  lines.push(`${prefix}${name}:`);
  
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      // 嵌套对象：递归展开
      addObjectToLines(lines, k, v, indent + 1);
    } else if (Array.isArray(v)) {
      // 数组：直接显示 JSON
      lines.push(`${prefix}  ${k}: ${JSON.stringify(v)}`);
    } else {
      // 普通值
      lines.push(`${prefix}  ${k}: ${v}`);
    }
  }
}

/**
 * 项目配置文件元数据（用于心跳检测）
 */
export interface ProjectPromptMeta {
  agentId: string;  // 'public' 表示公共配置，其他值表示特定 Agent 的配置
  currentNodeId?: string;
  nodeStatus?: string;
  version: number;
  mtime: number;
  filePath: string;
}

/**
 * 获取项目配置文件路径
 * @param workflowId 工作流 ID
 * @param type 配置类型：'public' 表示公共配置，其他值表示特定 Agent 的配置
 * @returns 配置文件的完整路径
 */
export function getProjectPromptPath(workflowId: string, type: string = 'public'): string {
  const workflowDir = getWorkflowDataDir(workflowId);
  
  if (type === 'public') {
    return join(workflowDir, 'projectinfo_prompt.md');
  } else {
    // 特定 Agent 的配置文件
    return join(workflowDir, `projectinfo_${type}_prompt.md`);
  }
}

/**
 * 获取工作流的项目配置文件元数据
 * 用于心跳发送，让 AHIVECORE 检测是否需要更新
 */
export function getProjectPromptMeta(workflowId: string): ProjectPromptMeta[] {
  const workflowDir = getWorkflowDataDir(workflowId);
  const metaList: ProjectPromptMeta[] = [];
  
  // 检查公共配置文件
  const publicFile = join(workflowDir, 'projectinfo_prompt.md');
  if (existsSync(publicFile)) {
    const stats = statSync(publicFile);
    const content = readFileSync(publicFile, 'utf-8');
    const version = extractVersionFromMarkdown(content);
    
    metaList.push({
      agentId: 'public',  // 使用 'public' 而不是 null，与 AHIVECORE 的逻辑保持一致
      version,
      mtime: stats.mtimeMs,
      filePath: publicFile,
    });
  }
  
  // 检查专用配置文件（排除公共配置文件 projectinfo_prompt.md）
  const files = readdirSync(workflowDir).filter(f => 
    f.startsWith('projectinfo_') && 
    f.endsWith('_prompt.md') && 
    f !== 'projectinfo_prompt.md'  // 排除公共配置
  );
  
  for (const file of files) {
    const filePath = join(workflowDir, file);
    const stats = statSync(filePath);
    const content = readFileSync(filePath, 'utf-8');
    const version = extractVersionFromMarkdown(content);
    
    // 从文件名提取 agentId: projectinfo_{agentId}_prompt.md
    const match = file.match(/projectinfo_([^_]+)_prompt\.md/);
    const agentId = match ? match[1] : 'unknown';
    
    metaList.push({
      agentId,
      version,
      mtime: stats.mtimeMs,
      filePath,
    });
  }
  
  return metaList;
}

/**
 * 从 Markdown 内容提取版本号
 */
function extractVersionFromMarkdown(content: string): number {
  const match = content.match(/版本:\s*v(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * 心跳数据格式（发送到 AHIVECORE）
 */
export interface WorkflowHeartbeatData {
  workflowId: string;
  status: string;
  timestamp: number;
  projectPrompts: ProjectPromptMeta[];
  participatingAgents?: string[];  // 参与工作流的 Agent ID 列表
}

/**
 * 发送心跳到 AHIVECORE
 */
export async function sendHeartbeatToAHIVECORE(
  workflowId: string,
  status: string,
  ahivecoreEndpoint: string = 'http://localhost:18790'
): Promise<{
  success: boolean;
  timestamp: number;
  agents?: Array<{
    agentId: string;
    status: string;
    currentTaskId: string | null;
    hasTask: boolean;
  }>;
}> {
  const projectPrompts = getProjectPromptMeta(workflowId);
  
  // 获取参与工作流的 Agent 列表
  const workflow = getWorkflow(workflowId);
  const participatingAgents = extractParticipatingAgents(workflow);
  
  const heartbeatData: WorkflowHeartbeatData = {
    workflowId,
    status,
    timestamp: Date.now(),
    projectPrompts,
    participatingAgents,
  };
  
  try {
    const response = await fetch(`${ahivecoreEndpoint}/api/workflow/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(heartbeatData),
    });
    
    if (!response.ok) {
      log.error('[Heartbeat] AHIVECORE returned error:', response.status);
      return { success: false, timestamp: Date.now() };
    }
    
    return await response.json();
  } catch (error) {
    log.error('[Heartbeat] Failed to send heartbeat to AHIVECORE:', error);
    return { success: false, timestamp: Date.now() };
  }
}

/**
 * 从工作流定义中提取参与的 Agent ID 列表
 */
function extractParticipatingAgents(workflow: WorkflowData | undefined): string[] {
  if (!workflow) {
    return [];
  }
  
  const agentIds = new Set<string>();
  
  for (const node of workflow.nodes) {
    // 从节点的 agentId 字段提取
    if (node.agentId) {
      agentIds.add(node.agentId);
    }
    // 从节点配置中提取
    if (node.config?.agentId) {
      agentIds.add(node.config.agentId);
    }
  }
  
  return Array.from(agentIds);
}