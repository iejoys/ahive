/**
 * 工作流模板服务
 * 负责模板的加载、管理和从模板创建工作流
 */

import { WorkflowTemplate, Workflow, WorkflowNode, WorkflowEdge, OnlineTemplateImportResult } from '../types';

// 内置模板（Web 环境或无持久化时的备用）
const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'template-quant-strategy',
    name: '量化策略开发流程',
    description: '策略研究 → 审核 → 开发 → 回测 → 上线',
    category: '金融',
    author: 'AHIVE Team',
    tags: ['量化', '策略', '金融'],
    isOfficial: true,
    nodes: [
      {
        id: 'node-1',
        type: 'group',
        name: '策略研究',
        description: '小二负责策略制定',
        position: { x: 100, y: 100 },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      },
      {
        id: 'node-2',
        type: 'group',
        name: '方案审核',
        description: '珊儿审核方案',
        position: { x: 400, y: 100 },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      },
      {
        id: 'node-3',
        type: 'group',
        name: '策略开发',
        description: '阿四负责代码实现',
        position: { x: 700, y: 100 },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      },
      {
        id: 'node-4',
        type: 'group',
        name: '回测验证',
        description: '小二进行回测',
        position: { x: 1000, y: 100 },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    edges: [
      { id: 'edge-1-2', source: 'node-1', target: 'node-2', label: '提交审核', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: 'edge-2-3', source: 'node-2', target: 'node-3', label: '审核通过', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: 'edge-3-4', source: 'node-3', target: 'node-4', label: '开发完成', createdAt: '2026-03-01T00:00:00.000Z' }
    ],
    createdAt: '2026-03-01T00:00:00.000Z'
  },
  {
    id: 'template-code-review',
    name: '代码审查流程',
    description: '分析 → 诊断 → 修复 三步流程',
    category: '开发',
    author: 'AHIVE Team',
    tags: ['代码', '审查', '开发'],
    isOfficial: true,
    nodes: [
      {
        id: 'node-analyze',
        type: 'agent',
        name: '代码分析',
        description: '分析代码结构和潜在问题',
        position: { x: 100, y: 150 },
        config: {
          agentId: 'agent-analyzer',
          taskTemplate: '请分析以下代码，找出潜在问题：\n```\n{{code}}\n```',
          inputs: [{ name: 'code', source: 'user-input', required: true }],
          outputs: [{ name: 'analysisResult', extractPath: '$' }],
          timeout: 120000
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    edges: [],
    createdAt: '2026-03-01T00:00:00.000Z'
  },
  {
    id: 'template-simple-qa',
    name: '智能问答流程',
    description: '简单的单节点问答流程',
    category: '通用',
    author: 'AHIVE Team',
    tags: ['问答', '简单'],
    isOfficial: true,
    nodes: [
      {
        id: 'node-qa',
        type: 'agent',
        name: '智能回答',
        description: '回答用户问题',
        position: { x: 300, y: 150 },
        config: {
          agentId: 'agent-assistant',
          taskTemplate: '请回答以下问题：\n\n{{question}}',
          inputs: [{ name: 'question', source: 'user-input', required: true }],
          outputs: [{ name: 'answer', extractPath: '$.answer' }],
          timeout: 60000
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    edges: [],
    createdAt: '2026-03-01T00:00:00.000Z'
  }
];

/**
 * 检查是否为内网地址（SSRF 防护）
 */
function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // 阻止 localhost 及其变体
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }
    
    // 阻止内网 IP 段
    // 10.0.0.0/8
    if (/^10\./.test(hostname)) return true;
    
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
    
    // 192.168.0.0/16
    if (/^192\.168\./.test(hostname)) return true;
    
    // 阻止 IPv6 本地地址
    if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd')) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * 危险内容模式（XSS/注入防护）
 */
const DANGEROUS_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /on\w+\s*=/i,           // onclick=, onload=, etc.
  /data:\s*text\/html/i,
  /vbscript:/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<form/i,
];

/**
 * 生成安全的唯一 ID
 */
function generateSecureId(prefix: string): string {
  // 使用 crypto.randomUUID() 如果可用，否则使用时间戳 + 随机数
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
class WorkflowTemplateService {
  private templates: WorkflowTemplate[] = [];
  private loaded = false;

  /**
   * 加载模板库
   */
  async loadTemplates(): Promise<WorkflowTemplate[]> {
    if (this.loaded) {
      return this.templates;
    }

    try {
      // 检查是否在 Electron 环境
      if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) {
        const templates = await window.electronAPI.getWorkflowTemplates();
        if (templates && templates.length > 0) {
          this.templates = templates;
        } else {
          // 持久化中没有模板，使用内置模板
          this.templates = BUILTIN_TEMPLATES;
        }
      } else {
        // Web 环境，使用内置模板
        this.templates = BUILTIN_TEMPLATES;
      }

      this.loaded = true;
      return this.templates;
    } catch (error) {
      console.error('[WorkflowTemplateService] Failed to load templates:', error);
      this.templates = BUILTIN_TEMPLATES;
      this.loaded = true;
      return this.templates;
    }
  }

  /**
   * 获取模板列表
   */
  getTemplates(options?: {
    category?: string;
    tags?: string[];
    keyword?: string;
  }): WorkflowTemplate[] {
    let result = this.templates;

    if (options?.category) {
      result = result.filter(t => t.category === options.category);
    }

    if (options?.tags && options.tags.length > 0) {
      result = result.filter(t =>
        options.tags!.some(tag => t.tags.includes(tag))
      );
    }

    if (options?.keyword) {
      const kw = options.keyword.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(kw) ||
        t.description.toLowerCase().includes(kw)
      );
    }

    return result;
  }

  /**
   * 获取单个模板
   */
  getTemplate(templateId: string): WorkflowTemplate | undefined {
    return this.templates.find(t => t.id === templateId);
  }

  /**
   * 从模板创建工作流
   * @param templateId 模板 ID
   * @param customName 自定义名称（可选）
   */
  createFromTemplate(templateId: string, customName?: string): Workflow {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // 生成新 ID（使用安全 ID 生成）
    const newId = generateSecureId('workflow');
    const now = new Date().toISOString();

    // 节点 ID 映射（旧 ID -> 新 ID）
    const nodeIdMap = new Map<string, string>();

    // 复制节点，生成新 ID
    const newNodes: WorkflowNode[] = template.nodes.map(node => {
      const newNodeId = generateSecureId('node');
      nodeIdMap.set(node.id, newNodeId);

      return {
        ...node,
        id: newNodeId,
        createdAt: now,
        updatedAt: now
      };
    });

    // 复制边，更新 source/target ID
    const newEdges: WorkflowEdge[] = template.edges.map((edge, index) => ({
      ...edge,
      id: generateSecureId(`edge-${index}`),
      source: nodeIdMap.get(edge.source) || edge.source,
      target: nodeIdMap.get(edge.target) || edge.target,
      createdAt: now
    }));

    return {
      id: newId,
      name: customName || `${template.name} 副本`,
      description: template.description,
      nodes: newNodes,
      edges: newEdges,
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * 从 URL 导入在线模板
   * @param url 模板 JSON 文件的 URL
   */
  async importFromUrl(url: string): Promise<OnlineTemplateImportResult> {
    try {
      // 1. 验证 URL 格式
      if (!this.isValidTemplateUrl(url)) {
        return { success: false, error: '无效的 URL 格式' };
      }
      
      // 2. SSRF 防护：阻止内网地址
      if (isInternalUrl(url)) {
        return { success: false, error: '不允许访问内网地址' };
      }

      // 3. 获取远程 JSON
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000) // 30秒超时
      });

      if (!response.ok) {
        return {
          success: false,
          error: `网络请求失败 (${response.status} ${response.statusText})`
        };
      }

      const data = await response.json();

      // 4. 校验模板结构（含安全检查）
      const validation = this.validateTemplateStructure(data);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // 5. 构建模板对象（使用安全 ID）
      const template: WorkflowTemplate = {
        ...data,
        id: generateSecureId('template-online'),
        source: 'online',
        sourceUrl: url,
        isOfficial: false,
        createdAt: new Date().toISOString()
      };

      return { success: true, template };

    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return { success: false, error: '网络连接失败，请检查网络设置' };
      }
      if (error instanceof Error && error.name === 'TimeoutError') {
        return { success: false, error: '请求超时，请检查网络或稍后重试' };
      }
      return {
        success: false,
        error: `导入失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * 保存导入的在线模板到本地
   */
  async saveImportedTemplate(template: WorkflowTemplate): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) {
        const result = await window.electronAPI.saveWorkflowTemplate(template);
        if (result) {
          // 添加到内存缓存
          const existingIndex = this.templates.findIndex(t => t.id === template.id);
          if (existingIndex >= 0) {
            this.templates[existingIndex] = template;
          } else {
            this.templates.push(template);
          }
        }
        return result;
      }
      return false;
    } catch (error) {
      console.error('[WorkflowTemplateService] Failed to save template:', error);
      return false;
    }
  }

  /**
   * 删除模板
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) {
        const result = await window.electronAPI.deleteWorkflowTemplate(templateId);
        if (result) {
          this.templates = this.templates.filter(t => t.id !== templateId);
        }
        return result;
      }
      return false;
    } catch (error) {
      console.error('[WorkflowTemplateService] Failed to delete template:', error);
      return false;
    }
  }

  /**
   * 获取所有分类
   */
  getCategories(): string[] {
    const categories = new Set(this.templates.map(t => t.category));
    return Array.from(categories);
  }

  /**
   * 获取所有标签
   */
  getTags(): string[] {
    const tags = new Set(this.templates.flatMap(t => t.tags));
    return Array.from(tags);
  }

  /**
   * 验证 URL 格式
   */
  private isValidTemplateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * 校验模板结构（含安全检查）
   */
  /**
   * 校验模板结构（含安全检查）
   */
  private validateTemplateStructure(data: unknown): { valid: boolean; error?: string } {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: '模板数据格式无效' };
    }

    const template = data as Record<string, unknown>;

    // 必填字段检查
    const requiredFields = ['name', 'nodes', 'edges'];
    for (const field of requiredFields) {
      if (!template[field]) {
        return { valid: false, error: `缺少必填字段: ${field}` };
      }
    }

    // 节点格式检查
    if (!Array.isArray(template.nodes)) {
      return { valid: false, error: 'nodes 必须是数组' };
    }

    for (const node of template.nodes) {
      if (!node.id || !node.name || !node.type) {
        return { valid: false, error: '节点缺少必要字段 (id, name, type)' };
      }
      
      // 安全检查：检测节点配置中的危险内容
      if (node.config) {
        const configStr = JSON.stringify(node.config);
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(configStr)) {
            return { valid: false, error: '模板包含不安全内容，已拒绝导入' };
          }
        }
      }
    }

    // 边格式检查
    if (!Array.isArray(template.edges)) {
      return { valid: false, error: 'edges 必须是数组' };
    }
    
    // 安全检查：检测模板描述等字段中的危险内容
    const fieldsToCheck = ['name', 'description', 'category', 'author'];
    for (const field of fieldsToCheck) {
      if (template[field] && typeof template[field] === 'string') {
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(template[field] as string)) {
            return { valid: false, error: '模板包含不安全内容，已拒绝导入' };
          }
        }
      }
    }

    return { valid: true };
  }

  /**
   * 刷新模板（重新从存储加载）
   */
  async refresh(): Promise<WorkflowTemplate[]> {
    this.loaded = false;
    return this.loadTemplates();
  }
}

// 导出单例
export const workflowTemplateService = new WorkflowTemplateService();