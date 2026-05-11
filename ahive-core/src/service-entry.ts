/**
 * AHIVECORE 后台服务入口 (pkg 打包专用)
 * 
 * 特点：
 * - 无窗口、无界面
 * - 作为系统后台服务运行
 * - 支持 Windows 服务模式
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// pkg 打包时需要设置正确的资源路径
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 判断是否在 pkg 打包环境中
const isPkg = typeof (process as any).pkg !== 'undefined';

// 设置资源路径
if (isPkg) {
  // pkg 打包后，资源在可执行文件同目录
  const execDir = path.dirname(process.execPath);
  
  // 设置模型目录
  process.env.AHIVE_MODELS_DIR = process.env.AHIVE_MODELS_DIR || path.join(execDir, 'models');
  
  // 设置数据目录
  process.env.AHIVE_DATA_DIR = process.env.AHIVE_DATA_DIR || path.join(execDir, 'data');
  
  // 设置配置目录
  process.env.AHIVE_CONFIG_DIR = process.env.AHIVE_CONFIG_DIR || path.join(execDir, 'config');
}

// 加载环境变量
const envPath = isPkg 
  ? path.join(path.dirname(process.execPath), '.env')
  : path.join(__dirname, '../.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
}

// 动态导入主服务
async function startService() {
  // 使用动态导入以支持 pkg 打包
  const { App } = await import('./core/index.js');
  const { registerRoutes } = await import('./routes/index.js');
  const { LocalExecutor } = await import('./executor/local-executor.js');
  const { logger } = await import('./utils/index.js');
  const http = await import('http');

  const PORT = process.env.AHIVE_PORT || '18790';
  const HOST = process.env.AHIVE_HOST || '127.0.0.1';

  logger.info('🚀 启动 AHIVECORE 后台服务...');
  logger.info(`   运行模式: ${isPkg ? '打包 EXE' : '开发模式'}`);

  // 初始化应用核心
  const app = new App();
  await app.initialize();

  // 创建执行器
  const executor = new LocalExecutor(
    app.unifiedAgentSystem,
    app.ahiveCoderExecutor,
    app.providerManager
  );

  // 创建 HTTP 服务器
  const server = http.createServer(async (req, res) => {
    try {
      const handled = await registerRoutes(req, res, executor, app);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not Found', path: req.url }));
      }
    } catch (error) {
      logger.error('请求处理失败:', error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: 'Internal Server Error', 
        message: error instanceof Error ? error.message : String(error) 
      }));
    }
  });

  // 启动服务器
  await new Promise<void>((resolve, reject) => {
    server.listen(parseInt(PORT as string), HOST as string, () => {
      logger.info(`✅ AHIVECORE 服务已启动`);
      logger.info(`   HTTP: http://${HOST}:${PORT}`);
      logger.info(`   状态: http://${HOST}:${PORT}/health`);
      resolve();
    });
    
    server.on('error', reject);
  });

  // 优雅关闭
  const shutdown = async () => {
    logger.info('🛑 正在关闭服务...');
    
    server.close(async () => {
      await app.shutdown();
      logger.info('👋 AHIVECORE 已关闭');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// 启动服务
startService().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
});