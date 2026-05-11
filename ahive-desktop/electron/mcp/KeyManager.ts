/**
 * MCP Agent 密钥管理器
 * 
 * 负责 Agent 密钥的生成、验证、存储和轮换
 */

import log from 'electron-log';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 密钥记录
 */
interface KeyRecord {
  agentId: string;
  agentKey: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

/**
 * 密钥存储结构
 */
interface KeyStorage {
  keys: Record<string, KeyRecord>;
  lastUpdated: string;
}

/**
 * 密钥管理器配置
 */
interface KeyManagerConfig {
  /** 密钥有效期（天），0 表示永不过期 */
  keyTTL?: number;
  /** 存储文件路径 */
  storagePath?: string;
  /** 是否加密存储 */
  encrypt?: boolean;
}

/**
 * 密钥管理器
 */
export class KeyManager {
  private keys: Record<string, KeyRecord> = {};
  private storagePath: string;
  private keyTTL: number;
  private encrypt: boolean;
  private encryptionKey: string;

  constructor(config: KeyManagerConfig = {}) {
    this.keyTTL = config.keyTTL ?? 7; // 默认 7 天
    this.storagePath = config.storagePath ?? '';
    this.encrypt = config.encrypt ?? true;
    this.encryptionKey = this.generateEncryptionKey();
    
    // 加载已有密钥
    this.load();
  }

  /**
   * 设置存储路径
   */
  setStoragePath(storagePath: string): void {
    this.storagePath = storagePath;
    this.load();
  }

  /**
   * 生成 Agent 密钥
   * 格式: sk_{agentId}_{random8}
   */
  generateKey(agentId: string): string {
    const random = crypto.randomBytes(4).toString('hex');
    return `sk_${agentId}_${random}`;
  }

  /**
   * 为 Agent 创建新密钥
   */
  createKey(agentId: string): KeyRecord {
    const now = new Date().toISOString();
    const expiresAt = this.keyTTL > 0
      ? new Date(Date.now() + this.keyTTL * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const record: KeyRecord = {
      agentId,
      agentKey: this.generateKey(agentId),
      createdAt: now,
      expiresAt,
    };

    this.keys[agentId] = record;
    this.save();

    log.info(`[KeyManager] Created key for ${agentId}: ${record.agentKey.substring(0, 15)}...`);
    return record;
  }

  /**
   * 获取 Agent 密钥
   */
  getKey(agentId: string): KeyRecord | null {
    return this.keys[agentId] || null;
  }

  /**
   * 验证密钥
   */
  verifyKey(agentKey: string): { valid: boolean; agentId?: string; error?: string } {
    // 解析密钥格式
    const match = agentKey.match(/^sk_(.+)_[a-f0-9]{8}$/);
    if (!match) {
      return { valid: false, error: 'Invalid key format' };
    }

    const agentId = match[1];
    const record = this.keys[agentId];

    if (!record) {
      return { valid: false, error: 'Key not found' };
    }

    if (record.agentKey !== agentKey) {
      return { valid: false, error: 'Key mismatch' };
    }

    // 检查过期
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return { valid: false, error: 'Key expired' };
    }

    // 更新最后使用时间
    record.lastUsedAt = new Date().toISOString();
    this.save();

    return { valid: true, agentId };
  }

  /**
   * 轮换密钥
   */
  rotateKey(agentId: string): KeyRecord | null {
    const existing = this.keys[agentId];
    if (!existing) {
      log.warn(`[KeyManager] No existing key for ${agentId}, creating new`);
      return this.createKey(agentId);
    }

    log.info(`[KeyManager] Rotating key for ${agentId}`);
    return this.createKey(agentId);
  }

  /**
   * 删除密钥
   */
  deleteKey(agentId: string): boolean {
    if (!this.keys[agentId]) {
      return false;
    }

    delete this.keys[agentId];
    this.save();
    log.info(`[KeyManager] Deleted key for ${agentId}`);
    return true;
  }

  /**
   * 列出所有密钥（脱敏）
   */
  listKeys(): Array<{ agentId: string; createdAt: string; expiresAt?: string }> {
    return Object.values(this.keys).map(record => ({
      agentId: record.agentId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    }));
  }

  /**
   * 检查并清理过期密钥
   */
  cleanExpired(): string[] {
    const now = new Date();
    const expired: string[] = [];

    for (const [agentId, record] of Object.entries(this.keys)) {
      if (record.expiresAt && new Date(record.expiresAt) < now) {
        expired.push(agentId);
        delete this.keys[agentId];
      }
    }

    if (expired.length > 0) {
      this.save();
      log.info(`[KeyManager] Cleaned ${expired.length} expired keys`);
    }

    return expired;
  }

  /**
   * 加载密钥存储
   */
  private load(): void {
    if (!this.storagePath) {
      return;
    }

    try {
      const filePath = path.join(this.storagePath, 'agent-keys.json');
      if (!fs.existsSync(filePath)) {
        log.info('[KeyManager] No existing key storage found');
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const data: KeyStorage = JSON.parse(content);

      // 解密密钥（如果加密存储）
      if (this.encrypt) {
        for (const agentId of Object.keys(data.keys)) {
          const record = data.keys[agentId];
          record.agentKey = this.decryptValue(record.agentKey);
        }
      }

      this.keys = data.keys;
      log.info(`[KeyManager] Loaded ${Object.keys(this.keys).length} keys`);
    } catch (error) {
      log.error('[KeyManager] Failed to load keys:', error);
      this.keys = {};
    }
  }

  /**
   * 保存密钥存储
   */
  private save(): void {
    if (!this.storagePath) {
      return;
    }

    try {
      // 确保目录存在
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }

      // 加密密钥（如果需要）
      const keysToSave: Record<string, KeyRecord> = {};
      for (const [agentId, record] of Object.entries(this.keys)) {
        keysToSave[agentId] = {
          ...record,
          agentKey: this.encrypt ? this.encryptValue(record.agentKey) : record.agentKey,
        };
      }

      const data: KeyStorage = {
        keys: keysToSave,
        lastUpdated: new Date().toISOString(),
      };

      const filePath = path.join(this.storagePath, 'agent-keys.json');
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      log.debug('[KeyManager] Keys saved');
    } catch (error) {
      log.error('[KeyManager] Failed to save keys:', error);
    }
  }

  /**
   * 生成加密密钥
   */
  private generateEncryptionKey(): string {
    // 使用机器信息生成固定加密密钥
    const hostname = require('os').hostname();
    const platform = process.platform;
    return crypto.createHash('sha256')
      .update(`ahive-mcp-keys-${hostname}-${platform}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * 加密值
   */
  private encryptValue(value: string): string {
    if (!this.encrypt) return value;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey),
      iv
    );

    let encrypted = cipher.update(value, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    return `enc:${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * 解密值
   */
  private decryptValue(value: string): string {
    if (!this.encrypt || !value.startsWith('enc:')) {
      return value;
    }

    try {
      const [, ivHex, encrypted] = value.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(this.encryptionKey),
        iv
      );

      let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      return decrypted;
    } catch (error) {
      log.error('[KeyManager] Failed to decrypt value');
      return value;
    }
  }
}

// 单例导出
export const keyManager = new KeyManager();