/**
 * A2A 协议配置加载器
 * 
 * 加载和解析 YAML 配置文件，提供协议配置查询
 */

import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { A2AProtocolConfig, A2AProtocolRegistry, InputField } from './A2AProtocolConfig';
import { getDataDirectory } from '../../storage';

export class A2AProtocolLoader {
  private static instance: A2AProtocolLoader;
  private registry: A2AProtocolRegistry | null = null;

  private constructor() {}

  static getInstance(): A2AProtocolLoader {
    if (!A2AProtocolLoader.instance) {
      A2AProtocolLoader.instance = new A2AProtocolLoader();
    }
    return A2AProtocolLoader.instance;
  }

  /**
   * 获取配置文件路径（统一使用 data/a2a-protocols.yaml）
   */
  private getConfigPaths(): string[] {
    // 优先使用统一的数据目录
    const dataDir = getDataDirectory();
    
    return [
      // 首选：统一数据目录
      path.join(dataDir, 'a2a-protocols.yaml'),
      // 备选：旧路径（兼容）
      path.join(__dirname, '../protocols.yaml'),
      path.join(__dirname, '../../protocols.yaml'),
      path.join(process.resourcesPath || '', 'protocols.yaml'),
    ];
  }

  /**
   * 加载协议配置
   */
  load(): A2AProtocolRegistry {
    if (this.registry) {
      return this.registry;
    }

    const configPaths = this.getConfigPaths();
    
    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf-8');
          const raw = yaml.load(content) as any;
          
          // 处理 YAML 对象格式：将 { openclaw: {...} } 转换为 [ {...} ]
          if (raw && raw.protocols && !Array.isArray(raw.protocols)) {
            raw.protocols = Object.values(raw.protocols);
          }
          
          this.registry = raw as A2AProtocolRegistry;
          const count = this.registry?.protocols?.length || 0;
          log.info(`[A2AProtocolLoader] Loaded ${count} protocols from: ${configPath}`);
          return this.registry;
        }
      } catch (error) {
        log.warn(`[A2AProtocolLoader] Failed to load from ${configPath}:`, error);
      }
    }

    log.warn('[A2AProtocolLoader] No config file found, using defaults');
    return this.getDefaultRegistry();
  }

  /**
   * 重新加载配置
   */
  reload(): A2AProtocolRegistry {
    this.registry = null;
    return this.load();
  }

  /**
   * 获取协议配置
   */
  getProtocol(protocolId: string): A2AProtocolConfig | null {
    const registry = this.load();
    return registry.protocols.find(p => p.id === protocolId) || null;
  }

  /**
   * 获取所有协议
   */
  getAllProtocols(): A2AProtocolConfig[] {
    const registry = this.load();
    return registry.protocols;
  }

  /**
   * 获取默认协议
   */
  getDefaultProtocol(): A2AProtocolConfig | null {
    const registry = this.load();
    const defaultId = registry.defaultProtocol || registry.protocols[0]?.id;
    return this.getProtocol(defaultId);
  }

  /**
   * 检查协议是否存在
   */
  hasProtocol(protocolId: string): boolean {
    return this.getProtocol(protocolId) !== null;
  }

  /**
   * 获取协议列表（简化版）
   */
  getProtocolList(): Array<{ id: string; name: string; description?: string }> {
    return this.getAllProtocols().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description
    }));
  }

  /**
   * 获取协议的输入字段定义
   */
  getInputFields(protocolId: string): InputField[] {
    const protocol = this.getProtocol(protocolId);
    return protocol?.inputFields || [];
  }

  /**
   * 获取所有协议及其输入字段（供 UI 使用）
   */
  getProtocolsWithInputFields(): Array<{ 
    id: string; 
    name: string; 
    description?: string;
    inputFields: InputField[] 
  }> {
    return this.getAllProtocols().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      inputFields: p.inputFields || []
    }));
  }

  /**
   * 默认配置（当文件不存在时使用）
   */
  private getDefaultRegistry(): A2AProtocolRegistry {
    return {
      protocols: [
        {
          id: 'openclaw',
          name: 'OpenClaw OpenResponses',
          auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
          sendMessage: {
            path: '/v1/responses',
            method: 'POST',
            request: {
              template: { model: 'openclaw', input: '${message}', stream: false }
            },
            response: {
              paths: { text: 'output[0].content[0].text', status: 'status' }
            }
          }
        }
      ],
      defaultProtocol: 'openclaw'
    };
  }
}

export const protocolLoader = A2AProtocolLoader.getInstance();