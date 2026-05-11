/**
 * AHIVECORE - 沙箱安全模块
 * 
 * 安全执行命令，支持审批和沙箱隔离
 */

export {
  SandboxExecutor,
  sandboxExecutor,
  ApprovalDecision,
  SandboxType,
  type CommandSpec,
  type ExecResult,
  type ApprovalRequest,
  type ExecApprovalRequirement,
} from './SandboxExecutor.js';