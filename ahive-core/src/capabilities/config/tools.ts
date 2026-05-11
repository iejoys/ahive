/**
 * 配置管理工具定义
 * 指挥官用于管理系统配置
 */

import { z } from 'zod';
import type { AgentTool } from '../../executor/tool-system.js';
import { errorResult } from '../../executor/tool-system.js';
import { getConfigManager } from './ConfigManager.js';
import { logger } from '../../utils/index.js';

/**
 * 获取配置工具
 */
const GetConfigParamsSchema = z.object({
  key: z.string().optional().describe('配置项键名，不提供则返回所有配置'),
  category: z.string().optional().describe('配置类别（system/model/workflow/ui）'),
});

export const getConfigTool: AgentTool<z.infer<typeof GetConfigParamsSchema>> = {
  name: 'get_config',
  label: 'get configuration',
  description: `获取系统配置。可以获取单个配置项或所有配置。

参数：
- key: 配置项键名（可选），不提供则返回所有配置
- category: 配置类别（可选），筛选指定类别的配置

可用配置类别：
- system: 系统配置（日志级别、最大智能体数等）
- model: 模型配置（默认提供商、模型名称等）
- workflow: 工作流配置（自动保存、精化层数等）
- ui: 界面配置（主题、语言等）

示例：
- 获取所有配置: get_config()
- 获取模型配置: get_config({ category: "model" })
- 获取单个配置: get_config({ key: "model.defaultModel" })`,
  parameters: GetConfigParamsSchema,
  
  async execute(toolCallId, params, signal) {
    try {
      const manager = getConfigManager();
      
      if (params.key) {
        // 获取单个配置
        const value = manager.get(params.key);
        const description = manager.getDescription(params.key);
        
        if (value === undefined) {
          return {
            success: false,
            content: [{
              type: 'text' as const,
              text: `未找到配置项: ${params.key}`,
            }],
          };
        }
        
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `${params.key} = ${JSON.stringify(value)}${description ? `\n说明: ${description}` : ''}`,
          }],
          details: { key: params.key, value, description },
        };
      } else if (params.category) {
        // 获取指定类别的配置
        const items = manager.getByCategory(params.category);
        
        const text = items.map(item => 
          `${item.key} = ${JSON.stringify(item.value)}${item.description ? `\n  说明: ${item.description}` : ''}`
        ).join('\n\n');
        
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `📋 ${params.category} 类别配置 (${items.length} 项):\n\n${text}`,
          }],
          details: { category: params.category, items },
        };
      } else {
        // 获取所有配置
        const items = manager.getAll();
        
        // 按类别分组
        const grouped: Record<string, typeof items> = {};
        for (const item of items) {
          if (!grouped[item.category]) {
            grouped[item.category] = [];
          }
          grouped[item.category].push(item);
        }
        
        const text = Object.entries(grouped).map(([category, categoryItems]) => {
          const categoryText = categoryItems.map(item =>
            `  ${item.key} = ${JSON.stringify(item.value)}`
          ).join('\n');
          return `### ${category}\n${categoryText}`;
        }).join('\n\n');
        
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `📋 系统配置 (${items.length} 项):\n\n${text}`,
          }],
          details: { items, grouped },
        };
      }
    } catch (error) {
      return errorResult('get_config', error);
    }
  },
};

/**
 * 设置配置工具
 */
const SetConfigParamsSchema = z.object({
  key: z.string().describe('配置项键名'),
  value: z.any().describe('配置值'),
});

export const setConfigTool: AgentTool<z.infer<typeof SetConfigParamsSchema>> = {
  name: 'set_config',
  label: 'set configuration',
  description: `设置系统配置项的值。

参数：
- key: 配置项键名
- value: 配置值（类型必须匹配配置项类型）

常用配置项：
- system.logLevel: 日志级别 (string: debug/info/warn/error)
- system.maxAgents: 最大并发智能体数 (number: 1-6)
- model.defaultProvider: 默认模型提供商 (string: openai/ollama/local)
- model.defaultModel: 默认模型名称 (string: gpt-4o/claude-3-opus/qwen-max)
- model.temperature: 模型温度 (number: 0-2)
- workflow.refinementLayers: 工作流精化层数 (number: 1-4)
- ui.theme: 界面主题 (string: dark/light)

示例：
- 设置日志级别: set_config({ key: "system.logLevel", value: "debug" })
- 设置最大智能体数: set_config({ key: "system.maxAgents", value: 4 })
- 设置默认模型: set_config({ key: "model.defaultModel", value: "gpt-4-turbo" })`,
  parameters: SetConfigParamsSchema,
  
  async execute(toolCallId, params, signal) {
    try {
      const manager = getConfigManager();
      
      // 检查配置项是否存在
      if (!manager.exists(params.key)) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 未知的配置项: ${params.key}\n\n可用配置项:\n${manager.getAll().map(i => `  - ${i.key}`).join('\n')}`,
          }],
        };
      }
      
      // 检查是否可编辑
      if (!manager.isEditable(params.key)) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 配置项不可编辑: ${params.key}`,
          }],
        };
      }
      
      // 获取旧值
      const oldValue = manager.get(params.key);
      
      // 设置新值
      const success = await manager.set(params.key, params.value);
      
      if (success) {
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `✅ 配置已更新: ${params.key}\n旧值: ${JSON.stringify(oldValue)}\n新值: ${JSON.stringify(params.value)}\n\n变更已同步到前端。`,
          }],
          details: { key: params.key, oldValue, newValue: params.value },
        };
      } else {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 配置设置失败，请检查值类型是否正确`,
          }],
        };
      }
    } catch (error) {
      return errorResult('set_config', error);
    }
  },
};

/**
 * 重置配置工具
 */
const ResetConfigParamsSchema = z.object({
  key: z.string().describe('配置项键名'),
});

export const resetConfigTool: AgentTool<z.infer<typeof ResetConfigParamsSchema>> = {
  name: 'reset_config',
  label: 'reset configuration',
  description: `重置配置项为默认值。

参数：
- key: 配置项键名

示例：
- 重置日志级别: reset_config({ key: "system.logLevel" })`,
  parameters: ResetConfigParamsSchema,
  
  async execute(toolCallId, params, signal) {
    try {
      const manager = getConfigManager();
      
      const oldValue = manager.get(params.key);
      const success = await manager.reset(params.key);
      
      if (success) {
        const newValue = manager.get(params.key);
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `✅ 配置已重置: ${params.key}\n旧值: ${JSON.stringify(oldValue)}\n新值: ${JSON.stringify(newValue)} (默认值)`,
          }],
          details: { key: params.key, oldValue, newValue },
        };
      } else {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 重置失败，配置项不存在: ${params.key}`,
          }],
        };
      }
    } catch (error) {
      return errorResult('reset_config', error);
    }
  },
};

/**
 * 配置管理工具列表
 */
export const configTools = [
  getConfigTool,
  setConfigTool,
  resetConfigTool,
];