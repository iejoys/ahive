/**
 * AHIVECORE 便携版打包脚本
 * 
 * 打包成无需配置环境的便携版：
 * - 使用系统已安装的 Node.js
 * - 双击启动即可使用
 * - WEB 管理界面
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release', 'portable');
const PACKAGE_DIR = path.join(RELEASE_DIR, 'AHIVECORE');

console.log('========================================');
console.log('  AHIVECORE 便携版打包工具');
console.log('========================================\n');

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 复制目录
function copyDir(src, dest, exclude = []) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 复制文件
function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  ensureDir(destDir);
  fs.copyFileSync(src, dest);
}

// 获取目录大小
function getDirSize(dir) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch (e) {
    // 忽略错误
  }
  
  return size;
}

// 格式化大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 步骤 1: 编译 TypeScript
function buildTypeScript() {
  console.log('📦 步骤 1/6: 编译 TypeScript...');
  
  try {
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('  ✅ 编译完成\n');
  } catch (error) {
    console.error('  ❌ 编译失败');
    process.exit(1);
  }
}

// 步骤 2: 清理并创建目录
function prepareDirectory() {
  console.log('📦 步骤 2/6: 准备目录...');
  
  // 清理旧文件
  if (fs.existsSync(PACKAGE_DIR)) {
    console.log('  清理旧文件...');
    fs.rmSync(PACKAGE_DIR, { recursive: true });
  }
  
  ensureDir(PACKAGE_DIR);
  console.log('  ✅ 目录准备完成\n');
}

// 步骤 3: 复制文件
function copyFiles() {
  console.log('📦 步骤 3/6: 复制文件...');
  
  // 复制 dist 目录
  console.log('  复制 dist/...');
  copyDir(path.join(ROOT_DIR, 'dist'), path.join(PACKAGE_DIR, 'dist'));
  
  // 复制 public 目录 (WEB 界面)
  console.log('  复制 public/...');
  copyDir(path.join(ROOT_DIR, 'public'), path.join(PACKAGE_DIR, 'public'));
  
  // 复制必要的目录
  const dirs = ['dictionaries', 'data', 'config'];
  for (const dir of dirs) {
    const src = path.join(ROOT_DIR, dir);
    if (fs.existsSync(src)) {
      console.log(`  复制 ${dir}/...`);
      copyDir(src, path.join(PACKAGE_DIR, dir));
    }
  }
  
  // 创建空的 models 目录
  ensureDir(path.join(PACKAGE_DIR, 'models'));
  console.log('  创建 models/ (空目录)');
  
  // 复制 package.json 和 package-lock.json
  console.log('  复制 package.json...');
  copyFile(path.join(ROOT_DIR, 'package.json'), path.join(PACKAGE_DIR, 'package.json'));
  
  const lockFile = path.join(ROOT_DIR, 'package-lock.json');
  if (fs.existsSync(lockFile)) {
    copyFile(lockFile, path.join(PACKAGE_DIR, 'package-lock.json'));
  }
  
  console.log('  ✅ 文件复制完成\n');
}

// 步骤 4: 安装依赖
function installDependencies() {
  console.log('📦 步骤 4/6: 安装依赖 (仅生产依赖)...');
  console.log('  这可能需要几分钟，请耐心等待...\n');
  
  const { spawn } = require('child_process');
  
  return new Promise((resolve, reject) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['install', '--production', '--ignore-scripts'], {
      cwd: PACKAGE_DIR,
      stdio: 'inherit',
      shell: true
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n  ✅ 依赖安装完成\n');
        resolve();
      } else {
        console.error('\n  ❌ 依赖安装失败');
        console.log('  请手动运行: cd ' + PACKAGE_DIR + ' && npm install --production\n');
        reject(new Error('npm install failed'));
      }
    });
    
    child.on('error', (err) => {
      console.error('  ❌ 执行失败:', err.message);
      reject(err);
    });
  });
}

// 步骤 5: 创建启动脚本
function createStartScripts() {
  console.log('📦 步骤 5/6: 创建启动脚本...');
  
  // 主启动脚本
  const startBat = `@echo off
chcp 65001 >nul
title AHIVECORE
cd /d "%~dp0"

echo.
echo  ========================================
echo    AHIVECORE - 智能体核心引擎
echo  ========================================
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未找到 Node.js
    echo.
    echo  请安装 Node.js 20.x 或更高版本
    echo  下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM 检查模型
if not exist "models\\Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" (
    echo  [警告] 未检测到模型文件
    echo.
    echo  请运行: 下载模型.bat
    echo.
    echo  或手动下载模型到 models 目录
    echo.
)

echo  [启动服务...]
echo  端口: 18790
echo  地址: http://127.0.0.1:18790
echo.

REM 启动浏览器
start "" http://127.0.0.1:18790

REM 启动服务
node dist/start-isolated.js
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '启动服务.bat'), startBat);
  
  // 后台启动脚本
  const backgroundBat = `@echo off
cd /d "%~dp0"
start /b node dist/start-isolated.js
echo AHIVECORE 服务已在后台启动
echo 访问: http://127.0.0.1:18790
timeout /t 3 >nul
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '后台启动.bat'), backgroundBat);
  
  // 停止服务脚本
  const stopBat = `@echo off
chcp 65001 >nul
echo 正在停止 AHIVECORE 服务...
taskkill /f /im node.exe /fi "WINDOWTITLE eq AHIVECORE*" 2>nul
taskkill /f /im node.exe 2>nul
if %errorlevel%==0 (
    echo 服务已停止
) else (
    echo 服务未运行
)
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '停止服务.bat'), stopBat);
  
  // 下载模型脚本
  const downloadBat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ========================================
echo    下载 AI 模型
echo  ========================================
echo.
echo  可选模型:
echo  1. Qwen2.5-1.5B (~1GB) - 推荐，最低配置
echo  2. Qwen2.5-3B  (~2GB) - 中等配置
echo  3. Qwen2.5-7B  (~4GB) - 高配置
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未找到 Node.js
    pause
    exit /b 1
)

node scripts/download-model.cjs
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '下载模型.bat'), downloadBat);
  
  // 复制下载脚本
  const scriptsDir = path.join(PACKAGE_DIR, 'scripts');
  ensureDir(scriptsDir);
  const downloadScript = path.join(ROOT_DIR, 'scripts', 'download-model.cjs');
  if (fs.existsSync(downloadScript)) {
    copyFile(downloadScript, path.join(scriptsDir, 'download-model.cjs'));
  }
  
  console.log('  ✅ 启动脚本创建完成\n');
}

// 步骤 6: 创建文档
function createDocs() {
  console.log('📦 步骤 6/6: 创建文档...');
  
  const readme = `# AHIVECORE - 智能体核心引擎

## 快速开始

### 1. 安装 Node.js

如果还没有安装 Node.js，请先安装：
- 下载地址: https://nodejs.org/
- 推荐版本: Node.js 20.x LTS

### 2. 下载模型

双击 \`下载模型.bat\` 下载 AI 模型

或手动下载：
1. 访问 https://huggingface.co/models
2. 搜索 "Qwen2.5-1.5B-Instruct-GGUF"
3. 下载 Q4_K_M 版本
4. 放到 models 目录

### 3. 启动服务

双击 \`启动服务.bat\`

服务启动后会自动打开浏览器访问 http://127.0.0.1:18790

## 目录结构

\`\`\`
AHIVECORE/
├── 启动服务.bat      # 前台启动（显示日志）
├── 后台启动.bat      # 后台启动（无窗口）
├── 停止服务.bat      # 停止服务
├── 下载模型.bat      # 下载 AI 模型
├── dist/             # 编译后的代码
├── models/           # AI 模型文件
├── public/           # Web 界面
├── config/           # 配置文件
├── data/             # 数据文件
├── dictionaries/     # 字典文件
└── node_modules/     # 依赖包
\`\`\`

## 硬件要求

| 模型 | 内存 | GPU | 推荐 |
|------|------|-----|------|
| Qwen2.5-1.5B | 4GB | 可选 | 入门级 |
| Qwen2.5-3B | 8GB | 推荐 | 主流配置 |
| Qwen2.5-7B | 16GB | 需要 | 高配置 |

## API 端点

- 健康检查: GET http://127.0.0.1:18790/health
- 聊天接口: POST http://127.0.0.1:18790/chat
- 智能体列表: GET http://127.0.0.1:18790/agents
- 创建智能体: POST http://127.0.0.1:18790/agents

## 常见问题

### Q: 启动失败，提示端口被占用
A: 修改 .env 文件中的 AHIVE_PORT 为其他端口

### Q: 模型加载失败
A: 确保模型文件在 models 目录，且文件名正确

### Q: 内存不足
A: 使用更小的模型，或增加系统内存

---

© 2026 星未来软件工作室
QQ: 8980188
微信: etflyer
网站: https://ahive.starsfuture.cn
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, 'README.md'), readme);
  
  // 创建 .env 示例
  const envExample = `# AHIVECORE 配置文件

# 服务端口
AHIVE_PORT=18790
AHIVE_HOST=127.0.0.1

# 日志级别 (debug, info, warn, error)
LOG_LEVEL=info

# 模型配置 (可选，默认使用本地模型)
# MODEL_MODE=embedded
# GPU_LAYERS=0
# THREADS=4
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '.env.example'), envExample);
  
  console.log('  ✅ 文档创建完成\n');
}

// 显示完成信息
function showComplete() {
  // 计算目录大小
  let totalSize = 0;
  try {
    totalSize = getDirSize(PACKAGE_DIR);
  } catch (e) {
    // 忽略
  }
  
  console.log('========================================');
  console.log('  ✅ 打包完成！');
  console.log('========================================');
  console.log(`\n  输出目录: ${PACKAGE_DIR}`);
  console.log(`  总大小: ${formatSize(totalSize)}\n`);
  console.log('  使用方法:');
  console.log('  1. 安装 Node.js (如果还没有)');
  console.log('  2. 双击 下载模型.bat 下载模型');
  console.log('  3. 双击 启动服务.bat 启动服务\n');
  console.log('  提示: 可以将整个 AHIVECORE 文件夹复制到任意位置运行\n');
}

// 主函数
function main() {
  const startTime = Date.now();
  
  try {
    buildTypeScript();
    prepareDirectory();
    copyFiles();
    installDependencies();
    createStartScripts();
    createDocs();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  耗时: ${elapsed}s\n`);
    
    showComplete();
  } catch (error) {
    console.error('\n❌ 打包失败:', error.message);
    process.exit(1);
  }
}

main();