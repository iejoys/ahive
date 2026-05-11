/**
 * AHIVECORE 一键重启脚本
 * 用法: npm run restart 或 npm run restart:isolated
 */

const { exec, spawn } = require('child_process');
const path = require('path');

const PORT = 18790;
const IS_ISOLATED = process.argv.includes('--isolated');

function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    
    if (isWin) {
      // Windows: 查找并杀掉占用端口的进程
      exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
        if (error || !stdout) {
          console.log(`端口 ${port} 未被占用`);
          resolve();
          return;
        }
        
        const lines = stdout.trim().split('\n');
        const pids = new Set();
        
        lines.forEach(line => {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(pid) && pid !== '0') {
            pids.add(pid);
          }
        });
        
        if (pids.size === 0) {
          console.log(`端口 ${port} 未被占用`);
          resolve();
          return;
        }
        
        console.log(`正在停止进程: ${[...pids].join(', ')}`);
        
        pids.forEach(pid => {
          exec(`taskkill /F /PID ${pid}`, (err) => {
            if (err) {
              console.log(`进程 ${pid} 可能已停止`);
            } else {
              console.log(`✓ 进程 ${pid} 已停止`);
            }
          });
        });
        
        // 等待进程完全停止
        setTimeout(resolve, 1000);
      });
    } else {
      // Linux/Mac
      exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, () => {
        console.log(`端口 ${port} 已释放`);
        resolve();
      });
    }
  });
}

function startServer() {
  const projectRoot = path.resolve(__dirname, '..');
  const script = IS_ISOLATED ? 'src/start-isolated.ts' : 'src/main.ts';
  
  console.log(`\n🚀 启动 AHIVECORE (${IS_ISOLATED ? '进程隔离模式' : '普通模式'})...\n`);
  
  const child = spawn('npx', ['tsx', script], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true
  });
  
  child.on('error', (err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
  
  // 处理 Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n正在停止服务...');
    child.kill('SIGINT');
  });
}

async function main() {
  console.log('🔄 AHIVECORE 服务重启中...\n');
  
  // 1. 停止现有服务
  await killProcessOnPort(PORT);
  
  // 2. 启动新服务
  startServer();
}

main();