/**
 * A2A 客户端工厂
 * 根据协议类型创建对应的客户端实例
 * 
 * 支持两种模式:
 * 1. 配置驱动模式 (推荐) - 使用 GenericA2AClient，根据 protocols.yaml 配置工作
 * 2. 专用客户端模式 - 使用特定客户端实现
 */

import log from 'electron-log';
import type { A2AAgentConfig } from '../../storage';
import type { IA2AClient, IA2AClientFactory } from './IA2AClient';
import { GenericA2AClient } from './GenericA2AClient';
import { A2AStandardClient } from './A2AStandardClient';
import { OpenClawClient } from './OpenClawClient';
import { AHIVECoreClient } from './AHIVECoreClient';
import { A2AProtocolLoader } from '../config/A2AProtocolLoader';

/**
 * 支持的协议类型
 */
export type A2AProtocolType = 
  | 'a2a-standard'  // 标准 A2A 协议
  | 'openclaw'      // OpenClaw OpenResponses 协议
  | 'opencode'      // OpenCode Serve API
  | 'ahivecore';    // AHIVECORE 本地智能体核心

/**
 * 客户端创建选项
 */
export interface ClientCreationOptions {
  /** 是否使用配置驱动模式 (默认 true) */
  useConfigDriven?: boolean;
}

/**
 * 协议类型映射到专用客户端类 (配置驱动模式禁用时使用)
 */
const LEGACY_CLIENT_MAP: Record<string, new (config: A2AAgentConfig) => IA2AClient> = {
  'a2a-standard': A2AStandardClient,
  'openclaw': OpenClawClient,
  'opencode': A2AStandardClient,
  'ahivecore': AHIVECoreClient,  // AHIVECORE 本地智能体核心
};

/**
 * A2A 客户端工厂
 */
/**
 * A2A 客户端工厂
 */
export class A2AClientFactory implements IA2AClientFactory {
  private useConfigDriven: boolean = true;

  /**
   * 设置是否使用配置驱动模式
   */
  setConfigDrivenMode(enabled: boolean): void {
    this.useConfigDriven = enabled;
    log.info(`[A2AClientFactory] Config-driven mode: ${enabled}`);
  }

  /**
   * 创建客户端实例
   */
  createClient(config: A2AAgentConfig, options?: ClientCreationOptions): IA2AClient {
    const useConfig = options?.useConfigDriven ?? this.useConfigDriven;

    // 配置驱动模式 - 使用 GenericA2AClient
    if (useConfig) {
      return this.createConfigDrivenClient(config);
    }

    // 传统模式 - 使用专用客户端
    return this.createLegacyClient(config);
  }

  /**
   * 创建配置驱动的客户端
   */
  private createConfigDrivenClient(config: A2AAgentConfig): IA2AClient {
    const protocolType = config.protocolType || 'openclaw';
    
    // 检查协议配置是否存在
    const loader = A2AProtocolLoader.getInstance();
    const protocolConfig = loader.getProtocol(protocolType);

    if (!protocolConfig) {
      log.warn(`[A2AClientFactory] Protocol config not found: ${protocolType}, using legacy client`);
      return this.createLegacyClient(config);
    }

    log.info(`[A2AClientFactory] Creating config-driven ${protocolType} client for ${config.name}`);
    return new GenericA2AClient(config);
  }

  /**
   * 创建传统专用客户端
   */
  private createLegacyClient(config: A2AAgentConfig): IA2AClient {
    const protocolType = this.detectProtocolType(config);
    const ClientClass = LEGACY_CLIENT_MAP[protocolType];

    if (!ClientClass) {
      log.warn(`[A2AClientFactory] Unknown protocol type: ${protocolType}, using standard A2A`);
      return new A2AStandardClient(config);
    }

    log.info(`[A2AClientFactory] Creating legacy ${protocolType} client for ${config.name}`);
    return new ClientClass(config);
  }

  /**
   * 获取支持的协议类型
   */
  getSupportedProtocols(): string[] {
    // 从配置文件获取
    const loader = A2AProtocolLoader.getInstance();
    const protocols = loader.getAllProtocols();
    
    if (protocols.length > 0) {
      return protocols.map(p => p.id);
    }

    // 回退到传统列表
    return Object.keys(LEGACY_CLIENT_MAP);
  }

  /**
   * 获取协议列表（带名称和描述）
   */
  getProtocolList(): Array<{ id: string; name: string; description?: string }> {
    const loader = A2AProtocolLoader.getInstance();
    return loader.getProtocolList();
  }

  /**
   * 检测协议类型
   */
  private detectProtocolType(config: A2AAgentConfig): A2AProtocolType {
    // 如果配置中明确指定了协议类型
    const explicitType = config.protocolType;
    if (explicitType && LEGACY_CLIENT_MAP[explicitType]) {
      return explicitType as A2AProtocolType;
    }

    // 根据 endpoint 特征自动检测
    const endpoint = config.endpoint.toLowerCase();

    // AHIVECORE 特征 (端口 18790)
    if (
      endpoint.includes('ahivecore') ||
      endpoint.includes(':18790') ||
      endpoint.includes('/chat/stream')
    ) {
      return 'ahivecore';
    }

    // OpenClaw Gateway 特征
    if (
      endpoint.includes('openclaw') ||
      endpoint.includes(':18789') ||
      endpoint.includes('/v1/responses')
    ) {
      return 'openclaw';
    }

    // OpenCode 特征
    if (
      endpoint.includes(':809') ||
      endpoint.includes('/session') ||
      endpoint.includes('/global/event')
    ) {
      return 'opencode';
    }

    // 默认使用标准 A2A
    return 'a2a-standard';
  }
}


// 单例导出
export const a2aClientFactory = new A2AClientFactory();
