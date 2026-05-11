const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 确保 dist-electron 目录存在
const distDir = path.join(__dirname, '..', 'dist-electron');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 编译 Electron 主进程
console.log('Building Electron main process...');
const buildProcess = spawn('node', [path.join(__dirname, 'build-electron.mjs')], {
  stdio: 'inherit',
  shell: true
});

buildProcess.on('close', (code) => {
  if (code !== 0) {
    console.error('Build failed');
    process.exit(code);
  }

  console.log('Build complete, starting Electron...');

  // 启动 Electron (使用根目录的 electron)
  const electronPath = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'cli.js');
  const electronProcess = spawn('node', [electronPath, '.'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
  });

  electronProcess.on('close', (code) => {
    process.exit(code);
  });
});
