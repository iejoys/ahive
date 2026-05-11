/**
 * 节点工具箱组件
 * 提供可拖拽的工作流节点工具
 */

import { useState, useRef } from 'react';
import type { WorkflowNodeType } from '../../types';
import { NodeTooltip } from './NodeTooltip';
import { useStore } from '../../store/useStore';

// ========== 类型定义 ==========

/** 工具节点定义 */
interface ToolNode {
  type: WorkflowNodeType;
  nameZh: string;
  nameEn: string;
  icon: string;
  color: string;
  descriptionZh: string;
  descriptionEn: string;
  useCasesZh?: string[];
  useCasesEn?: string[];
  configTipsZh?: string;
  configTipsEn?: string;
  shortcut?: string;
}

/** 工具分类 */
interface ToolCategory {
  id: string;
  nameZh: string;
  nameEn: string;
  icon: string;
  nodes: ToolNode[];
}

// ========== 节点配置数据 ==========

export const nodeDescriptions: Partial<Record<WorkflowNodeType, ToolNode>> = {
  agent: {
    type: 'agent',
    nameZh: '智能体',
    nameEn: 'Agent',
    icon: '🤖',
    color: '#6366f1',
    descriptionZh: '调用一个或多个智能体执行任务，是工作流中最核心的执行单元。',
    descriptionEn: 'Invoke one or more agents to execute tasks, the core execution unit in workflows.',
    useCasesZh: [
      '需要 AI 分析、生成、处理的任务',
      '代码编写、文档生成、数据分析',
      '需要特定专业技能的任务执行',
    ],
    useCasesEn: [
      'Tasks requiring AI analysis, generation, or processing',
      'Code writing, document generation, data analysis',
      'Tasks requiring specific professional skills',
    ],
    configTipsZh: '执行者可多选，支持投票、并行等模式',
    configTipsEn: 'Multiple executors supported, with voting, parallel modes',
    shortcut: 'A',
  },
  milestone: {
    type: 'milestone',
    nameZh: '里程碑',
    nameEn: 'Milestone',
    icon: '🚩',
    color: '#10b981',
    descriptionZh: '阶段容器节点，用于定义工作流的阶段性目标，支持多级工作流结构。',
    descriptionEn: 'Phase container node for defining workflow milestones, supporting multi-level workflow structures.',
    useCasesZh: [
      '大型项目分阶段管理',
      '定义里程碑目标和验收标准',
      '组织复杂工作流的层次结构',
    ],
    useCasesEn: [
      'Large project phase management',
      'Define milestone goals and acceptance criteria',
      'Organize complex workflow hierarchies',
    ],
    configTipsZh: '可设置阶段描述、超时时间',
    configTipsEn: 'Can set phase description, timeout',
    shortcut: 'S',
  },
  department: {
    type: 'department',
    nameZh: '部门',
    nameEn: 'Department',
    icon: '👥',
    color: '#22c55e',
    descriptionZh: '派发任务到部门，触发部门内部工作流协作。',
    descriptionEn: 'Dispatch tasks to departments, triggering internal workflow collaboration.',
    useCasesZh: [
      '需要多人协作完成的任务',
      '按职能分工的工作流',
      '跨智能体的复杂任务编排',
    ],
    useCasesEn: [
      'Tasks requiring multi-person collaboration',
      'Workflow by functional division',
      'Complex task orchestration across agents',
    ],
    configTipsZh: '可选择是否触发部门内部工作流',
    configTipsEn: 'Can choose whether to trigger department internal workflow',
    shortcut: 'D',
  },
  api: {
    type: 'api',
    nameZh: '外部API',
    nameEn: 'External API',
    icon: '📞',
    color: '#f59e0b',
    descriptionZh: '调用外部 HTTP API，支持 GET/POST/PUT/DELETE 方法。',
    descriptionEn: 'Call external HTTP APIs, supporting GET/POST/PUT/DELETE methods.',
    useCasesZh: [
      '调用第三方服务接口',
      '获取外部数据',
      '触发外部系统动作',
    ],
    useCasesEn: [
      'Call third-party service APIs',
      'Fetch external data',
      'Trigger external system actions',
    ],
    configTipsZh: '支持 Bearer Token、Basic Auth、API Key 认证',
    configTipsEn: 'Supports Bearer Token, Basic Auth, API Key authentication',
    shortcut: 'X',
  },
  condition: {
    type: 'condition',
    nameZh: '条件分支',
    nameEn: 'Condition',
    icon: '◇',
    color: '#8b5cf6',
    descriptionZh: '根据黑板变量或表达式判断，选择不同的执行路径。',
    descriptionEn: 'Branch execution based on blackboard variables or expressions.',
    useCasesZh: [
      '根据审核结果决定后续流程',
      '分数阈值判断（及格/不及格）',
      '数据状态检查（存在/不存在）',
    ],
    useCasesEn: [
      'Decide next steps based on review results',
      'Score threshold judgment (pass/fail)',
      'Data status check (exists/not exists)',
    ],
    configTipsZh: '支持多个条件分支，按顺序匹配',
    configTipsEn: 'Supports multiple condition branches, matched in order',
    shortcut: 'C',
  },
  parallel: {
    type: 'parallel',
    nameZh: '并行执行',
    nameEn: 'Parallel',
    icon: '⚡',
    color: '#ec4899',
    descriptionZh: '并行执行多个分支，可选择全部完成或任一完成。',
    descriptionEn: 'Execute multiple branches in parallel, choose all-complete or any-complete.',
    useCasesZh: [
      '多个独立任务同时执行',
      '竞速场景（最快的获胜）',
      '多方案并行验证',
    ],
    useCasesEn: [
      'Multiple independent tasks executing simultaneously',
      'Race scenarios (fastest wins)',
      'Multi-scheme parallel verification',
    ],
    configTipsZh: '合并策略: all=全部完成, any=任一完成',
    configTipsEn: 'Merge strategy: all=all complete, any=any complete',
    shortcut: 'P',
  },
  loop: {
    type: 'loop',
    nameZh: '循环',
    nameEn: 'Loop',
    icon: '🔄',
    color: '#14b8a6',
    descriptionZh: '循环执行某个节点，支持固定次数、条件、数组遍历三种模式。',
    descriptionEn: 'Loop execution of a node, supporting fixed count, condition, array traversal modes.',
    useCasesZh: [
      '批量处理数据',
      '轮询检查状态',
      '重复执行直到条件满足',
    ],
    useCasesEn: [
      'Batch data processing',
      'Polling status check',
      'Repeat until condition is met',
    ],
    configTipsZh: '数组遍历时可设置迭代变量名',
    configTipsEn: 'Can set iteration variable name for array traversal',
    shortcut: 'L',
  },
  delay: {
    type: 'delay',
    nameZh: '延时',
    nameEn: 'Delay',
    icon: '⏱️',
    color: '#64748b',
    descriptionZh: '延时等待指定时间后继续执行。',
    descriptionEn: 'Delay execution for a specified time before continuing.',
    useCasesZh: [
      '等待外部系统处理',
      '定时轮询间隔',
      '模拟用户操作延迟',
    ],
    useCasesEn: [
      'Wait for external system processing',
      'Scheduled polling interval',
      'Simulate user operation delay',
    ],
    configTipsZh: '支持秒、分钟、小时三种时间单位',
    configTipsEn: 'Supports seconds, minutes, hours time units',
    shortcut: 'T',
  },
  variable: {
    type: 'variable',
    nameZh: '项目配置',
    nameEn: 'Project Config',
    icon: '⚙️',
    color: '#06b6d4',
    descriptionZh: '定义工作流的静态配置参数，如项目名称、路径、版本等。运行时不变，与动态黑板变量分离。',
    descriptionEn: 'Define static configuration parameters for workflows, such as project name, path, version. Immutable at runtime, separated from dynamic blackboard variables.',
    useCasesZh: [
      '定义项目基础信息（名称、版本、类型）',
      '配置路径和目录参数',
      '设置全局静态参数',
    ],
    useCasesEn: [
      'Define project basic info (name, version, type)',
      'Configure path and directory parameters',
      'Set global static parameters',
    ],
    configTipsZh: '支持分组管理、多种数据类型、模板预设',
    configTipsEn: 'Supports grouping, multiple data types, template presets',
    shortcut: 'C',
  },
  human: {
    type: 'human',
    nameZh: '人工审核',
    nameEn: 'Human Review',
    icon: '✋',
    color: '#eab308',
    descriptionZh: '暂停工作流，等待人工审核确认后继续。',
    descriptionEn: 'Pause workflow, wait for human review confirmation before continuing.',
    useCasesZh: [
      '重要决策需要人工确认',
      '质量把控、风险审核',
      '智能体产出需要人工验收',
    ],
    useCasesEn: [
      'Important decisions requiring human confirmation',
      'Quality control, risk review',
      'Agent output requiring human acceptance',
    ],
    configTipsZh: '可设置审核选项，每个选项可跳转到不同节点',
    configTipsEn: 'Can set review options, each option can jump to different nodes',
    shortcut: 'H',
  },
  review: {
    type: 'review',
    nameZh: '审核评分',
    nameEn: 'Review Score',
    icon: '📝',
    color: '#f97316',
    descriptionZh: '由智能体进行审核评分，根据分数决定后续流程。',
    descriptionEn: 'Agent performs review scoring, determines next steps based on score.',
    useCasesZh: [
      '代码审核',
      '质量评分',
      '结果验收',
    ],
    useCasesEn: [
      'Code review',
      'Quality scoring',
      'Result acceptance',
    ],
    configTipsZh: '设置通过阈值，不满足可退回重试',
    configTipsEn: 'Set pass threshold, can return for retry if not met',
    shortcut: 'R',
  },
  notify: {
    type: 'notify',
    nameZh: '通知',
    nameEn: 'Notify',
    icon: '🔔',
    color: '#0ea5e9',
    descriptionZh: '发送通知给用户或指定接收者。',
    descriptionEn: 'Send notification to users or specified recipients.',
    useCasesZh: [
      '工作流完成通知',
      '异常告警',
      '任务提醒',
    ],
    useCasesEn: [
      'Workflow completion notification',
      'Exception alert',
      'Task reminder',
    ],
    configTipsZh: '支持邮件、短信、钉钉、企微、飞书',
    configTipsEn: 'Supports email, SMS, DingTalk, WeCom, Feishu',
    shortcut: 'N',
  },
  output: {
    type: 'output',
    nameZh: '输出',
    nameEn: 'Output',
    icon: '📤',
    color: '#f43f5e',
    descriptionZh: '输出最终结果，标记工作流产出。',
    descriptionEn: 'Output final results, marking workflow output.',
    useCasesZh: [
      '定义工作流输出格式',
      '汇总最终结果',
      '生成报告',
    ],
    useCasesEn: [
      'Define workflow output format',
      'Summarize final results',
      'Generate report',
    ],
    configTipsZh: '可输出多个变量，支持格式化',
    configTipsEn: 'Can output multiple variables, supports formatting',
    shortcut: 'O',
  },
  webhook: {
    type: 'webhook',
    nameZh: 'Webhook',
    nameEn: 'Webhook',
    icon: '🪝',
    color: '#7c3aed',
    descriptionZh: '接收外部 Webhook 触发，启动工作流。',
    descriptionEn: 'Receive external Webhook trigger to start workflow.',
    useCasesZh: [
      '外部系统触发',
      'API 回调接收',
      '事件驱动启动',
    ],
    useCasesEn: [
      'External system trigger',
      'API callback reception',
      'Event-driven startup',
    ],
    configTipsZh: '自动生成唯一端点路径',
    configTipsEn: 'Auto-generate unique endpoint path',
    shortcut: 'W',
  },
  email: {
    type: 'email',
    nameZh: '邮件',
    nameEn: 'Email',
    icon: '📨',
    color: '#dc2626',
    descriptionZh: '发送邮件通知。',
    descriptionEn: 'Send email notification.',
    useCasesZh: [
      '发送报告邮件',
      '通知相关人员',
      '发送审批请求',
    ],
    useCasesEn: [
      'Send report email',
      'Notify relevant personnel',
      'Send approval request',
    ],
    configTipsZh: '支持 HTML 邮件模板',
    configTipsEn: 'Supports HTML email templates',
    shortcut: 'E',
  },
  message: {
    type: 'message',
    nameZh: '消息',
    nameEn: 'Message',
    icon: '💬',
    color: '#2563eb',
    descriptionZh: '发送即时消息到通讯工具。',
    descriptionEn: 'Send instant message to communication tools.',
    useCasesZh: [
      '钉钉/企微/飞书消息推送',
      '群组通知',
      '机器人消息',
    ],
    useCasesEn: [
      'DingTalk/WeCom/Feishu message push',
      'Group notification',
      'Bot message',
    ],
    configTipsZh: '需要配置对应的机器人 Webhook',
    configTipsEn: 'Need to configure corresponding bot Webhook',
    shortcut: 'M',
  },
  planner: {
    type: 'planner',
    nameZh: '规划节点',
    nameEn: 'Planner',
    icon: '📋',
    color: '#8b5cf6',
    descriptionZh: '调用LLM分析设计文档，动态生成任务拆分计划，输出带批次号的任务列表。',
    descriptionEn: 'Call LLM to analyze design documents, dynamically generate task plans with batch numbers.',
    useCasesZh: [
      '大型项目开发任务拆分',
      '根据设计文档动态规划',
      '智能分配执行批次',
    ],
    useCasesEn: [
      'Large project task breakdown',
      'Dynamic planning from design docs',
      'Intelligent batch assignment',
    ],
    configTipsZh: '输出模块列表，每个模块包含batch字段控制执行顺序',
    configTipsEn: 'Outputs module list, each with batch field for execution order',
    shortcut: 'G',
  },
  'dynamic-parallel': {
    type: 'dynamic-parallel',
    nameZh: '动态并行',
    nameEn: 'Dynamic Parallel',
    icon: '🔀',
    color: '#ec4899',
    descriptionZh: '根据规划结果动态创建子节点，按批次执行（批内并行，批间顺序）。',
    descriptionEn: 'Dynamically create child nodes from plan, execute by batch (parallel within, sequential between).',
    useCasesZh: [
      '执行动态生成的任务列表',
      '按依赖关系分批执行',
      '大规模并行任务处理',
    ],
    useCasesEn: [
      'Execute dynamically generated task list',
      'Batch execution by dependencies',
      'Large-scale parallel task processing',
    ],
    configTipsZh: '同批次并行执行，不同批次顺序执行',
    configTipsEn: 'Parallel within batch, sequential between batches',
    shortcut: 'D',
  },
};

/** 工具分类配置 - 支持多语言 */
const toolCategories: ToolCategory[] = [
  {
    id: 'project',
    nameZh: '项目配置',
    nameEn: 'Project Config',
    icon: '📁',
    nodes: [nodeDescriptions.variable!],
  },
  {
    id: 'execution',
    nameZh: '执行节点',
    nameEn: 'Execution',
    icon: '📦',
    nodes: [
      nodeDescriptions.agent!,
      nodeDescriptions.milestone!,
      nodeDescriptions.department!,
      nodeDescriptions.api!,
    ],
  },
  {
    id: 'dynamic',
    nameZh: '动态任务',
    nameEn: 'Dynamic Tasks',
    icon: '🔄',
    nodes: [
      nodeDescriptions.planner!,
      nodeDescriptions['dynamic-parallel']!,
    ],
  },
  {
    id: 'control',
    nameZh: '流程控制',
    nameEn: 'Flow Control',
    icon: '🔀',
    nodes: [
      nodeDescriptions.condition!,
      nodeDescriptions.parallel!,
      nodeDescriptions.loop!,
      nodeDescriptions.delay!,
    ],
  },
  {
    id: 'data',
    nameZh: '数据处理',
    nameEn: 'Data Processing',
    icon: '📝',
    nodes: [nodeDescriptions.output!],
  },
  {
    id: 'review',
    nameZh: '审核交互',
    nameEn: 'Review & Interaction',
    icon: '👤',
    nodes: [
      nodeDescriptions.human!,
      nodeDescriptions.review!,
    ],
  },
  {
    id: 'integration',
    nameZh: '集成通知',
    nameEn: 'Integration & Notification',
    icon: '🔗',
    nodes: [
      nodeDescriptions.notify!,
      nodeDescriptions.webhook!,
      nodeDescriptions.email!,
      nodeDescriptions.message!,
    ],
  },
];

// ========== 面板状态类型 ==========

/** 面板显示状态 */
export type ToolboxPanelState = 'collapsed' | 'normal';

/** 面板宽度配置 */
const PANEL_WIDTHS: Record<ToolboxPanelState, number> = {
  collapsed: 48,
  normal: 208,  // w-52 = 13rem = 208px
};

// ========== 工具箱主组件 ==========

export interface NodeToolboxProps {
  className?: string;
  /** 初始状态 */
  defaultState?: ToolboxPanelState;
  /** 状态变化回调 */
  onStateChange?: (state: ToolboxPanelState) => void;
}

export function NodeToolbox({ 
  className = '', 
  defaultState = 'normal',
  onStateChange,
}: NodeToolboxProps) {
  const { language } = useStore();
  const [panelState, setPanelState] = useState<ToolboxPanelState>(defaultState);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('project');
  const [hoveredNode, setHoveredNode] = useState<ToolNode | null>(null);
  const tooltipAnchorRef = useRef<HTMLElement | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 切换面板状态
  const togglePanelState = () => {
    const newState = panelState === 'collapsed' ? 'normal' : 'collapsed';
    setPanelState(newState);
    onStateChange?.(newState);
  };
  
  // 展开面板
  const expandPanel = () => {
    setPanelState('normal');
    onStateChange?.('normal');
  };
  
  // 处理拖拽开始
  const handleDragStart = (e: React.DragEvent, nodeType: WorkflowNodeType) => {
    e.dataTransfer.setData('application/reactflow', nodeType);
    e.dataTransfer.effectAllowed = 'move';
    // 拖拽时关闭提示框
    setHoveredNode(null);
  };
  
  // 处理鼠标进入
  const handleMouseEnter = (node: ToolNode, element: HTMLElement) => {
    // 清除之前的隐藏定时器
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setHoveredNode(node);
    tooltipAnchorRef.current = element;
  };
  
  // 处理鼠标离开
  const handleMouseLeave = () => {
    // 延迟关闭，给用户时间移动到提示框
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredNode(null);
    }, 300);
  };
  
  // 关闭提示框
  const handleCloseTooltip = () => {
    setHoveredNode(null);
  };
  
  // 保持提示框显示（鼠标移入提示框时调用）
  const handleTooltipEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };
  
  // 提示框鼠标离开
  const handleTooltipLeave = () => {
    setHoveredNode(null);
  };
  
  // 收缩状态 - 只显示图标
  if (panelState === 'collapsed') {
    return (
      <div 
        className={`bg-gray-800 border-r border-gray-700 cursor-pointer hover:bg-gray-750 transition-all flex flex-col items-center py-4 ${className}`}
        style={{ width: PANEL_WIDTHS.collapsed }}
        onClick={expandPanel}
        title={language === 'zh' ? '展开工具箱' : 'Expand Toolbox'}
      >
        <span className="text-2xl">🧰</span>
        <div className="writing-mode-vertical text-gray-400 text-xs mt-3">
          {language === 'zh' ? '节点工具箱' : 'Node Toolbox'}
        </div>
        <div className="mt-4 text-gray-500 text-xs">
          ▶
        </div>
      </div>
    );
  }
  
  // 展开状态
  return (
    <div 
      className={`node-toolbox bg-gray-800 border-r border-gray-700 flex flex-col transition-all duration-300 ${className}`}
      style={{ width: PANEL_WIDTHS.normal }}
    >
      {/* 标题栏 */}
      <div className="p-3 border-b border-gray-700 shrink-0 flex items-center justify-between">
        <h3 className="text-white text-sm font-medium flex items-center gap-2">
          <span>🧰</span>
          <span>{language === 'zh' ? '节点工具箱' : 'Node Toolbox'}</span>
        </h3>
        <button
          onClick={togglePanelState}
          className="text-gray-400 hover:text-white px-2 py-1 text-sm transition-colors"
          title={language === 'zh' ? '收缩工具箱' : 'Collapse Toolbox'}
        >
          ◀
        </button>
      </div>
      
      {/* 分类列表 */}
      <div className="overflow-y-auto flex-1">
        {toolCategories.map(category => (
          <div key={category.id} className="category">
            {/* 分类标题 */}
            <div 
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => setExpandedCategory(
                expandedCategory === category.id ? null : category.id
              )}
            >
              <span className="text-gray-400 text-xs">
                {expandedCategory === category.id ? '▼' : '▶'}
              </span>
              <span>{category.icon}</span>
              <span className="text-gray-300 text-sm">{language === 'zh' ? category.nameZh : category.nameEn}</span>
              <span className="text-gray-500 text-xs ml-auto">
                {category.nodes.length}
              </span>
            </div>
            
            {/* 节点列表 */}
            {expandedCategory === category.id && (
              <div className="px-2 pb-2 space-y-1">
                {category.nodes.map(node => (
                  <div
                    key={node.type}
                    ref={(el) => {
                      if (hoveredNode?.type === node.type && el) {
                        tooltipAnchorRef.current = el;
                      }
                    }}
                    draggable
                    onDragStart={(e) => handleDragStart(e, node.type)}
                    onMouseEnter={(e) => handleMouseEnter(node, e.currentTarget)}
                    onMouseLeave={handleMouseLeave}
                    className="flex items-center gap-2 px-2 py-2 rounded cursor-move hover:bg-gray-700 transition-colors group"
                    style={{ borderLeft: `3px solid ${node.color}` }}
                  >
                    <span className="text-lg">{node.icon}</span>
                    <span className="text-white text-sm">{language === 'zh' ? node.nameZh : node.nameEn}</span>
                    <span className="text-gray-500 text-xs ml-auto opacity-0 group-hover:opacity-100">
                      ⋮⋮
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* 使用提示 */}
      <div className="p-2 border-t border-gray-700 shrink-0">
        <div className="text-xs text-gray-500 text-center">
          💡 {language === 'zh' ? '拖拽节点到画布 | 悬停查看说明' : 'Drag to canvas | Hover for details'}
        </div>
      </div>
      
      {/* 工具提示浮层 */}
      {hoveredNode && (
        <NodeTooltip
          node={{
            name: language === 'zh' ? hoveredNode.nameZh : hoveredNode.nameEn,
            icon: hoveredNode.icon,
            color: hoveredNode.color,
            description: language === 'zh' ? hoveredNode.descriptionZh : hoveredNode.descriptionEn,
            useCases: language === 'zh' ? hoveredNode.useCasesZh : hoveredNode.useCasesEn,
            configTips: language === 'zh' ? hoveredNode.configTipsZh : hoveredNode.configTipsEn,
            shortcut: hoveredNode.shortcut,
          }}
          anchorRef={tooltipAnchorRef}
          visible={!!hoveredNode}
          onClose={handleCloseTooltip}
          onMouseEnter={handleTooltipEnter}
          onMouseLeave={handleTooltipLeave}
          language={language}
        />
      )}
    </div>
  );
}

// ========== 导出节点配置 ==========

export { toolCategories };