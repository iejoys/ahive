/**
 * MCP 能力管理器
 * 
 * 负责 Agent 与 MCP 工具的能力绑定管理
 */

import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { KeyManager, keyManager } from './KeyManager';

/**
 * 工具权限
 */
interface ToolPermission {
  server: string;
  serverType?: 'mcp-server' | 'mcp-api';  // 服务类型，默认 mcp-server
  tools: string[];  // 空数组表示全部工具
}

/**
 * 能力绑定记录
 */
export interface CapabilityBinding {
  agentId: string;
  agentKey: string;
  capabilities: ToolPermission[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 能力存储结构
 */
interface CapabilityStorage {
  bindings: Record<string, CapabilityBinding>;
  lastUpdated: string;
}

/**
 * 能力变更事件
 */
export interface CapabilityChangeEvent {
  type: 'add' | 'remove' | 'update';
  agentId: string;
  binding: CapabilityBinding;
  changes?: {
    added?: ToolPermission[];
    removed?: ToolPermission[];
  };
}

/**
 * 能力管理器配置
 */
interface CapabilityManagerConfig {
  storagePath?: string;
}

/**
 * 能力管理器
 */
export class CapabilityManager extends EventEmitter {
  private bindings: Record<string, CapabilityBinding> = {};
  private storagePath: string = '';

  constructor(config: CapabilityManagerConfig = {}) {
    super();
    if (config.storagePath) {
      this.setStoragePath(config.storagePath);
    }
  }

  /**
   * 设置存储路径
   */
  setStoragePath(storagePath: string): void {
    this.storagePath = storagePath;
    this.load();
  }

  /**
   * 为 Agent 绑定能力
   */
  bindCapabilities(
    agentId: string,
    capabilities: ToolPermission[]
  ): CapabilityBinding {
    const now = new Date().toISOString();
    const existing = this.bindings[agentId];

    // 获取或创建密钥
    let agentKey: string;
    if (existing) {
      agentKey = existing.agentKey;
    } else {
      const keyRecord = keyManager.createKey(agentId);
      agentKey = keyRecord.agentKey;
    }

    // 计算变更
    const changes = existing ? this.calculateChanges(
      existing.capabilities,
      capabilities
    ) : { added: capabilities, removed: [] };

    // 创建绑定记录
    const binding: CapabilityBinding = {
      agentId,
      agentKey,
      capabilities,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.bindings[agentId] = binding;
    this.save();

    // 发出事件
    this.emit('capability-change', {
      type: existing ? 'update' : 'add',
      agentId,
      binding,
      changes,
    } as CapabilityChangeEvent);

    log.info(`[CapabilityManager] Bound capabilities for ${agentId}: ${capabilities.length} servers`);
    return binding;
  }

  /**
   * 为 Agent 解绑能力
   */
  unbindCapabilities(
    agentId: string,
    capabilities: ToolPermission[]
  ): CapabilityBinding | null {
    const existing = this.bindings[agentId];
    if (!existing) {
      return null;
    }

    // 移除指定的能力
    const remainingCapabilities = existing.capabilities.filter(existingCap => {
      const removeCap = capabilities.find(c => c.server === existingCap.server);
      if (!removeCap) return true;

      // 如果要移除的是整个服务器
      if (removeCap.tools.length === 0) return false;

      // 移除特定工具
      existingCap.tools = existingCap.tools.filter(
        tool => !removeCap.tools.includes(tool)
      );

      return existingCap.tools.length > 0;
    });

    if (remainingCapabilities.length === 0) {
      // 完全解绑
      delete this.bindings[agentId];
      keyManager.deleteKey(agentId);
      this.save();

      this.emit('capability-change', {
        type: 'remove',
        agentId,
        binding: existing,
        changes: { removed: capabilities },
      } as CapabilityChangeEvent);

      log.info(`[CapabilityManager] Unbound all capabilities for ${agentId}`);
      return null;
    }

    // 部分解绑
    const binding: CapabilityBinding = {
      ...existing,
      capabilities: remainingCapabilities,
      updatedAt: new Date().toISOString(),
    };

    this.bindings[agentId] = binding;
    this.save();

    this.emit('capability-change', {
      type: 'update',
      agentId,
      binding,
      changes: { removed: capabilities },
    } as CapabilityChangeEvent);

    log.info(`[CapabilityManager] Unbound ${capabilities.length} capabilities for ${agentId}`);
    return binding;
  }

  /**
   * 获取 Agent 的能力绑定
   */
  getBinding(agentId: string): CapabilityBinding | null {
    return this.bindings[agentId] || null;
  }

  /**
   * 获取 Agent 的密钥
   */
  getAgentKey(agentId: string): string | null {
    return this.bindings[agentId]?.agentKey || null;
  }

  /**
   * 检查 Agent 是否有权限调用指定工具
   */
  hasPermission(
    agentId: string,
    server: string,
    tool: string
  ): boolean {
    const binding = this.bindings[agentId];
    if (!binding) return false;

    const serverPermission = binding.capabilities.find(
      cap => cap.server === server
    );

    if (!serverPermission) return false;

    // 空数组表示全部工具
    if (serverPermission.tools.length === 0) return true;

    return serverPermission.tools.includes(tool);
  }

  /**
   * 获取 Agent 可用的工具列表
   */
  getAvailableTools(agentId: string): ToolPermission[] {
    const binding = this.bindings[agentId];
    return binding?.capabilities || [];
  }

  /**
   * 列出所有绑定
   */
  listBindings(): CapabilityBinding[] {
    return Object.values(this.bindings);
  }

  /**
   * 删除 Agent 的所有绑定
   */
  deleteBinding(agentId: string): boolean {
    const existing = this.bindings[agentId];
    if (!existing) return false;

    delete this.bindings[agentId];
    keyManager.deleteKey(agentId);
    this.save();

    this.emit('capability-change', {
      type: 'remove',
      agentId,
      binding: existing,
    } as CapabilityChangeEvent);

    log.info(`[CapabilityManager] Deleted binding for ${agentId}`);
    return true;
  }

  /**
   * 轮换 Agent 密钥
   */
  rotateKey(agentId: string): string | null {
    const binding = this.bindings[agentId];
    if (!binding) return null;

    const newKeyRecord = keyManager.rotateKey(agentId);
    binding.agentKey = newKeyRecord.agentKey;
    binding.updatedAt = new Date().toISOString();

    this.save();

    this.emit('capability-change', {
      type: 'update',
      agentId,
      binding,
    } as CapabilityChangeEvent);

    log.info(`[CapabilityManager] Rotated key for ${agentId}`);
    return binding.agentKey;
  }

  /**
   * 计算能力变更
   */
  private calculateChanges(
    oldCapabilities: ToolPermission[],
    newCapabilities: ToolPermission[]
  ): { added: ToolPermission[]; removed: ToolPermission[] } {
    const added: ToolPermission[] = [];
    const removed: ToolPermission[] = [];

    // 查找新增的
    for (const newCap of newCapabilities) {
      const oldCap = oldCapabilities.find(c => c.server === newCap.server);
      if (!oldCap) {
        added.push(newCap);
      } else if (newCap.tools.length === 0 && oldCap.tools.length > 0) {
        // 从特定工具变为全部工具
        added.push(newCap);
      } else if (newCap.tools.length > 0 && oldCap.tools.length > 0) {
        // 检查新增的工具
        const newTools = newCap.tools.filter(t => !oldCap.tools.includes(t));
        if (newTools.length > 0) {
          added.push({ server: newCap.server, tools: newTools });
        }
      }
    }

    // 查找移除的
    for (const oldCap of oldCapabilities) {
      const newCap = newCapabilities.find(c => c.server === oldCap.server);
      if (!newCap) {
        removed.push(oldCap);
      } else if (oldCap.tools.length === 0 && newCap.tools.length > 0) {
        // 从全部工具变为特定工具
        removed.push(oldCap);
      } else if (oldCap.tools.length > 0 && newCap.tools.length > 0) {
        // 检查移除的工具
        const removedTools = oldCap.tools.filter(t => !newCap.tools.includes(t));
        if (removedTools.length > 0) {
          removed.push({ server: oldCap.server, tools: removedTools });
        }
      }
    }

    return { added, removed };
  }

  /**
   * 加载存储
   */
  private load(): void {
    if (!this.storagePath) return;

    try {
      const filePath = path.join(this.storagePath, 'agent-mcp-bindings.json');
      if (!fs.existsSync(filePath)) {
        log.info('[CapabilityManager] No existing bindings found');
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const data: CapabilityStorage = JSON.parse(content);
      this.bindings = data.bindings || {};

      // 同步密钥到 KeyManager
      for (const binding of Object.values(this.bindings)) {
        const keyRecord = keyManager.getKey(binding.agentId);
        if (!keyRecord) {
          // KeyManager 中没有，创建一个（使用现有密钥）
          keyManager.createKey(binding.agentId);
          // 注意：这里密钥会重新生成，需要更新绑定
        }
      }

      log.info(`[CapabilityManager] Loaded ${Object.keys(this.bindings).length} bindings`);
    } catch (error) {
      log.error('[CapabilityManager] Failed to load bindings:', error);
      this.bindings = {};
    }
  }

  /**
   * 保存存储
   */
  private save(): void {
    if (!this.storagePath) return;

    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }

      const data: CapabilityStorage = {
        bindings: this.bindings,
        lastUpdated: new Date().toISOString(),
      };

      const filePath = path.join(this.storagePath, 'agent-mcp-bindings.json');
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      log.debug('[CapabilityManager] Bindings saved');
    } catch (error) {
      log.error('[CapabilityManager] Failed to save bindings:', error);
    }
  }
}

// 单例导出
export const capabilityManager = new CapabilityManager();