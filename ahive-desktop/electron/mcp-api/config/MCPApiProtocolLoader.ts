/**
 * MCP API 协议配置加载器
 * 
 * 从 mcp-api-protocols.yaml 加载平台模板配置
 */

import { app } from 'electron';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import log from 'electron-log';
import * as yaml from 'yaml';
import type { 
  MCPApiPlatformConfig, 
  MCPApiProtocolRegistry,
  InputField 
} from './MCPApiProtocolConfig';

/**
 * MCP API 协议加载器（单例）
 */
export class MCPApiProtocolLoader {
  private static instance: MCPApiProtocolLoader;
  private protocols: MCPApiProtocolRegistry | null = null;
  private configPaths: string[] = [];

  private constructor() {
    this.configPaths = this.getConfigPaths();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): MCPApiProtocolLoader {
    if (!MCPApiProtocolLoader.instance) {
      MCPApiProtocolLoader.instance = new MCPApiProtocolLoader();
    }
    return MCPApiProtocolLoader.instance;
  }

  private getConfigPaths(): string[] {
    const baseDir = app.isPackaged
      ? join(process.resourcesPath, '..')
      : join(__dirname, '..');

    return [
      join(baseDir, 'data/mcp-api-protocols.yaml'),
      join(baseDir, 'mcp-api-protocols.yaml'),
    ];
  }

  /**
   * 加载协议配置
   */
  load(): MCPApiProtocolRegistry {
    if (this.protocols) {
      return this.protocols;
    }

    for (const configPath of this.configPaths) {
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8');
          this.protocols = yaml.parse(content) as MCPApiProtocolRegistry;
          log.info(`[MCPApiProtocolLoader] Loaded protocols from: ${configPath}`);
          log.info(`[MCPApiProtocolLoader] Available platforms: ${Object.keys(this.protocols.platforms).join(', ')}`);
          return this.protocols;
        } catch (error) {
          log.error(`[MCPApiProtocolLoader] Failed to load from ${configPath}:`, error);
        }
      }
    }

    // 返回空配置
    log.warn('[MCPApiProtocolLoader] No protocol config found, using empty config');
    this.protocols = { platforms: {} };
    return this.protocols;
  }

  /**
   * 获取所有平台配置
   */
  getAllPlatforms(): MCPApiPlatformConfig[] {
    const registry = this.load();
    return Object.values(registry.platforms);
  }

  /**
   * 获取指定平台配置
   */
  getPlatform(platformId: string): MCPApiPlatformConfig | undefined {
    const registry = this.load();
    return registry.platforms[platformId];
  }

  /**
   * 获取平台列表（用于 UI 下拉框）
   */
  getPlatformList(): Array<{ id: string; name: string; description?: string }> {
    return this.getAllPlatforms().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description
    }));
  }

  /**
   * 获取平台的输入字段定义
   */
  getInputFields(platformId: string): InputField[] {
    log.info(`[MCPApiProtocolLoader] getInputFields called for: ${platformId}`);
    const platform = this.getPlatform(platformId);
    log.info(`[MCPApiProtocolLoader] Platform found:`, platform ? platform.name : 'NOT FOUND');
    const fields = platform?.inputFields || [];
    log.info(`[MCPApiProtocolLoader] Input fields count: ${fields.length}`);
    return fields;
  }

  /**
   * 获取默认平台
   */
  getDefaultPlatform(): string {
    const registry = this.load();
    return registry.defaultPlatform || 'bailian';
  }

  /**
   * 检查平台是否存在
   */
  hasPlatform(platformId: string): boolean {
    const registry = this.load();
    return platformId in registry.platforms;
  }
}

// 导出单例实例
export const mcpApiProtocolLoader = MCPApiProtocolLoader.getInstance();