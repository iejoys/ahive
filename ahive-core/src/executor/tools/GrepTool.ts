/**
 * GrepTool - 文件内容搜索工具
 *
 * 使用 ripgrep 实现高性能的正则搜索
 */

import { z } from 'zod';
import type { AgentTool, ToolResult } from '../tool-system.js';
import { RipgrepEngine } from '../../utils/ripgrep.js';

/**
 * Grep 参数 Schema
 */
const GrepParamsSchema = z.object({
  pattern: z.string().describe('The regular expression pattern to search for in file contents'),
  path: z.string().optional().describe('The directory to search in. Defaults to current working directory.'),
  output_mode: z.enum(['content', 'files_with_matches', 'count']).optional().default('content')
    .describe('Output mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts'),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g., "*.ts", "**/*.tsx")'),
  '-i': z.boolean().optional().describe('Case insensitive search'),
  head_limit: z.number().optional().describe('Maximum number of results to return'),
});

type GrepParams = z.infer<typeof GrepParamsSchema>;

/**
 * GrepTool 定义
 */
export const GrepTool: AgentTool<GrepParams> = {
  name: 'Grep',
  label: 'search file contents',
  description: `High-performance file content search using ripgrep engine

**Key Features:**
- 10-100x faster than traditional grep commands
- Full regex syntax support
- Automatically respects .gitignore (skips node_modules, .git, etc.)
- Three output modes: content (show matching lines), files_with_matches (show file names only), count (show match statistics)

**Parameters:**
- pattern (required): Regex pattern to search for
- path (optional): Search directory, defaults to current working directory
- output_mode: Output format, defaults to content
- glob: File filter pattern (e.g., "*.ts", "**/*.tsx")
- -i: Case insensitive search
- head_limit: Limit result count, defaults to 100

**⚠️ Regex Escape Requirements:**
This tool uses ripgrep regex syntax. The following special characters must be escaped with backslash:
- Braces: {} must be written as \\{\\}
- Parentheses: () must be written as \\(\\)
- Brackets: [] must be written as \\[\\]
- Dot: . must be written as \\.
- Asterisk: * must be written as \\*
- Plus: + must be written as \\+
- Question mark: ? must be written as \\?
- Dollar sign: $ must be written as \\$
- Caret: ^ must be written as \\^

**Correct Examples:**
- Search for interface keyword: {"pattern": "interface"}
- Search for interface{} in Go: {"pattern": "interface\\\\{\\\\}"}
- Search for log errors: {"pattern": "log.*Error"}
- Search for function definitions: {"pattern": "function\\\\s+\\\\w+"}

**Common Mistakes:**
- ❌ {"pattern": "interface{}"} → regex syntax error
- ✅ {"pattern": "interface\\\\{\\\\}"} → correct
- ✅ {"pattern": "interface"} → recommended (simpler)

**Best Practices:**
1. Start with simple patterns (no special characters) for initial search
2. Use glob parameter to narrow search scope and improve performance
3. If search fails, try simplifying pattern or verify path exists
4. Avoid reading files one by one after Grep fails (inefficient, causes timeout)

**Troubleshooting:**
- Regex error → Simplify pattern, remove special characters
- Path error → Use Glob tool to verify path exists
- No results → Try different pattern or remove glob restriction
- Repeated failures → Ask user to confirm search target

**Tool Selection Guide:**
- Find by filename → Use Glob
- Find by content → Use Grep
- Complex multi-round search → Use spawn_agent

**Prohibited Actions:**
- Do not use exec to call grep, rg, Select-String or other shell commands
- Do not blindly read all files one by one after Grep fails
- Do not ignore Grep errors without trying alternative approaches`,

  parameters: GrepParamsSchema,

  /**
   * Execute Grep search
   */
  async execute(toolCallId, params, signal): Promise<ToolResult> {
    const start = Date.now();

    // Validate regex syntax before executing
    try {
      new RegExp(params.pattern);
    } catch (regexError) {
      const errorMsg = regexError instanceof Error ? regexError.message : String(regexError);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `Regex syntax error\n\n` +
                `Problematic pattern: "${params.pattern}"\n` +
                `Error: ${errorMsg}\n\n` +
                `Solutions:\n` +
                `1. Escape special characters: {} → \\{\\}, () → \\(\\), [] → \\[\\]\n` +
                `2. Use simpler pattern without special characters\n` +
                `3. Examples:\n` +
                `   Wrong: "interface{}"\n` +
                `   Correct: "interface\\\\{\\\\}"\n` +
                `   Recommended: "interface" (simpler)`
        }],
        error: `Invalid regex: ${errorMsg}`,
      };
    }

    try {
      const matches = await RipgrepEngine.grep(
        params.pattern,
        params.path,
        {
          glob: params.glob,
          ignoreCase: params['-i'],
          maxResults: params.head_limit ?? 100,
          signal,
        }
      );

      const durationMs = Date.now() - start;

      let text: string;
      if (matches.length === 0) {
        // No matches found, provide helpful suggestions
        const searchPath = params.path ?? 'current directory';
        const globInfo = params.glob ? `, glob: ${params.glob}` : '';
        const caseInfo = params['-i'] ? ' (case insensitive)' : '';
        text = `No matches found\n\n` +
              `Search details:\n` +
              `- pattern: "${params.pattern}"\n` +
              `- path: ${searchPath}${globInfo}${caseInfo}\n\n` +
              `Suggestions:\n` +
              `1. Try different or simpler pattern\n` +
              `2. Use Glob to verify path exists\n` +
              `3. Remove glob restriction to broaden search\n` +
              `4. Use -i flag for case insensitive search`;
      } else {
        switch (params.output_mode) {
          case 'files_with_matches':
            // Return unique file names only
            const uniqueFiles = [...new Set(matches.map(m => m.file))];
            text = `Found ${uniqueFiles.length} files:\n${uniqueFiles.join('\n')}`;
            break;

          case 'count':
            // Return match count per file
            const counts = new Map<string, number>();
            for (const m of matches) {
              counts.set(m.file, (counts.get(m.file) ?? 0) + 1);
            }
            const totalMatches = [...counts.values()].reduce((a, b) => a + b, 0);
            text = `Found ${totalMatches} matches across ${counts.size} files:\n${[...counts.entries()].map(([f, c]) => `${f}: ${c}`).join('\n')}`;
            break;

          default: // 'content'
            // Show matching content with locations
            const matchSummary = `Found ${matches.length} matches for pattern "${params.pattern}"`;
            text = matchSummary + '\n' + matches.map(m => `${m.file}:${m.line}: ${m.content}`).join('\n');
        }
      }

      return {
        success: true,
        content: [{ type: 'text' as const, text }],
        details: {
          numMatches: matches.length,
          durationMs,
          outputMode: params.output_mode,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      // Provide targeted solutions based on error type
      let errorText = `Grep search failed\n\nError: ${message}\n\n`;
      
      if (message.includes('ripgrep error') || message.includes('exitCode')) {
        errorText += `Possible causes:\n` +
                     `1. Invalid regex pattern (special characters not escaped)\n` +
                     `2. Search path does not exist\n` +
                     `3. Permission denied to access path\n\n`;
      }
      
      if (message.includes('not found') || message.includes('ENOENT')) {
        errorText += `Path error solutions:\n` +
                     `1. Use Glob to verify path: {"pattern": "**", "path": "${params.path || '.'}"}\n` +
                     `2. Use list_dir to explore directory structure\n` +
                     `3. Confirm path is relative to current working directory\n\n`;
      }
      
      errorText += `General solutions:\n` +
                   `1. Simplify pattern (remove special characters)\n` +
                   `2. Use Glob to verify path exists\n` +
                   `3. Try removing glob restriction\n` +
                   `4. If still failing, ask user to confirm search target`;
      
      return {
        success: false,
        content: [{ type: 'text' as const, text: errorText }],
        error: message,
      };
    }
  },
};

/**
 * 导出 Schema 类型
 */
export type { GrepParams };