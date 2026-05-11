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
  console.log('Build complete');
});