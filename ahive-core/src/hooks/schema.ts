/**
 * Hook 输入/输出 JSON Schema 定义
 * 
 * 参考: codex-rs/hooks/src/schema.rs
 */

// ============ SessionStart Input Schema ============

export const SESSION_START_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    transcript_path: { type: ['string', 'null'] },
    cwd: { type: 'string' },
    hook_event_name: { const: 'SessionStart' },
    model: { type: 'string' },
    permission_mode: {
      enum: ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'],
    },
    source: { enum: ['startup', 'resume', 'clear'] },
  },
  required: ['session_id', 'cwd', 'hook_event_name', 'model', 'permission_mode', 'source'],
};

// ============ Stop Input Schema ============

export const STOP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    turn_id: { type: 'string' },
    transcript_path: { type: ['string', 'null'] },
    cwd: { type: 'string' },
    hook_event_name: { const: 'Stop' },
    model: { type: 'string' },
    permission_mode: {
      enum: ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'],
    },
    stop_hook_active: { type: 'boolean' },
    last_assistant_message: { type: ['string', 'null'] },
  },
  required: ['session_id', 'turn_id', 'cwd', 'hook_event_name', 'model', 'permission_mode', 'stop_hook_active'],
};

// ============ AfterAgent Input Schema ============

export const AFTER_AGENT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    thread_id: { type: 'string' },
    turn_id: { type: 'string' },
    input_messages: { type: 'array', items: { type: 'string' } },
    last_assistant_message: { type: ['string', 'null'] },
  },
  required: ['session_id', 'thread_id', 'turn_id', 'input_messages'],
};

// ============ AfterToolUse Input Schema ============

export const AFTER_TOOL_USE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    turn_id: { type: 'string' },
    call_id: { type: 'string' },
    tool_name: { type: 'string' },
    tool_kind: { enum: ['function', 'custom', 'local_shell', 'mcp'] },
    tool_input: { type: 'object' },
    executed: { type: 'boolean' },
    success: { type: 'boolean' },
    duration_ms: { type: 'number' },
    mutating: { type: 'boolean' },
    sandbox: { type: 'string' },
    sandbox_policy: { type: 'string' },
    output_preview: { type: 'string' },
  },
  required: ['session_id', 'turn_id', 'call_id', 'tool_name', 'tool_kind', 'executed', 'success', 'duration_ms'],
};

// ============ Output Schemas ============

/**
 * 通用输出字段
 */
export const UNIVERSAL_OUTPUT_FIELDS = {
  continue: { type: 'boolean', description: '是否继续处理' },
  stop_reason: { type: 'string', description: '停止原因' },
  suppress_output: { type: 'boolean', description: '是否抑制输出' },
  system_message: { type: 'string', description: '系统消息（作为警告显示）' },
};

/**
 * SessionStart 输出 Schema
 */
export const SESSION_START_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ...UNIVERSAL_OUTPUT_FIELDS,
    hook_specific_output: {
      type: 'object',
      properties: {
        hook_event_name: { const: 'SessionStart' },
        additional_context: { type: 'string', description: '附加到模型上下文的文本' },
      },
    },
  },
};

/**
 * Stop 输出 Schema
 */
export const STOP_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ...UNIVERSAL_OUTPUT_FIELDS,
    decision: { enum: ['proceed', 'block'], description: '决策：继续或阻塞' },
    reason: { type: 'string', description: '决策原因（block 时必填）' },
  },
};

// ============ Schema 导出 ============

export const HOOK_SCHEMAS = {
  sessionStart: {
    input: SESSION_START_INPUT_SCHEMA,
    output: SESSION_START_OUTPUT_SCHEMA,
  },
  stop: {
    input: STOP_INPUT_SCHEMA,
    output: STOP_OUTPUT_SCHEMA,
  },
  afterAgent: {
    input: AFTER_AGENT_INPUT_SCHEMA,
  },
  afterToolUse: {
    input: AFTER_TOOL_USE_INPUT_SCHEMA,
  },
};