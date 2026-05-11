/**
 * AHIVE Core - 主程序入口
 *
 * 统一使用进程隔离模式启动
 * 每个 Agent 运行在独立子进程中，互不干扰
 */

import { logger } from './utils/index.js';

// 加载环境变量
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
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
  logger.info(`已加载 .env 文件：${envPath}`);
}

/**
 * 主函数 - 转接到进程隔离模式
 */
async function main() {
  logger.info('🔄 main.ts 自动转接到进程隔离模式 (start-isolated.ts)');
  logger.info('💡 提示: 也可以直接运行 npm run start:isolated');

  // 动态导入并执行进程隔离模式
  await import('./start-isolated.js');
}

// 启动
main().catch((error) => {
  logger.error('启动失败:', error);
  process.exit(1);
});