/**
 * ahive-webot 类型定义
 * 
 * 企业微信智能体的类型定义
 */

/**
 * 企业微信智能体配置
 */
export interface WebotConfig {
  /** 机器人 ID */
  botId: string;
  /** 机器人 Secret */
  secret: string;
  /** 是否启用 */
  enabled: boolean;
  /** 默认推送目标用户 ID 列表（逗号分隔，用于主动发送消息） */
  defaultChatIds?: string;
}

/**
 * 企业微信会话信息
 */
export interface WecomSession {
  /** 企业微信请求 ID */
  reqId: string;
  /** 发送者 ID */
  fromUser: string;
  /** 会话类型 */
  chatType: 'single' | 'group';
  /** 会话 ID */
  chatId: string;
  /** 目标智能体 ID */
  targetAgentId: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 审核任务信息
 */
export interface AuditTask {
  /** 审核任务 ID（对应企业微信模板卡片的 task_id） */
  taskId: string;
  /** 发起审核的智能体 ID */
  fromAgentId: string;
  /** 企业微信用户 ID */
  chatId: string;
  /** 文件信息 */
  fileInfo: {
    /** 文件类型（如 'code', 'config', 'document'） */
    type: string;
    /** 文件路径 */
    path: string;
    /** 文件内容摘要（可选） */
    content?: string;
    /** 修改描述（可选） */
    description?: string;
  };
  /** 创建时间戳 */
  timestamp: number;
}

/**
 * 审核结果
 */
export interface AuditResult {
  /** 审核任务 ID */
  taskId: string;
  /** 审核动作：approve（通过）或 reject（拒绝） */
  action: 'approve' | 'reject';
  /** 审核者（企业微信用户 ID） */
  auditor: string;
  /** 审核时间 */
  timestamp: number;
}

/**
 * 智能体消息格式
 */
export interface AgentMessage {
  /** 消息 ID */
  id: string;
  /** 发送者智能体 ID */
  fromAgentId: string;
  /** 接收者智能体 ID */
  toAgentId: string;
  /** 消息类型 */
  type: 'task' | 'result' | 'query' | 'response' | 'broadcast';
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: Date;
  /** 元数据 */
  metadata?: {
    source?: string;
    reqId?: string;
    fromUser?: string;
    chatType?: string;
    chatId?: string;
    /** 审核相关元数据 */
    auditTaskId?: string;
    auditAction?: 'approve' | 'reject';
    fileInfo?: AuditTask['fileInfo'];
  };
}