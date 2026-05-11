/**
 * AHIVECORE 工具调用 System Prompt
 * 
 * 提供给通用模型使用的工具调用指令
 */

import type { ToolDefinition } from '../executor/types.js';

// 时间格式化工具（本地实现）
function getDateParts(date: Date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    dayOfWeek: date.getDay(),
  };
}

// ============ 工具调用 System Prompt ============

/**
 * 基础 System Prompt
 */
const BASE_SYSTEM_PROMPT = `你是 AHIVE 智能体，一个强大的本地助手。

## 能力
- 回答问题、闲聊对话
- 执行 Shell 命令
- 读写文件、管理目录
- 发送 HTTP 请求
- 抓取网页内容
- 获取系统信息

## 工具调用格式

当需要使用工具时，在回复中插入以下格式的标记：

[TOOL]{"name": "工具名", "arguments": {"参数名": "参数值"}}[/TOOL]

注意：
- name 是工具名称（必须精确匹配）
- arguments 是参数对象
- JSON 格式必须正确，字符串值需要转义引号
- 可以在一次回复中调用多个工具

## 重要规则

1. **普通聊天不需要工具** - 闲聊、问答、解释概念时直接回复，不要调用工具
2. **执行操作时先说明** - 用自然语言说明要做什么，然后调用工具
3. **工具调用后继续解释** - 执行工具后会显示结果，你可以继续解释
4. **可一次调用多个工具** - 如果需要执行多个独立操作，可以一次调用多个
5. **路径使用绝对路径** - 所有文件路径使用完整的绝对路径
6. **JSON 格式严格** - 确保参数值是有效的 JSON，特殊字符需要转义

## 错误处理

如果工具调用失败：
- 不要重复调用相同的工具
- 说明遇到的问题
- 建议替代方案或请用户提供更多信息`;

/**
 * 工具描述模板
 */
const TOOL_SECTION_TEMPLATE = `## 可用工具

### 文件操作
| 工具名 | 说明 | 参数 |
|--------|------|------|
| read_file | 读取文件内容 | path: 文件路径 |
| write_file | 写入文件 | path: 路径, content: 内容 |
| list_dir | 列出目录内容 | path: 目录路径 |
| delete_file | 删除文件 | path: 文件路径 |

### 系统操作
| 工具名 | 说明 | 参数 |
|--------|------|------|
| exec | 执行 Shell 命令 | command: 命令字符串 |
| get_time | 获取当前时间 | 无参数 |

### 网络操作
| 工具名 | 说明 | 参数 |
|--------|------|------|
| http_request | 发送 HTTP 请求 | url: 地址, method: 方法(GET/POST等), body: 请求体(可选) |
| web_fetch | 抓取网页内容 | url: 网页地址, extractMode: 提取模式(markdown/text) |`;

/**
 * 使用说明（通用，无具体路径污染）
 */
const USAGE_GUIDELINES = `## 使用说明

- 当用户要求创建文件或目录时，先确认路径，再执行操作
- 当用户要求访问网页时，使用 web_fetch 工具
- 当用户要求执行系统命令时，使用 exec 工具
- 执行操作前，先向用户说明你要做什么
- 操作完成后，简洁地报告结果`;

// ============ 导出函数 ============

/**
 * 获取完整的工具调用 System Prompt
 */
export function getToolCallingPrompt(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekDay = `星期${weekDays[now.getDay()]}`;
  
  const currentInfo = `## 当前时间

今天是 ${dateStr} ${weekDay}，当前时间 ${timeStr}。

当用户询问日期、时间相关问题时，请直接告知当前时间，无需调用工具。`;
  
  return [
    BASE_SYSTEM_PROMPT,
    '',
    currentInfo,
    '',
    TOOL_SECTION_TEMPLATE,
    '',
    USAGE_GUIDELINES,
  ].join('\n');
}

/**
 * 根据工具列表生成工具描述
 */
export function generateToolDescription(tools: ToolDefinition[]): string {
  const lines: string[] = ['## 可用工具', ''];
  
  const categories: Record<string, ToolDefinition[]> = {
    '文件操作': [],
    '系统操作': [],
    '网络操作': [],
    '其他': [],
  };
  
  for (const tool of tools) {
    if (tool.name.includes('file') || tool.name.includes('dir')) {
      categories['文件操作'].push(tool);
    } else if (tool.name.includes('exec') || tool.name.includes('time') || tool.name.includes('process')) {
      categories['系统操作'].push(tool);
    } else if (tool.name.includes('http') || tool.name.includes('web')) {
      categories['网络操作'].push(tool);
    } else {
      categories['其他'].push(tool);
    }
  }
  
  for (const [category, categoryTools] of Object.entries(categories)) {
    if (categoryTools.length === 0) continue;
    
    lines.push(`### ${category}`);
    lines.push('| 工具名 | 说明 | 参数 |');
    lines.push('|--------|------|------|');
    
    for (const tool of categoryTools) {
      const params = extractParamsFromSchema(tool.parameters);
      const paramsStr = params.length > 0 
        ? params.map(p => `${p.name}: ${p.type}`).join(', ')
        : '无参数';
      
      lines.push(`| ${tool.name} | ${tool.description} | ${paramsStr} |`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

function extractParamsFromSchema(schema: any): Array<{ name: string; type: string }> {
  const params: Array<{ name: string; type: string }> = [];
  
  try {
    const shape = schema._def?.shape || schema.shape;
    
    if (shape && typeof shape === 'object') {
      for (const [name, field] of Object.entries(shape)) {
        const typeName = (field as any)?._def?.typeName || 'unknown';
        let type = 'any';
        
        switch (typeName) {
          case 'ZodString': type = 'string'; break;
          case 'ZodNumber': type = 'number'; break;
          case 'ZodBoolean': type = 'boolean'; break;
          case 'ZodArray': type = 'array'; break;
          case 'ZodObject': type = 'object'; break;
          case 'ZodOptional': type = 'optional'; break;
        }
        
        params.push({ name, type });
      }
    }
  } catch (e) {
    // ignore
  }
  
  return params;
}

export function buildSystemPrompt(tools?: ToolDefinition[]): string {
  if (tools && tools.length > 0) {
    const toolSection = generateToolDescription(tools);
    return [BASE_SYSTEM_PROMPT, '', toolSection, '', USAGE_GUIDELINES].join('\n');
  }
  return getToolCallingPrompt();
}

export default { getToolCallingPrompt, buildSystemPrompt, generateToolDescription };