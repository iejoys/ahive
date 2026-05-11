/**
 * AHIVECORE 沙箱策略
 * 
 * 参考 CODEX 的 SandboxPolicy 设计
 */

export type SandboxPolicyType = 
  | 'danger-full-access'
  | 'read-only'
  | 'workspace-write'
  | 'external-sandbox';

export interface SandboxPolicy {
  type: SandboxPolicyType;
  
  // 可写根目录
  writableRoots?: string[];
  
  // 只读根目录
  readOnlyRoots?: string[];
  
  // 网络访问
  networkAccess?: boolean;
  
  // 禁止的命令模式
  deniedCommands?: RegExp[];
  
  // 禁止的路径模式
  deniedPaths?: RegExp[];
}

// 默认沙箱策略 - 工作区可写
export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  type: 'workspace-write',
  networkAccess: true,
  deniedCommands: [
    /^rm\s+-rf\s+\//i,          // 禁止删除根目录
    /^Remove-Item.*-Recurse/i,  // 禁止递归删除
  ],
  deniedPaths: [
    /\/\.git\/hooks/,           // 保护 git hooks
    /\/\.ssh\//,                // 保护 SSH 密钥
    /\/\.env$/,                 // 保护环境变量
  ],
};

// 危险命令检测
export function isDangerousCommand(command: string, policy: SandboxPolicy): boolean {
  if (policy.type === 'danger-full-access') {
    return false;
  }
  
  const lowerCommand = command.toLowerCase();
  
  // 检查禁止的命令
  if (policy.deniedCommands) {
    for (const pattern of policy.deniedCommands) {
      if (pattern.test(command)) {
        return true;
      }
    }
  }
  
  // 检查自杀命令
  const suicidePatterns = [
    /stop-process.*-name\s+node/i,
    /taskkill.*node/i,
    /killall\s+node/i,
    /pkill\s+node/i,
  ];
  
  for (const pattern of suicidePatterns) {
    if (pattern.test(command)) {
      return true;
    }
  }
  
  return false;
}

// 路径访问检查
export function isPathAllowed(
  path: string, 
  access: 'read' | 'write',
  policy: SandboxPolicy
): boolean {
  if (policy.type === 'danger-full-access') {
    return true;
  }
  
  // 检查禁止的路径
  if (policy.deniedPaths) {
    for (const pattern of policy.deniedPaths) {
      if (pattern.test(path)) {
        return false;
      }
    }
  }
  
  // 写权限检查
  if (access === 'write') {
    if (policy.type === 'read-only') {
      return false;
    }
    
    if (policy.writableRoots) {
      return policy.writableRoots.some(root => path.startsWith(root));
    }
  }
  
  return true;
}