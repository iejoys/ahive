/**
 * AHIVECORE 后台服务 EXE 打包脚本
 * 
 * 使用 pkg 将 Node.js 项目打包成单个可执行文件
 * 原生模块 (.node) 需要放在 EXE 同目录
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const RELEASE_DIR = path.join(ROOT_DIR, 'release', 'service');
const PACKAGE_DIR = path.join(RELEASE_DIR, 'ahivecore-service');

console.log('========================================');
console.log('  AHIVECORE 后台服务 EXE 打包');
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

// 步骤 1: 编译 TypeScript
function buildTypeScript() {
  console.log('📦 步骤 1/5: 编译 TypeScript...');
  
  try {
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('  ✅ TypeScript 编译完成\n');
  } catch (error) {
    console.error('  ❌ TypeScript 编译失败');
    process.exit(1);
  }
}

// 步骤 2: 安装 pkg
function installPkg() {
  console.log('📦 步骤 2/5: 检查 pkg 工具...');
  
  try {
    execSync('pkg --version', { stdio: 'pipe' });
    console.log('  ✅ pkg 已安装\n');
  } catch {
    console.log('  正在安装 pkg...');
    execSync('npm install -g pkg', { stdio: 'inherit' });
    console.log('  ✅ pkg 安装完成\n');
  }
}

// 步骤 3: 创建打包配置
function createPackageConfig() {
  console.log('📦 步骤 3/5: 创建打包配置...');
  
  const pkgConfig = {
    name: "ahivecore-service",
    version: "0.1.0",
    description: "AHIVECORE 后台服务",
    main: "dist/start-isolated.js",
    bin: "dist/start-isolated.js",
    pkg: {
      targets: ["node20-win-x64"],
      outputPath: "release/service/ahivecore-service",
      assets: [
        "dist/**/*",
        "public/**/*",
        "dictionaries/**/*",
        "data/**/*",
        "config/**/*",
        "node_modules/better-sqlite3/**/*",
        "node_modules/node-llama-cpp/**/*"
      ],
      scripts: [
        "dist/**/*.js"
      ]
    }
  };
  
  fs.writeFileSync(
    path.join(ROOT_DIR, 'package-service.json'),
    JSON.stringify(pkgConfig, null, 2)
  );
  
  console.log('  ✅ 配置文件创建完成\n');
}

// 步骤 4: 执行打包
function runPkg() {
  console.log('📦 步骤 4/5: 执行 pkg 打包...');
  
  try {
    execSync('pkg package-service.json --targets node20-win-x64 --output release/service/ahivecore-service.exe', {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    console.log('  ✅ EXE 打包完成\n');
  } catch (error) {
    console.error('  ❌ 打包失败，尝试备用方案...');
    
    // 备用方案：使用 npx pkg
    try {
      execSync('npx pkg package-service.json --targets node20-win-x64 --output release/service/ahivecore-service.exe', {
        cwd: ROOT_DIR,
        stdio: 'inherit'
      });
      console.log('  ✅ EXE 打包完成（备用方案）\n');
    } catch (e) {
      console.error('  ❌ 打包失败');
      console.log('\n请手动执行:');
      console.log('  npm install -g pkg');
      console.log('  pkg package-service.json --targets node20-win-x64 --output release/service/ahivecore-service.exe\n');
      process.exit(1);
    }
  }
}

// 步骤 5: 复制运行时文件
function copyRuntimeFiles() {
  console.log('📦 步骤 5/5: 复制运行时文件...');
  
  ensureDir(PACKAGE_DIR);
  
  // 复制 EXE
  const exeSrc = path.join(ROOT_DIR, 'release', 'service', 'ahivecore-service.exe');
  if (fs.existsSync(exeSrc)) {
    copyFile(exeSrc, path.join(PACKAGE_DIR, 'ahivecore-service.exe'));
    console.log('  ✅ ahivecore-service.exe');
  }
  
  // 复制原生模块
  console.log('  📋 复制原生模块...');
  
  // better-sqlite3
  const sqlite3Src = path.join(ROOT_DIR, 'node_modules', 'better-sqlite3');
  if (fs.existsSync(sqlite3Src)) {
    copyDir(sqlite3Src, path.join(PACKAGE_DIR, 'node_modules', 'better-sqlite3'), ['.git']);
    console.log('    ✅ better-sqlite3');
  }
  
  // node-llama-cpp
  const llamaSrc = path.join(ROOT_DIR, 'node_modules', 'node-llama-cpp');
  if (fs.existsSync(llamaSrc)) {
    copyDir(llamaSrc, path.join(PACKAGE_DIR, 'node_modules', 'node-llama-cpp'), ['.git']);
    console.log('    ✅ node-llama-cpp');
  }
  
  // 复制其他必要文件
  const dirsToCopy = ['public', 'dictionaries', 'data', 'config'];
  for (const dir of dirsToCopy) {
    const src = path.join(ROOT_DIR, dir);
    if (fs.existsSync(src)) {
      copyDir(src, path.join(PACKAGE_DIR, dir));
      console.log(`    ✅ ${dir}/`);
    }
  }
  
  // 创建空的 models 目录
  ensureDir(path.join(PACKAGE_DIR, 'models'));
  console.log('    ✅ models/ (空目录)');
  
  // 复制 dist 目录（JS 文件）
  copyDir(DIST_DIR, path.join(PACKAGE_DIR, 'dist'));
  console.log('    ✅ dist/');
  
  console.log('\n  ✅ 运行时文件复制完成\n');
}

// 创建启动脚本
function createStartScripts() {
  console.log('📝 创建启动脚本...');
  
  // Windows 启动脚本
  const startBat = `@echo off
chcp 65001 >nul
title AHIVECORE Service
cd /d "%~dp0"

echo.
echo  ========================================
echo    AHIVECORE 后台服务
echo  ========================================
echo.

REM 检查模型
if not exist "models\\Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" (
    echo  [!] 未检测到模型文件
    echo.
    echo  请运行: 下载模型.bat
    echo.
    pause
    exit /b 1
)

echo  [启动服务...]
echo  端口: 18790
echo  地址: http://127.0.0.1:18790
echo.

start "" http://127.0.0.1:18790
ahivecore-service.exe
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '启动服务.bat'), startBat);
  
  // 后台启动脚本（无窗口）
  const backgroundBat = `@echo off
cd /d "%~dp0"
start /b ahivecore-service.exe
echo AHIVECORE 服务已在后台启动
echo 访问: http://127.0.0.1:18790
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '后台启动.bat'), backgroundBat);
  
  // 停止服务脚本
  const stopBat = `@echo off
chcp 65001 >nul
echo 正在停止 AHIVECORE 服务...
taskkill /f /im ahivecore-service.exe 2>nul
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
echo  [下载模型]
echo.
echo  可选模型:
echo  1. Qwen2.5-1.5B (~1GB) - 推荐
echo  2. Qwen2.5-3B  (~2GB)
echo  3. Qwen2.5-7B  (~4GB)
echo.
node scripts/download-model.cjs
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '下载模型.bat'), downloadBat);
  
  console.log('  ✅ 启动脚本创建完成\n');
}

// 创建配置文件
function createConfig() {
  console.log('📝 创建配置文件...');
  
  // agents.json 默认配置
  const agentsConfig = {
    agents: [
      {
        id: "default",
        type: "ahive-coder",
        nickname: "默认智能体",
        role: "通用编程助手"
      }
    ],
    activeAgentId: "default"
  };
  
  ensureDir(path.join(PACKAGE_DIR, 'config'));
  fs.writeFileSync(
    path.join(PACKAGE_DIR, 'config', 'agents.json'),
    JSON.stringify(agentsConfig, null, 2)
  );
  
  // .env 示例
  const envExample = `# AHIVECORE 配置文件

# 服务端口
AHIVE_PORT=18790
AHIVE_HOST=127.0.0.1

# 日志级别
LOG_LEVEL=info
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '.env.example'), envExample);
  
  console.log('  ✅ 配置文件创建完成\n');
}

// 创建 README
function createReadme() {
  console.log('📝 创建 README...');
  
  const readme = `# AHIVECORE 后台服务

## 使用方法

1. 首次使用：双击 \`下载模型.bat\` 下载 AI 模型
2. 启动服务：双击 \`启动服务.bat\` 或 \`后台启动.bat\`
3. 停止服务：双击 \`停止服务.bat\`

## 目录结构

\`\`\`
ahivecore-service/
├── ahivecore-service.exe  # 主程序
├── 启动服务.bat            # 前台启动
├── 后台启动.bat            # 后台启动
├── 停止服务.bat            # 停止服务
├── 下载模型.bat            # 下载模型
├── dist/                   # 编译后的 JS
├── models/                 # AI 模型文件
├── config/                 # 配置文件
├── data/                   # 数据文件
├── public/                 # Web 界面
├── dictionaries/           # 字典文件
└── node_modules/           # 原生模块
\`\`\`

## 硬件要求

| 模型 | 内存 | GPU |
|------|------|-----|
| Qwen2.5-1.5B | 4GB | 可选 |
| Qwen2.5-3B | 8GB | 推荐 |
| Qwen2.5-7B | 16GB | 需要 |

## API 端点

- 健康检查: GET http://127.0.0.1:18790/health
- 聊天接口: POST http://127.0.0.1:18790/chat
- 智能体列表: GET http://127.0.0.1:18790/agents

## 配置

复制 \`.env.example\` 为 \`.env\` 并修改配置。

---

© 2026 星未来软件工作室
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, 'README.md'), readme);
  
  console.log('  ✅ README 创建完成\n');
}

// 主函数
function main() {
  const startTime = Date.now();
  
  // 清理旧文件
  ensureDir(RELEASE_DIR);
  
  // 执行步骤
  buildTypeScript();
  installPkg();
  createPackageConfig();
  runPkg();
  copyRuntimeFiles();
  createStartScripts();
  createConfig();
  createReadme();
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('========================================');
  console.log('  ✅ 打包完成！');
  console.log('========================================');
  console.log(`\n  输出目录: ${PACKAGE_DIR}`);
  console.log(`  耗时: ${elapsed}s\n`);
  console.log('  使用方法:');
  console.log('  1. 双击 下载模型.bat 下载模型');
  console.log('  2. 双击 启动服务.bat 启动服务\n');
}

main();