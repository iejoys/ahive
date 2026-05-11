#!/usr/bin/env node
/**
 * AHIVECORE 进程隔离模式启动脚本
 * 
 * 使用方式：
 *   node scripts/start-isolated.cjs
 * 
 * 或者在 package.json 中：
 *   "start:isolated": "node scripts/start-isolated.cjs"
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('========================================');
console.log('  AHIVECORE - 进程隔离模式');
console.log('========================================');
console.log('');

// 获取项目根目录
const rootDir = path.resolve(__dirname, '..');
const mainProcessPath = path.join(rootDir, 'dist', 'main-process.js');

// 检查是否需要先编译
const fs = require('fs');
const distExists = fs.existsSync(path.join(rootDir, 'dist'));

if (!distExists) {
  console.log('⚠️  dist 目录不存在，正在编译...');
  const buildProcess = spawn('npm', ['run', 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true
  });
  
  buildProcess.on('close', (code) => {
    if (code !== 0) {
      console.error('❌ 编译失败');
      process.exit(1);
    }
    startMainProcess();
  });
} else {
  startMainProcess();
}

function startMainProcess() {
  console.log('🚀 启动主进程...');
  console.log('');
  
  // 使用 tsx 运行 TypeScript
  const mainProcess = spawn('npx', ['tsx', 'src/main-process.ts'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      AHIVE_MODE: 'isolated'
    }
  });
  
  mainProcess.on('error', (err) => {
    console.error('❌ 启动失败:', err);
    process.exit(1);
  });
  
  mainProcess.on('close', (code) => {
    console.log(`\n主进程退出，代码: ${code}`);
    process.exit(code || 0);
  });
  
  // 处理退出信号
  process.on('SIGINT', () => {
    console.log('\n正在关闭...');
    mainProcess.kill('SIGINT');
  });
  
  process.on('SIGTERM', () => {
    mainProcess.kill('SIGTERM');
  });
}