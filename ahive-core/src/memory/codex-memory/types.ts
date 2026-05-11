export interface Stage1Output {
  threadId: string;
  rolloutPath: string;
  sourceUpdatedAt: Date;
  rawMemory: string;
  rolloutSummary: string;
  rolloutSlug?: string;
  cwd: string;
  gitBranch?: string;
  generatedAt: Date;
  usageCount?: number;
  lastUsage?: Date;
  spaceType?: string;  // 来源空间类型 (codex, openclaw 等)
}

export interface RolloutItem {
  type?: 'message' | 'tool_call' | 'tool_output' | 'compacted';
  role?: 'user' | 'assistant' | 'system';
  content?: string;
  timestamp: Date | string;
  toolCalls?: ToolCall[];
  toolOutputs?: ToolOutput[];
  // compacted 类型专用字段
  summary?: string;                    // LLM 生成的摘要
  replacement_history?: RolloutItem[]; // 压缩后的历史（关键：用于恢复上下文）
  preservedCount?: number;             // 保留的消息数
  originalCount?: number;              // 原始消息总数
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolOutput {
  toolCallId: string;
  output: string;
  isError?: boolean;
}

export interface Rollout {
  threadId: string;
  cwd: string;
  items: RolloutItem[];
  updatedAt: Date;
  gitBranch?: string;
  spaceType?: string;  // 来源空间类型 (codex, openclaw 等)
}

export interface Phase2InputSelection {
  selected: Stage1Output[];
  previousSelected: Stage1Output[];
  retainedThreadIds: string[];
  removed: Stage1OutputRef[];
}

export interface Stage1OutputRef {
  threadId: string;
  sourceUpdatedAt: Date;
  rolloutSlug?: string;
}

export interface MemoryConfig {
  memoryRoot: string;
  maxRawMemoriesForConsolidation: number;
  maxUnusedDays: number;
  maxRolloutAgeDays: number;
  maxRolloutsPerStartup: number;
  minRolloutIdleHours: number;
  extractModel?: string;
  consolidationModel?: string;
  generateMemories: boolean;
  useMemories: boolean;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  memoryRoot: './data/memories',
  maxRawMemoriesForConsolidation: 256,
  maxUnusedDays: 30,
  maxRolloutAgeDays: 30,
  maxRolloutsPerStartup: 16,
  minRolloutIdleHours: 6,
  generateMemories: true,
  useMemories: true,
};

export interface Stage1JobClaim {
  thread: {
    id: string;
    rolloutPath: string;
    cwd: string;
    updatedAt: Date;
    gitBranch?: string;
  };
  ownershipToken: string;
}

export interface JobResult {
  threadId: string;
  outcome: 'succeeded_with_output' | 'succeeded_no_output' | 'failed';
  error?: string;
  output?: Stage1Output;
}