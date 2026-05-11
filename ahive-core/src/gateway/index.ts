/**
 * Gateway Core - 从 OpenClaw 复用的网关核心
 * 
 * 原路径：openclaw-main/src/gateway/
 * 
 * 功能：
 * - HTTP 服务器
 * - WebSocket 支持
 * - 认证与授权
 */

// ============ 核心接口 ============

/**
 * 网关配置
 */
export interface GatewayConfig {
  /** 服务端口 */
  port: number;
  /** 服务主机 */
  host?: string;
  /** 是否启用 HTTPS */
  https?: boolean;
  /** SSL 证书路径 */
  sslCert?: string;
  /** SSL 密钥路径 */
  sslKey?: string;
  /** 认证配置 */
  auth?: AuthConfig;
  /** CORS 配置 */
  cors?: CorsConfig;
}

/**
 * 认证配置
 */
export interface AuthConfig {
  /** 认证类型 */
  type: 'none' | 'api-key' | 'jwt' | 'oauth';
  /** API Key（如果使用） */
  apiKey?: string;
  /** JWT 密钥（如果使用） */
  jwtSecret?: string;
  /** Token 过期时间 */
  tokenExpiry?: string;
}

/**
 * CORS 配置
 */
export interface CorsConfig {
  /** 允许的源 */
  origins?: string[];
  /** 允许的方法 */
  methods?: string[];
  /** 允许的头部 */
  allowedHeaders?: string[];
}

/**
 * HTTP 请求
 */
export interface HttpRequest {
  /** 请求方法 */
  method: string;
  /** 请求路径 */
  path: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体 */
  body?: any;
  /** 查询参数 */
  query?: Record<string, string>;
  /** 路径参数 */
  params?: Record<string, string>;
}

/**
 * HTTP 响应
 */
export interface HttpResponse {
  /** 状态码 */
  status: number;
  /** 响应头 */
  headers?: Record<string, string>;
  /** 响应体 */
  body?: any;
}

/**
 * 路由处理器
 */
export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

/**
 * 中间件
 */
export type Middleware = (req: HttpRequest, next: () => Promise<HttpResponse>) => Promise<HttpResponse>;

// ============ 简单 HTTP 服务器 ============

/**
 * 简单 HTTP 服务器（模拟实现）
 * 
 * 注：完整版本应使用 Node.js http/https 模块
 */
export class SimpleHttpServer {
  private config: GatewayConfig;
  private routes: Map<string, RouteHandler> = new Map();
  private middlewares: Middleware[] = [];
  private running: boolean = false;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  /**
   * 注册路由
   */
  route(method: string, path: string, handler: RouteHandler): void {
    const key = `${method.toUpperCase()} ${path}`;
    this.routes.set(key, handler);
  }

  /**
   * 注册中间件
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Server is already running');
    }

    this.running = true;
    console.log(`[Gateway] Server starting on port ${this.config.port}...`);
    
    // 模拟启动
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log(`[Gateway] Server running on http://${this.config.host || 'localhost'}:${this.config.port}`);
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    this.running = false;
    console.log('[Gateway] Server stopped');
  }

  /**
   * 处理请求（模拟）
   */
  async handleRequest(req: HttpRequest): Promise<HttpResponse> {
    const key = `${req.method.toUpperCase()} ${req.path}`;
    const handler = this.routes.get(key);

    if (!handler) {
      return { status: 404, body: { error: 'Not found' } };
    }

    try {
      // 执行中间件
      let response: HttpResponse = { status: 200 };
      
      for (const middleware of this.middlewares) {
        response = await middleware(req, async () => handler(req));
        if (response.status !== 200) {
          return response;
        }
      }

      return await handler(req);
    } catch (error) {
      console.error('[Gateway] Error handling request:', error);
      return { 
        status: 500, 
        body: { error: error instanceof Error ? error.message : String(error) } 
      };
    }
  }

  /**
   * 检查是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }
}

// ============ 认证管理器 ============

/**
 * 认证结果
 */
export interface AuthResult {
  /** 是否认证成功 */
  success: boolean;
  /** 用户 ID */
  userId?: string;
  /** 权限列表 */
  permissions?: string[];
  /** 错误信息 */
  error?: string;
}

/**
 * 认证管理器
 */
export class AuthManager {
  private config: AuthConfig;
  private apiKeys: Map<string, AuthResult> = new Map();

  constructor(config: AuthConfig) {
    this.config = config;

    // 初始化 API Key
    if (config.type === 'api-key' && config.apiKey) {
      this.apiKeys.set(config.apiKey, {
        success: true,
        userId: 'admin',
        permissions: ['*'],
      });
    }
  }

  /**
   * 验证请求
   */
  async authenticate(req: HttpRequest): Promise<AuthResult> {
    switch (this.config.type) {
      case 'none':
        return { success: true, userId: 'anonymous', permissions: ['*'] };

      case 'api-key':
        return this.authenticateApiKey(req);

      case 'jwt':
        return this.authenticateJwt(req);

      default:
        return { success: false, error: 'Unknown auth type' };
    }
  }

  /**
   * API Key 认证
   */
  private authenticateApiKey(req: HttpRequest): AuthResult {
    const apiKey = req.headers['x-api-key'] || req.query?.['api_key'];

    if (!apiKey) {
      return { success: false, error: 'Missing API key' };
    }

    const auth = this.apiKeys.get(apiKey);
    if (!auth) {
      return { success: false, error: 'Invalid API key' };
    }

    return auth;
  }

  /**
   * JWT 认证（简化版）
   */
  private authenticateJwt(req: HttpRequest): AuthResult {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'Missing or invalid authorization header' };
    }

    const token = authHeader.substring(7);

    // 简化实现：不验证 JWT 签名
    if (token) {
      return { success: true, userId: 'user', permissions: ['read'] };
    }

    return { success: false, error: 'Invalid token' };
  }

  /**
   * 添加 API Key
   */
  addApiKey(key: string, userId: string, permissions: string[]): void {
    this.apiKeys.set(key, {
      success: true,
      userId,
      permissions,
    });
  }

  /**
   * 移除 API Key
   */
  removeApiKey(key: string): void {
    this.apiKeys.delete(key);
  }
}

// ============ 辅助函数 ============

/**
 * 创建网关配置
 */
export function createGatewayConfig(port: number = 18789): GatewayConfig {
  return {
    port,
    host: '127.0.0.1',
    auth: {
      type: 'none',
    },
  };
}

/**
 * 创建 HTTP 服务器
 */
export function createHttpServer(config: GatewayConfig): SimpleHttpServer {
  return new SimpleHttpServer(config);
}

/**
 * 创建认证管理器
 */
export function createAuthManager(config: AuthConfig): AuthManager {
  return new AuthManager(config);
}

/**
 * 日志中间件
 */
export function loggingMiddleware(): Middleware {
  return async (req, next) => {
    console.log(`[HTTP] ${req.method} ${req.path}`);
    return next();
  };
}

/**
 * 认证中间件
 */
export function authMiddleware(authManager: AuthManager): Middleware {
  return async (req, next) => {
    const auth = await authManager.authenticate(req);
    if (!auth.success) {
      return { status: 401, body: { error: auth.error } };
    }
    return next();
  };
}

// 默认导出
export default {
  SimpleHttpServer,
  AuthManager,
  createGatewayConfig,
  createHttpServer,
  createAuthManager,
  loggingMiddleware,
  authMiddleware,
};
