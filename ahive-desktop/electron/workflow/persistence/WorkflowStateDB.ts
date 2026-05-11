/**
 * 工作流状态数据库管理
 * 使用 SQLite 存储工作流实例和节点执行状态
 */

import type Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// 动态导入 better-sqlite3
const Database = require('better-sqlite3');

/**
 * 工作流实例状态
 */
export interface WorkflowInstance {
  instanceId: string;
  workflowId: string;
  workflowName?: string;
  projectId?: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt: string;
  pausedAt?: string;
  completedAt?: string;
  currentNodeId?: string;
  currentNodeName?: string;
  interruptReason?: string;
  interruptAt?: string;
  interruptStack?: string;
  executionPath?: string[];
  variables?: Record<string, any>;
  triggeredBy?: string;
  updatedAt: string;
}

/**
 * 节点执行状态
 */
export interface NodeExecution {
  id?: number;
  instanceId: string;
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  input?: any;
  output?: any;
  error?: string;
  errorStack?: string;
  retryCount?: number;
  maxRetries?: number;
  agentId?: string;
  agentName?: string;
  prompt?: string;
  response?: string;
  duration?: number;
  childNodes?: string[];
  updatedAt: string;
}

/**
 * 工作流统计信息
 */
export interface WorkflowStats {
  workflowId: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  avgDurationMs?: number;
}

/**
 * 工作流产出物
 */
export interface WorkflowOutput {
  id?: number;
  instanceId: string;
  nodeId: string;
  nodeName?: string;
  outputType: 'file' | 'directory' | 'document' | 'code' | 'config';
  outputName: string;
  outputPath?: string;
  outputContent?: string;
  fileSize?: number;
  fileFormat?: string;
  encoding?: string;
  agentId?: string;
  agentName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 工作流状态数据库管理类
 */
export class WorkflowStateDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保目录存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 打开数据库
    this.db = new Database(dbPath);
    
    // 启用 WAL 模式（提高性能）
    this.db.pragma('journal_mode = WAL');
    
    // 创建表
    this.createTables();
    
    console.log(`[WorkflowStateDB] Database initialized: ${dbPath}`);
  }

  /**
   * 创建数据库表
   */
  private createTables(): void {
    // 创建工作流实例表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_instances (
        instance_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT,
        project_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        paused_at TEXT,
        completed_at TEXT,
        current_node_id TEXT,
        current_node_name TEXT,
        interrupt_reason TEXT,
        interrupt_at TEXT,
        interrupt_stack TEXT,
        execution_path TEXT,
        variables TEXT,
        triggered_by TEXT,
        updated_at TEXT NOT NULL
      )
    `);

    // 创建节点执行状态表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_name TEXT,
        node_type TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        input TEXT,
        output TEXT,
        error TEXT,
        error_stack TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        agent_id TEXT,
        agent_name TEXT,
        prompt TEXT,
        response TEXT,
        duration INTEGER,
        child_nodes TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id)
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_instances_status 
      ON workflow_instances(status)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_instances_workflow 
      ON workflow_instances(workflow_id)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_instances_started 
      ON workflow_instances(started_at)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nodes_instance 
      ON node_executions(instance_id)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nodes_status 
      ON node_executions(status)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nodes_node 
      ON node_executions(instance_id, node_id)
    `);

    // 创建产出物表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_name TEXT,
        output_type TEXT NOT NULL,
        output_name TEXT NOT NULL,
        output_path TEXT,
        output_content TEXT,
        file_size INTEGER,
        file_format TEXT,
        encoding TEXT DEFAULT 'utf-8',
        agent_id TEXT,
        agent_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id)
      )
    `);

    // 创建产出物索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_outputs_instance 
      ON workflow_outputs(instance_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_outputs_node 
      ON workflow_outputs(instance_id, node_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_outputs_type 
      ON workflow_outputs(output_type)
    `);

    // 创建任务拆解表（Agent自主性升级）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_decompositions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        parent_task_id TEXT NOT NULL,
        proposal_id TEXT UNIQUE,
        decomposition_plan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sub_tasks TEXT,
        approved_by TEXT,
        approved_at TEXT,
        rejection_reason TEXT,
        rejection_count INTEGER DEFAULT 0,
        merged_output TEXT,
        submitted_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id)
      )
    `);

    // 创建任务拆解索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decompositions_instance 
      ON task_decompositions(instance_id)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decompositions_node 
      ON task_decompositions(instance_id, node_id)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decompositions_status 
      ON task_decompositions(status)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decompositions_proposal 
      ON task_decompositions(proposal_id)
    `);
  }

  // ==================== 实例管理 ====================

  /**
   * 创建新实例
   */
  createInstance(instance: WorkflowInstance): void {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_instances (
        instance_id, workflow_id, workflow_name, project_id,
        status, started_at, current_node_id, current_node_name,
        execution_path, variables, triggered_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      instance.instanceId,
      instance.workflowId,
      instance.workflowName || null,
      instance.projectId || null,
      instance.status,
      instance.startedAt,
      instance.currentNodeId || null,
      instance.currentNodeName || null,
      instance.executionPath ? JSON.stringify(instance.executionPath) : null,
      instance.variables ? JSON.stringify(instance.variables) : null,
      instance.triggeredBy || null,
      instance.updatedAt
    );

    console.log(`[WorkflowStateDB] Created instance: ${instance.instanceId}`);
  }

  /**
   * 更新实例状态
   */
  updateInstanceStatus(
    instanceId: string,
    status: string,
    currentNodeId?: string,
    currentNodeName?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE workflow_instances 
      SET status = ?, 
          current_node_id = ?, 
          current_node_name = ?,
          updated_at = ?
      WHERE instance_id = ?
    `);

    stmt.run(
      status,
      currentNodeId || null,
      currentNodeName || null,
      new Date().toISOString(),
      instanceId
    );
  }

  /**
   * 暂停实例
   */
  pauseInstance(instanceId: string, reason?: string): void {
    const stmt = this.db.prepare(`
      UPDATE workflow_instances 
      SET status = 'paused', 
          paused_at = ?,
          interrupt_reason = ?,
          updated_at = ?
      WHERE instance_id = ?
    `);

    stmt.run(
      new Date().toISOString(),
      reason || null,
      new Date().toISOString(),
      instanceId
    );
  }

  /**
   * 完成实例
   */
  completeInstance(
    instanceId: string,
    success: boolean,
    error?: string,
    errorStack?: string
  ): void {
    const status = success ? 'completed' : 'failed';
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE workflow_instances 
      SET status = ?, 
          completed_at = ?,
          interrupt_at = ?,
          interrupt_reason = ?,
          interrupt_stack = ?,
          updated_at = ?
      WHERE instance_id = ?
    `);

    stmt.run(
      status,
      now,
      success ? null : now,  // 失败时设置 interrupt_at
      error || null,
      errorStack || null,
      now,
      instanceId
    );

    console.log(`[WorkflowStateDB] Completed instance: ${instanceId}, status: ${status}`);
  }

  /**
   * 获取实例
   */
  getInstance(instanceId: string): WorkflowInstance | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_instances WHERE instance_id = ?
    `);

    const row = stmt.get(instanceId) as any;
    if (!row) return null;

    return this.rowToInstance(row);
  }

  /**
   * 获取未完成的实例
   */
  getIncompleteInstances(): WorkflowInstance[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_instances 
      WHERE status IN ('running', 'paused', 'failed')
      ORDER BY started_at DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => this.rowToInstance(row));
  }

  /**
   * 获取所有工作流实例
   */
  getAllInstances(): WorkflowInstance[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_instances 
      ORDER BY started_at DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => this.rowToInstance(row));
  }

  /**
   * 删除单个工作流实例
   */
  deleteInstance(instanceId: string): void {
    // 先删除节点执行记录
    const deleteNodes = this.db.prepare(`
      DELETE FROM node_executions WHERE instance_id = ?
    `);
    deleteNodes.run(instanceId);

    // 再删除产出物
    const deleteOutputs = this.db.prepare(`
      DELETE FROM workflow_outputs WHERE instance_id = ?
    `);
    deleteOutputs.run(instanceId);

    // 最后删除实例
    const deleteInstance = this.db.prepare(`
      DELETE FROM workflow_instances WHERE instance_id = ?
    `);
    deleteInstance.run(instanceId);
  }

  /**
   * 删除工作流的所有实例
   */
  deleteAllInstances(workflowId: string): number {
    // 获取该工作流的所有实例ID
    const getInstances = this.db.prepare(`
      SELECT instance_id FROM workflow_instances WHERE workflow_id = ?
    `);
    const instances = getInstances.all(workflowId) as any[];

    // 删除每个实例
    for (const instance of instances) {
      this.deleteInstance(instance.instance_id);
    }

    return instances.length;
  }

  /**
   * 更新执行路径
   */
  updateExecutionPath(instanceId: string, path: string[]): void {
    const stmt = this.db.prepare(`
      UPDATE workflow_instances 
      SET execution_path = ?, updated_at = ?
      WHERE instance_id = ?
    `);

    stmt.run(
      JSON.stringify(path),
      new Date().toISOString(),
      instanceId
    );
  }

  /**
   * 更新变量
   */
  updateVariables(instanceId: string, variables: Record<string, any>): void {
    const stmt = this.db.prepare(`
      UPDATE workflow_instances 
      SET variables = ?, updated_at = ?
      WHERE instance_id = ?
    `);

    stmt.run(
      JSON.stringify(variables),
      new Date().toISOString(),
      instanceId
    );
  }

  // ==================== 节点管理 ====================

  /**
   * 开始执行节点
   */
  startNode(
    instanceId: string,
    nodeId: string,
    nodeName: string,
    nodeType?: string,
    input?: any
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO node_executions (
        instance_id, node_id, node_name, node_type,
        status, started_at, input, updated_at
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
    `);

    stmt.run(
      instanceId,
      nodeId,
      nodeName,
      nodeType || null,
      new Date().toISOString(),
      input ? JSON.stringify(input) : null,
      new Date().toISOString()
    );
  }

  /**
   * 完成节点
   */
  completeNode(
    instanceId: string,
    nodeId: string,
    output?: any,
    error?: string,
    errorStack?: string
  ): void {
    const status = error ? 'failed' : 'completed';
    const now = new Date().toISOString();

    // 获取开始时间计算时长
    const nodeStmt = this.db.prepare(`
      SELECT started_at FROM node_executions 
      WHERE instance_id = ? AND node_id = ? AND status = 'running'
      ORDER BY started_at DESC LIMIT 1
    `);
    
    const nodeRow = nodeStmt.get(instanceId, nodeId) as any;
    let duration = null;
    if (nodeRow && nodeRow.started_at) {
      duration = Date.now() - new Date(nodeRow.started_at).getTime();
    }

    const stmt = this.db.prepare(`
      UPDATE node_executions 
      SET status = ?, 
          completed_at = ?,
          output = ?,
          error = ?,
          error_stack = ?,
          duration = ?,
          updated_at = ?
      WHERE instance_id = ? AND node_id = ? AND status = 'running'
    `);

    stmt.run(
      status,
      now,
      output ? JSON.stringify(output) : null,
      error || null,
      errorStack || null,
      duration,
      now,
      instanceId,
      nodeId
    );
  }

  /**
   * 更新节点 Agent 信息
   */
  updateNodeAgentInfo(
    instanceId: string,
    nodeId: string,
    agentId: string,
    agentName?: string,
    prompt?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE node_executions 
      SET agent_id = ?, agent_name = ?, prompt = ?, updated_at = ?
      WHERE instance_id = ? AND node_id = ? AND status = 'running'
    `);

    stmt.run(
      agentId,
      agentName || null,
      prompt || null,
      new Date().toISOString(),
      instanceId,
      nodeId
    );
  }

  /**
   * 更新节点响应
   */
  updateNodeResponse(
    instanceId: string,
    nodeId: string,
    response: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE node_executions 
      SET response = ?, updated_at = ?
      WHERE instance_id = ? AND node_id = ? AND status = 'running'
    `);

    stmt.run(
      response,
      new Date().toISOString(),
      instanceId,
      nodeId
    );
  }

  /**
   * 更新节点状态和输出（用于审核节点等需要中间状态的场景）
   * 同时设置 completed_at 和 duration
   */
  updateNodeStatus(
    instanceId: string,
    nodeId: string,
    status: string,
    output?: any
  ): void {
    const now = new Date().toISOString();

    // 获取开始时间计算时长
    const nodeStmt = this.db.prepare(`
      SELECT started_at FROM node_executions 
      WHERE instance_id = ? AND node_id = ? AND status = 'running'
      ORDER BY started_at DESC LIMIT 1
    `);
    
    const nodeRow = nodeStmt.get(instanceId, nodeId) as any;
    let duration = null;
    if (nodeRow && nodeRow.started_at) {
      duration = Date.now() - new Date(nodeRow.started_at).getTime();
    }

    const stmt = this.db.prepare(`
      UPDATE node_executions 
      SET status = ?, output = ?, completed_at = ?, duration = ?, updated_at = ?
      WHERE instance_id = ? AND node_id = ? AND status = 'running'
    `);

    stmt.run(
      status,
      output ? JSON.stringify(output) : null,
      now,
      duration,
      now,
      instanceId,
      nodeId
    );
  }

  /**
   * 获取节点状态
   */
  getNodeStatus(instanceId: string, nodeId: string): NodeExecution | null {
    const stmt = this.db.prepare(`
      SELECT * FROM node_executions 
      WHERE instance_id = ? AND node_id = ?
      ORDER BY started_at DESC LIMIT 1
    `);

    const row = stmt.get(instanceId, nodeId) as any;
    if (!row) return null;

    return this.rowToNode(row);
  }

  /**
   * 获取实例的所有节点状态
   */
  getAllNodes(instanceId: string): NodeExecution[] {
    const stmt = this.db.prepare(`
      SELECT * FROM node_executions 
      WHERE instance_id = ?
      ORDER BY started_at
    `);

    const rows = stmt.all(instanceId) as any[];
    return rows.map(row => this.rowToNode(row));
  }

  // ==================== 查询 ====================

  /**
   * 获取工作流执行统计
   */
  getWorkflowStats(workflowId: string): WorkflowStats {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        AVG(CASE WHEN status = 'completed' 
            THEN (julianday(completed_at) - julianday(started_at)) * 86400000 
            END) as avg_duration_ms
      FROM workflow_instances
      WHERE workflow_id = ?
    `);

    const row = stmt.get(workflowId) as any;

    return {
      workflowId,
      totalCount: row.total_count || 0,
      successCount: row.success_count || 0,
      failedCount: row.failed_count || 0,
      avgDurationMs: row.avg_duration_ms || undefined,
    };
  }

  /**
   * 获取执行历史
   */
  getExecutionHistory(workflowId: string, limit: number = 10): WorkflowInstance[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_instances 
      WHERE workflow_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(workflowId, limit) as any[];
    return rows.map(row => this.rowToInstance(row));
  }

  /**
   * 清理旧数据
   */
  cleanupOldData(daysToKeep: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString();

    // 删除节点记录
    const deleteNodes = this.db.prepare(`
      DELETE FROM node_executions 
      WHERE instance_id IN (
        SELECT instance_id FROM workflow_instances 
        WHERE status IN ('completed', 'failed') 
        AND completed_at < ?
      )
    `);
    const nodesResult = deleteNodes.run(cutoffStr);

    // 删除实例
    const deleteInstances = this.db.prepare(`
      DELETE FROM workflow_instances 
      WHERE status IN ('completed', 'failed') 
      AND completed_at < ?
    `);
    const instancesResult = deleteInstances.run(cutoffStr);

    console.log(`[WorkflowStateDB] Cleaned up ${instancesResult.changes} instances, ${nodesResult.changes} nodes`);
  }

  // ==================== 辅助方法 ====================

  /**
   * 数据库行转换为实例对象
   */
  private rowToInstance(row: any): WorkflowInstance {
    return {
      instanceId: row.instance_id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      projectId: row.project_id,
      status: row.status,
      startedAt: row.started_at,
      pausedAt: row.paused_at,
      completedAt: row.completed_at,
      currentNodeId: row.current_node_id,
      currentNodeName: row.current_node_name,
      interruptReason: row.interrupt_reason,
      interruptAt: row.interrupt_at,
      interruptStack: row.interrupt_stack,
      executionPath: row.execution_path ? JSON.parse(row.execution_path) : undefined,
      variables: row.variables ? JSON.parse(row.variables) : undefined,
      triggeredBy: row.triggered_by,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 数据库行转换为节点对象
   */
  private rowToNode(row: any): NodeExecution {
    return {
      id: row.id,
      instanceId: row.instance_id,
      nodeId: row.node_id,
      nodeName: row.node_name,
      nodeType: row.node_type,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      input: row.input ? JSON.parse(row.input) : undefined,
      output: row.output ? JSON.parse(row.output) : undefined,
      error: row.error,
      errorStack: row.error_stack,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      agentId: row.agent_id,
      agentName: row.agent_name,
      prompt: row.prompt,
      response: row.response,
      duration: row.duration,
      childNodes: row.child_nodes ? JSON.parse(row.child_nodes) : undefined,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 关闭数据库
   */
  // ==================== 产出物管理 ====================

  /**
   * 添加产出物
   */
  addOutput(output: WorkflowOutput): void {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_outputs (
        instance_id, node_id, node_name, output_type, output_name,
        output_path, output_content, file_size, file_format, encoding,
        agent_id, agent_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      output.instanceId,
      output.nodeId,
      output.nodeName || null,
      output.outputType,
      output.outputName,
      output.outputPath || null,
      output.outputContent || null,
      output.fileSize || null,
      output.fileFormat || null,
      output.encoding || 'utf-8',
      output.agentId || null,
      output.agentName || null,
      output.createdAt,
      output.updatedAt
    );
  }

  /**
   * 批量添加产出物
   */
  addOutputs(outputs: WorkflowOutput[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_outputs (
        instance_id, node_id, node_name, output_type, output_name,
        output_path, output_content, file_size, file_format, encoding,
        agent_id, agent_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((outputs: WorkflowOutput[]) => {
      for (const output of outputs) {
        stmt.run(
          output.instanceId,
          output.nodeId,
          output.nodeName || null,
          output.outputType,
          output.outputName,
          output.outputPath || null,
          output.outputContent || null,
          output.fileSize || null,
          output.fileFormat || null,
          output.encoding || 'utf-8',
          output.agentId || null,
          output.agentName || null,
          output.createdAt,
          output.updatedAt
        );
      }
    });

    insertMany(outputs);
  }

  /**
   * 获取实例的所有产出物
   */
  getOutputs(instanceId: string): WorkflowOutput[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_outputs 
      WHERE instance_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(instanceId) as any[];
    return rows.map(row => this.rowToOutput(row));
  }

  /**
   * 获取节点的产出物
   */
  getNodeOutputs(instanceId: string, nodeId: string): WorkflowOutput[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_outputs 
      WHERE instance_id = ? AND node_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(instanceId, nodeId) as any[];
    return rows.map(row => this.rowToOutput(row));
  }

  /**
   * 按类型获取产出物
   */
  getOutputsByType(instanceId: string, outputType: string): WorkflowOutput[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_outputs 
      WHERE instance_id = ? AND output_type = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(instanceId, outputType) as any[];
    return rows.map(row => this.rowToOutput(row));
  }

  /**
   * 删除产出物
   */
  deleteOutput(outputId: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM workflow_outputs WHERE id = ?
    `);
    stmt.run(outputId);
  }

  /**
   * 删除实例的所有产出物
   */
  deleteOutputs(instanceId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM workflow_outputs WHERE instance_id = ?
    `);
    stmt.run(instanceId);
  }

  /**
   * 获取产出物统计
   */
  getOutputStats(instanceId: string): { [type: string]: number } {
    const stmt = this.db.prepare(`
      SELECT output_type, COUNT(*) as count
      FROM workflow_outputs
      WHERE instance_id = ?
      GROUP BY output_type
    `);

    const rows = stmt.all(instanceId) as any[];
    const stats: { [type: string]: number } = {};
    for (const row of rows) {
      stats[row.output_type] = row.count;
    }
    return stats;
  }

  /**
   * 行数据转产出物对象
   */
  private rowToOutput(row: any): WorkflowOutput {
    return {
      id: row.id,
      instanceId: row.instance_id,
      nodeId: row.node_id,
      nodeName: row.node_name,
      outputType: row.output_type,
      outputName: row.output_name,
      outputPath: row.output_path,
      outputContent: row.output_content,
      fileSize: row.file_size,
      fileFormat: row.file_format,
      encoding: row.encoding,
      agentId: row.agent_id,
      agentName: row.agent_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ==================== 任务拆解管理 ====================

  /**
   * 创建拆解提案
   */
  createDecomposition(decomposition: TaskDecomposition): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_decompositions (
        instance_id, node_id, parent_task_id, proposal_id,
        decomposition_plan, status, sub_tasks, rejection_count,
        submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      decomposition.instanceId,
      decomposition.nodeId,
      decomposition.parentTaskId,
      decomposition.proposalId || null,
      decomposition.decompositionPlan,
      decomposition.status || 'pending',
      decomposition.subTasks ? JSON.stringify(decomposition.subTasks) : null,
      decomposition.rejectionCount || 0,
      decomposition.submittedAt
    );

    console.log(`[WorkflowStateDB] Created decomposition: ${decomposition.proposalId}`);
  }

  /**
   * 更新拆解状态
   */
  updateDecompositionStatus(
    proposalId: string,
    status: string,
    approvedBy?: string,
    rejectionReason?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE task_decompositions 
      SET status = ?, 
          approved_by = ?, 
          approved_at = ?, 
          rejection_reason = ?,
          rejection_count = rejection_count + ?,
          updated_at = ?
      WHERE proposal_id = ?
    `);

    const isRejection = status === 'rejected';
    stmt.run(
      status,
      approvedBy || null,
      status === 'approved' ? new Date().toISOString() : null,
      rejectionReason || null,
      isRejection ? 1 : 0,
      new Date().toISOString(),
      proposalId
    );
  }

  /**
   * 更新子任务状态
   */
  updateDecompositionSubTasks(
    proposalId: string,
    subTasks: SubTaskState[]
  ): void {
    const stmt = this.db.prepare(`
      UPDATE task_decompositions 
      SET sub_tasks = ?, updated_at = ?
      WHERE proposal_id = ?
    `);

    stmt.run(
      JSON.stringify(subTasks),
      new Date().toISOString(),
      proposalId
    );
  }

  /**
   * 完成拆解（合并结果）
   */
  completeDecomposition(
    proposalId: string,
    mergedOutput: Record<string, unknown>
  ): void {
    const stmt = this.db.prepare(`
      UPDATE task_decompositions 
      SET status = 'completed', 
          merged_output = ?, 
          completed_at = ?, 
          updated_at = ?
      WHERE proposal_id = ?
    `);

    stmt.run(
      JSON.stringify(mergedOutput),
      new Date().toISOString(),
      new Date().toISOString(),
      proposalId
    );
  }

  /**
   * 获取拆解提案
   */
  getDecomposition(proposalId: string): TaskDecomposition | null {
    const stmt = this.db.prepare(`
      SELECT * FROM task_decompositions WHERE proposal_id = ?
    `);
    const row = stmt.get(proposalId) as any;
    return row ? this.rowToDecomposition(row) : null;
  }

  /**
   * 获取节点的拆解历史
   */
  getDecompositionsByNode(instanceId: string, nodeId: string): TaskDecomposition[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_decompositions 
      WHERE instance_id = ? AND node_id = ?
      ORDER BY submitted_at DESC
    `);
    const rows = stmt.all(instanceId, nodeId) as any[];
    return rows.map(row => this.rowToDecomposition(row));
  }

  /**
   * 获取待审批的拆解提案
   */
  getPendingDecompositions(): TaskDecomposition[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_decompositions 
      WHERE status = 'pending'
      ORDER BY submitted_at ASC
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => this.rowToDecomposition(row));
  }

  /**
   * 检查拆解重试次数
   */
  getDecompositionRetryCount(proposalId: string): number {
    const stmt = this.db.prepare(`
      SELECT rejection_count FROM task_decompositions WHERE proposal_id = ?
    `);
    const row = stmt.get(proposalId) as any;
    return row?.rejection_count || 0;
  }

  /**
   * 行数据转拆解对象
   */
  private rowToDecomposition(row: any): TaskDecomposition {
    return {
      id: row.id,
      instanceId: row.instance_id,
      nodeId: row.node_id,
      parentTaskId: row.parent_task_id,
      proposalId: row.proposal_id,
      decompositionPlan: row.decomposition_plan,
      status: row.status,
      subTasks: row.sub_tasks ? JSON.parse(row.sub_tasks) : [],
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      rejectionReason: row.rejection_reason,
      rejectionCount: row.rejection_count || 0,
      mergedOutput: row.merged_output ? JSON.parse(row.merged_output) : undefined,
      submittedAt: row.submitted_at,
      completedAt: row.completed_at,
    };
  }

  close(): void {
    this.db.close();
    console.log('[WorkflowStateDB] Database closed');
  }
}
