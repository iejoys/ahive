/**
 * Hook 发现机制
 * 
 * 参考: codex-rs/hooks/src/engine/discovery.rs
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/index.js';
import type { ConfiguredHandler } from '../types.js';
import { parseHooksConfig, type HooksFileJson, DEFAULT_HOOKS_CONFIG } from './config.js';

// ============ Hook 发现 ============

/**
 * 发现结果
 * 参考: codex-rs/hooks/src/engine/discovery.rs DiscoveryResult
 */
export interface DiscoveryResult {
  /** 发现的 handlers */
  handlers: ConfiguredHandler[];
  /** 发现的 hooks.json 路径 */
  sourcePaths: string[];
  /** 错误信息 */
  errors: string[];
}

/**
 * 默认 hooks.json 文件名
 */
export const HOOKS_FILE_NAME = 'hooks.json';

/**
 * 发现 hooks.json 并解析
 * 
 * 参考: codex-rs/hooks/src/engine/discovery.rs discover_handlers
 */
export async function discoverHandlers(
  cwd: string,
  configFolders: string[] = []
): Promise<DiscoveryResult> {
  const handlers: ConfiguredHandler[] = [];
  const sourcePaths: string[] = [];
  const errors: string[] = [];

  // 构建搜索路径列表
  const searchPaths: string[] = [cwd, ...configFolders];

  // 添加默认配置路径
  const defaultConfigPath = path.join(cwd, '.codex', HOOKS_FILE_NAME);
  searchPaths.push(path.dirname(defaultConfigPath));

  // 去重
  const uniquePaths = Array.from(new Set(searchPaths));

  // 按优先级顺序搜索 (后面的配置覆盖前面的)
  for (const searchPath of uniquePaths) {
    const hooksPath = path.join(searchPath, HOOKS_FILE_NAME);

    try {
      const stat = await fs.stat(hooksPath);
      if (stat.isFile()) {
        const content = await fs.readFile(hooksPath, 'utf-8');
        const json: HooksFileJson = JSON.parse(content);

        const parsedHandlers = parseHooksConfig(json, hooksPath);
        handlers.push(...parsedHandlers);
        sourcePaths.push(hooksPath);

        logger.info(`[HookDiscovery] 发现 hooks 配置: ${hooksPath} (${parsedHandlers.length} handlers)`);
      }
    } catch (err) {
      // 文件不存在是正常的，不记录错误
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        const errorMsg = `解析 ${hooksPath} 失败: ${(err as Error).message}`;
        errors.push(errorMsg);
        logger.warn(`[HookDiscovery] ${errorMsg}`);
      }
    }
  }

  // 按 displayOrder 排序
  handlers.sort((a, b) => a.displayOrder - b.displayOrder);

  return { handlers, sourcePaths, errors };
}

/**
 * 从单个文件加载 handlers
 */
export async function loadHandlersFromFile(
  hooksPath: string
): Promise<ConfiguredHandler[]> {
  try {
    const content = await fs.readFile(hooksPath, 'utf-8');
    const json: HooksFileJson = JSON.parse(content);
    return parseHooksConfig(json, hooksPath);
  } catch (err) {
    logger.error(`[HookDiscovery] 加载 ${hooksPath} 失败: ${(err as Error).message}`);
    return [];
  }
}

/**
 * 验证 hooks.json 格式
 */
export async function validateHooksFile(
  hooksPath: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    const content = await fs.readFile(hooksPath, 'utf-8');
    const json: unknown = JSON.parse(content);

    // 基本结构验证
    if (typeof json !== 'object' || json === null) {
      errors.push('配置必须是对象');
      return { valid: false, errors };
    }

    const config = json as Record<string, unknown>;

    if (config.hooks && typeof config.hooks !== 'object') {
      errors.push('hooks 必须是对象');
    }

    // 验证每个事件类型
    const validEventTypes = ['SessionStart', 'Stop', 'AfterAgent', 'AfterToolUse'];

    if (config.hooks) {
      const hooks = config.hooks as Record<string, unknown>;

      for (const [eventType, groups] of Object.entries(hooks)) {
        if (!validEventTypes.includes(eventType)) {
          errors.push(`未知的事件类型: ${eventType}`);
          continue;
        }

        if (!Array.isArray(groups)) {
          errors.push(`${eventType} 必须是数组`);
          continue;
        }

        for (let i = 0; i < groups.length; i++) {
          const group = groups[i] as Record<string, unknown>;

          if (group.hooks && !Array.isArray(group.hooks)) {
            errors.push(`${eventType}[${i}].hooks 必须是数组`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  } catch (err) {
    errors.push(`解析失败: ${(err as Error).message}`);
    return { valid: false, errors };
  }
}

/**
 * 生成默认 hooks.json 模板
 */
export function generateDefaultHooksJson(): string {
  return JSON.stringify(DEFAULT_HOOKS_CONFIG, null, 2);
}