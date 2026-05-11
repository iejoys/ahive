/**
 * 项目配置提示词生成器
 * 
 * 功能：
 * 1. 从 variable 节点提取项目配置信息
 * 2. 分离公共参数和专用参数
 * 3. 生成 Markdown 格式的提示词文件
 * 
 * 文件命名规则：
 * - 公共信息：projectinfo_prompt.md
 * - 专用信息：projectinfo_{agentId}_prompt.md
 */

import * as fs from 'fs';
import * as path from 'path';
import type { 
  Workflow, 
  WorkflowNode, 
  VariableItem, 
  VariableGroup,
  VariableNodeConfig,
  VariableNodeConfigV2 
} from '../types';

// ========== 类型定义 ==========

/**
 * 提示词文件元数据（YAML Front Matter）
 */
export interface PromptFileMetadata {
  version: number;
  mtime: number;
  workflowId: string;
  workflowName: string;
  createdAt: number;
  updatedAt: number;
  agentId?: string;  // 仅专用文件有此字段
}

/**
 * 分离后的变量集合
 */
export interface SeparatedVariables {
  /** 公共变量（没有 agentId） */
  public: VariableItem[];
  /** 专用变量（有 agentId），按 agentId 分组 */
  private: Map<string, VariableItem[]>;
}

// ========== ProjectPromptGenerator 类 ==========

export class ProjectPromptGenerator {
  /** 工作流状态目录 */
  private stateDir: string;

  constructor(stateDir: string = './data/workflow-states') {
    this.stateDir = stateDir;
  }

  /**
   * 从工作流生成项目配置提示词文件
   * 
   * @param workflow 工作流对象
   * @returns 生成的文件路径列表
   */
  generateFromWorkflow(workflow: Workflow): string[] {
    // 1. 找到 variable 节点
    const variableNode = this.findVariableNode(workflow);
    
    if (!variableNode) {
      console.log('[ProjectPromptGenerator] 工作流中没有 variable 节点，跳过生成');
      return [];
    }

    // 2. 提取变量配置
    const variableConfig = this.extractVariableConfig(variableNode);
    
    if (!variableConfig) {
      console.log('[ProjectPromptGenerator] variable 节点没有配置，跳过生成');
      return [];
    }

    // 3. 分离公共参数和专用参数
    const separated = this.separateVariables(variableConfig);

    // 4. 确保目录存在
    const workflowDir = this.ensureWorkflowDir(workflow.id);

    // 5. 生成文件
    const generatedFiles: string[] = [];

    // 5.1 生成公共信息文件
    if (separated.public.length > 0) {
      const publicFilePath = this.generatePublicFile(
        workflow, 
        separated.public, 
        variableConfig.groups || []
      );
      generatedFiles.push(publicFilePath);
      console.log(`[ProjectPromptGenerator] 生成公共信息文件: ${publicFilePath}`);
    }

    // 5.2 生成专用信息文件
    for (const [agentId, privateVars] of separated.private) {
      if (privateVars.length > 0) {
        const privateFilePath = this.generatePrivateFile(
          workflow,
          agentId,
          privateVars,
          variableConfig.groups || []
        );
        generatedFiles.push(privateFilePath);
        console.log(`[ProjectPromptGenerator] 生成专用信息文件: ${privateFilePath}`);
      }
    }

    return generatedFiles;
  }

  /**
   * 找到 variable 节点
   */
  private findVariableNode(workflow: Workflow): WorkflowNode | undefined {
    return workflow.nodes.find(n => n.type === 'variable');
  }

  /**
   * 提取变量配置
   */
  private extractVariableConfig(node: WorkflowNode): VariableNodeConfigV2 | null {
    const config = node.config?.variableConfig;
    
    if (!config) {
      return null;
    }

    // 判断版本
    if (this.isV2Config(config)) {
      return config as VariableNodeConfigV2;
    }

    // 旧版格式转换为新版格式（向后兼容）
    const legacyConfig = config as { name: string; value: string; type: string };
    return {
      version: 'v2',
      variables: [{
        name: legacyConfig.name,
        value: legacyConfig.value,
        type: legacyConfig.type as VariableItem['type'],
      }],
    };
  }

  /**
   * 判断是否为 V2 配置
   */
  private isV2Config(config: VariableNodeConfig): boolean {
    return (config as VariableNodeConfigV2).version === 'v2';
  }

  /**
   * 分离公共参数和专用参数
   */
  private separateVariables(config: VariableNodeConfigV2): SeparatedVariables {
    const publicVars: VariableItem[] = [];
    const privateVars = new Map<string, VariableItem[]>();

    for (const varItem of config.variables) {
      // 跳过禁用的变量
      if (varItem.enabled === false) {
        continue;
      }

      if (varItem.agentId) {
        // 专用参数
        if (!privateVars.has(varItem.agentId)) {
          privateVars.set(varItem.agentId, []);
        }
        privateVars.get(varItem.agentId)!.push(varItem);
      } else {
        // 公共参数
        publicVars.push(varItem);
      }
    }

    return {
      public: publicVars,
      private: privateVars,
    };
  }

  /**
   * 确保工作流目录存在
   */
  private ensureWorkflowDir(workflowId: string): string {
    const workflowDir = path.join(this.stateDir, workflowId);
    
    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }

    return workflowDir;
  }

  /**
   * 生成公共信息文件
   */
  private generatePublicFile(
    workflow: Workflow,
    variables: VariableItem[],
    groups: VariableGroup[]
  ): string {
    const filePath = path.join(this.stateDir, workflow.id, 'projectinfo_prompt.md');
    
    // 按分组整理变量
    const groupedVars = this.groupVariables(variables, groups);
    
    // 生成内容
    const content = this.renderMarkdown(workflow, groupedVars, null);
    
    // 保存文件
    fs.writeFileSync(filePath, content, 'utf-8');
    
    return filePath;
  }

  /**
   * 生成专用信息文件
   */
  private generatePrivateFile(
    workflow: Workflow,
    agentId: string,
    variables: VariableItem[],
    groups: VariableGroup[]
  ): string {
    const filePath = path.join(
      this.stateDir, 
      workflow.id, 
      `projectinfo_${agentId}_prompt.md`
    );
    
    // 按分组整理变量
    const groupedVars = this.groupVariables(variables, groups);
    
    // 生成内容
    const content = this.renderMarkdown(workflow, groupedVars, agentId);
    
    // 保存文件
    fs.writeFileSync(filePath, content, 'utf-8');
    
    return filePath;
  }

  /**
   * 按分组整理变量
   */
  private groupVariables(
    variables: VariableItem[],
    groups: VariableGroup[]
  ): Map<string, VariableItem[]> {
    const result = new Map<string, VariableItem[]>();

    // 先按 groups 定义顺序初始化
    for (const group of groups) {
      result.set(group.name, []);
    }

    // 再按变量的 group 字段归类
    for (const varItem of variables) {
      // 找到分组名称
      let groupName = '其他';
      
      if (varItem.group) {
        const matchedGroup = groups.find(g => g.id === varItem.group);
        if (matchedGroup) {
          groupName = matchedGroup.name;
        } else {
          groupName = varItem.group;
        }
      }

      if (!result.has(groupName)) {
        result.set(groupName, []);
      }
      result.get(groupName)!.push(varItem);
    }

    return result;
  }

  /**
   * 生成 Markdown 内容
   */
  private renderMarkdown(
    workflow: Workflow,
    groupedVars: Map<string, VariableItem[]>,
    agentId: string | null
  ): string {
    const now = Date.now();
    
    // 生成 YAML Front Matter
    const frontMatter = this.renderFrontMatter(workflow, agentId, now);
    
    // 生成标题
    const title = agentId 
      ? `# ${agentId} 专用项目配置` 
      : '# 项目配置信息';
    
    // 生成说明
    const description = agentId
      ? `> 本文档由工作流系统自动生成，仅注入到 **${agentId}** 智能体的系统提示词`
      : '> 本文档由工作流系统自动生成，用于注入所有智能体的系统提示词';
    
    // 生成正文
    const body = this.renderBody(groupedVars);
    
    // 追加协作规范
    const collaborationSpec = this.loadCollaborationSpec(agentId);
    
    return `${frontMatter}\n\n${title}\n\n${description}\n\n${body}\n\n${collaborationSpec}`;
  }

  /**
   * 加载协作规范
   * - 指挥官（agentId 为 null 或 'ahivecore'）：加载 Commander-Workflow-Collaboration-Specification.md
   * - 执行 Agent：加载 Execution-Agent-Workflow-Collaboration-Specification.md
   */
  private loadCollaborationSpec(agentId: string | null): string {
    const isCommander = !agentId || agentId === 'ahivecore';
    const specFileName = isCommander 
      ? 'Commander-Workflow-Collaboration-Specification.md'
      : 'Execution-Agent-Workflow-Collaboration-Specification.md';
    
    // 协作规范文件放在 stateDir 根目录下（不是 workflowId 子目录）
    const specFilePath = path.join(this.stateDir, specFileName);
    
    console.log(`[ProjectPromptGenerator] 尝试加载协作规范: ${specFilePath}`);
    
    if (fs.existsSync(specFilePath)) {
      const content = fs.readFileSync(specFilePath, 'utf-8');
      console.log(`[ProjectPromptGenerator] ✅ 成功加载协作规范: ${specFileName}`);
      return `\n---\n\n# 工作流协作规范\n\n${content}`;
    }
    
    console.warn(`[ProjectPromptGenerator] ⚠️ 协作规范文件不存在: ${specFilePath}`);
    return '';
  }

  /**
   * 生成 YAML Front Matter
   */
  private renderFrontMatter(
    workflow: Workflow,
    agentId: string | null,
    timestamp: number
  ): string {
    const metadata: PromptFileMetadata = {
      version: 1,
      mtime: timestamp,
      workflowId: workflow.id,
      workflowName: workflow.name,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (agentId) {
      metadata.agentId = agentId;
    }

    const yamlLines = Object.entries(metadata)
      .map(([key, value]) => `${key}: ${this.formatYamlValue(value)}`)
      .join('\n');

    return `---\n${yamlLines}\n---`;
  }

  /**
   * 格式化 YAML 值
   */
  private formatYamlValue(value: unknown): string {
    if (typeof value === 'string') {
      // 包含特殊字符时用引号包裹
      if (value.includes(':') || value.includes('#') || value.includes('\n')) {
        return `"${value}"`;
      }
      return value;
    }
    return String(value);
  }

  /**
   * 生成 Markdown 正文
   */
  private renderBody(groupedVars: Map<string, VariableItem[]>): string {
    const sections: string[] = [];

    for (const [groupName, variables] of groupedVars) {
      if (variables.length === 0) {
        continue;
      }

      const sectionTitle = `## ${groupName}`;
      const items = variables.map(v => this.renderVariableItem(v)).join('\n');
      
      sections.push(`${sectionTitle}\n\n${items}`);
    }

    return sections.join('\n\n');
  }

  /**
   * 渲染单个变量项
   */
  private renderVariableItem(varItem: VariableItem): string {
    // 格式化值
    let valueDisplay = varItem.value;
    
    // 根据类型处理显示
    if (varItem.type === 'json' || varItem.type === 'array' || varItem.type === 'object') {
      try {
        // 尝试美化 JSON
        const parsed = JSON.parse(varItem.value);
        valueDisplay = JSON.stringify(parsed, null, 2);
      } catch {
        // 解析失败，保持原样
      }
    }

    // 基本行
    let line = `- **${varItem.name}**: ${valueDisplay}`;

    // 添加类型说明（可选）
    if (varItem.type && varItem.type !== 'string') {
      line += ` （类型: ${varItem.type}）`;
    }

    // 添加描述（如果有）
    if (varItem.description) {
      line += `\n  - 说明: ${varItem.description}`;
    }

    // 添加必填标记
    if (varItem.required) {
      line += `\n  - 必填: 是`;
    }

    // 添加敏感标记（不显示实际值）
    if (varItem.sensitive) {
      line = `- **${varItem.name}**: [敏感信息已隐藏]`;
      if (varItem.description) {
        line += `\n  - 说明: ${varItem.description}`;
      }
    }

    return line;
  }

  // ========== 工具方法 ==========

  /**
   * 获取文件路径
   */
  getFilePath(workflowId: string, agentId?: string): string {
    const fileName = agentId 
      ? `projectinfo_${agentId}_prompt.md` 
      : 'projectinfo_prompt.md';
    return path.join(this.stateDir, workflowId, fileName);
  }

  /**
   * 检查文件是否存在
   */
  fileExists(workflowId: string, agentId?: string): boolean {
    const filePath = this.getFilePath(workflowId, agentId);
    return fs.existsSync(filePath);
  }

  /**
   * 读取文件内容
   */
  readFile(workflowId: string, agentId?: string): string | null {
    const filePath = this.getFilePath(workflowId, agentId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * 解析文件元数据
   */
  parseMetadata(content: string): PromptFileMetadata | null {
    // 提取 YAML Front Matter
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    
    if (!frontMatterMatch) {
      return null;
    }

    const yamlContent = frontMatterMatch[1];
    const metadata: Partial<PromptFileMetadata> = {};

    // 简单解析 YAML
    const lines = yamlContent.split('\n');
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        const value = valueParts.join(':').trim();
        
        // 处理不同类型
        if (key === 'version' || key === 'mtime' || key === 'createdAt' || key === 'updatedAt') {
          metadata[key as keyof PromptFileMetadata] = parseInt(value, 10);
        } else {
          metadata[key as keyof PromptFileMetadata] = value;
        }
      }
    }

    return metadata as PromptFileMetadata;
  }

  /**
   * 更新文件版本
   */
  updateVersion(workflowId: string, agentId?: string): void {
    const filePath = this.getFilePath(workflowId, agentId);
    
    if (!fs.existsSync(filePath)) {
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const metadata = this.parseMetadata(content);

    if (!metadata) {
      return;
    }

    // 更新版本号和时间
    metadata.version += 1;
    metadata.mtime = Date.now();
    metadata.updatedAt = Date.now();

    // 重新生成 Front Matter
    const newFrontMatter = this.renderFrontMatter(
      { id: metadata.workflowId, name: metadata.workflowName } as Workflow,
      agentId || null,
      Date.now()
    );

    // 替换旧的 Front Matter
    const newContent = content.replace(/^---\n[\s\S]*?\n---/, newFrontMatter);

    fs.writeFileSync(filePath, newContent, 'utf-8');
    console.log(`[ProjectPromptGenerator] 更新文件版本: ${filePath}, version: ${metadata.version}`);
  }
}

// ========== 单例 ==========

let projectPromptGeneratorInstance: ProjectPromptGenerator | null = null;

/**
 * 获取 ProjectPromptGenerator 实例
 */
export function getProjectPromptGenerator(stateDir?: string): ProjectPromptGenerator {
  if (!projectPromptGeneratorInstance) {
    projectPromptGeneratorInstance = new ProjectPromptGenerator(stateDir);
  }
  return projectPromptGeneratorInstance;
}

/**
 * 初始化 ProjectPromptGenerator
 */
export function initializeProjectPromptGenerator(stateDir: string): ProjectPromptGenerator {
  projectPromptGeneratorInstance = new ProjectPromptGenerator(stateDir);
  return projectPromptGeneratorInstance;
}