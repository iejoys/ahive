/**
 * GlobTool - 文件模式匹配工具
 *
 * 使用 ripgrep 实现高性能的 glob 搜索
 */

import { z } from 'zod';
import type { AgentTool, ToolResult } from '../tool-system.js';
import { RipgrepEngine } from '../../utils/ripgrep.js';

/**
 * Glob 参数 Schema
 */
const GlobParamsSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files against (e.g., "**/*.ts", "src/**/*.tsx")'),
  path: z.string().optional().describe('The directory to search in. Defaults to current working directory.'),
});

type GlobParams = z.infer<typeof GlobParamsSchema>;

/**
 * GlobTool 定义
 */
export const GlobTool: AgentTool<GlobParams> = {
  name: 'Glob',
  label: 'find files by pattern',
  description: `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by file name
- Use this tool when you need to find files by name patterns

**重要规则：**
- ALWAYS use Glob for file name searches. NEVER invoke 'find', 'dir', 'ls -R' as an exec command
- Glob uses ripgrep engine which is 10-100x faster than shell commands
- Automatically respects .gitignore (skips node_modules, .git, etc.)
- When doing open-ended searches requiring multiple rounds, use spawn_agent instead

示例：
- 找所有 TypeScript 文件: { "pattern": "**/*.ts" }
- 找 src 目录下的组件: { "pattern": "src/components/**/*.tsx" }
- 找所有配置文件: { "pattern": "**/*.config.{js,ts,json}" }`,

  parameters: GlobParamsSchema,

  /**
   * 执行 Glob 搜索
   */
  async execute(toolCallId, params, signal): Promise<ToolResult> {
    const start = Date.now();

    try {
      const { files, truncated } = await RipgrepEngine.glob(
        params.pattern,
        params.path,
        { limit: 100, signal }
      );

      const durationMs = Date.now() - start;

      let text: string;
      if (files.length === 0) {
        text = 'No files found';
      } else {
        text = files.join('\n');
        if (truncated) {
          text += '\n\n(Results are truncated. Consider using a more specific path or pattern.)';
        }
      }

      return {
        success: true,
        content: [{ type: 'text' as const, text }],
        details: {
          numFiles: files.length,
          durationMs,
          truncated,
          pattern: params.pattern,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        error: message,
      };
    }
  },
};

/**
 * 导出 Schema 类型
 */
export type { GlobParams };