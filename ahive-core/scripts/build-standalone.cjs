/**
 * AHIVECORE 独立版打包脚本
 * 
 * 打包成无需配置环境的独立程序：
 * - 内嵌 Node.js 运行时
 * - 双击启动即可使用
 * - WEB 管理界面
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release', 'standalone');
const PACKAGE_DIR = path.join(RELEASE_DIR, 'AHIVECORE');

console.log('========================================');
console.log('  AHIVECORE 独立版打包工具');
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

// 下载 Node.js 独立版
async function downloadNodeJS() {
  console.log('📦 步骤 1/6: 准备 Node.js 运行时...');
  
  const nodeDir = path.join(RELEASE_DIR, 'nodejs');
  const nodeExe = path.join(nodeDir, 'node.exe');
  
  if (fs.existsSync(nodeExe)) {
    console.log('  ✅ Node.js 已存在\n');
    return nodeExe;
  }
  
  ensureDir(nodeDir);
  
  // Node.js 独立版下载地址 (v20.11.0)
  const nodeVersion = 'v20.11.0';
  const nodeUrl = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-win-x64.zip`;
  const zipPath = path.join(RELEASE_DIR, 'node.zip');
  
  console.log(`  下载 Node.js ${nodeVersion}...`);
  
  try {
    // 使用 PowerShell 下载
    execSync(`powershell -Command "Invoke-WebRequest -Uri '${nodeUrl}' -OutFile '${zipPath}'"`, {
      stdio: 'inherit'
    });
    
    // 解压
    console.log('  解压...');
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${RELEASE_DIR}' -Force"`, {
      stdio: 'inherit'
    });
    
    // 移动文件
    const extractedDir = path.join(RELEASE_DIR, `node-${nodeVersion}-win-x64`);
    if (fs.existsSync(extractedDir)) {
      // 只复制需要的文件
      const files = ['node.exe', 'npm.cmd', 'npx.cmd'];
      const dirs = ['node_modules'];
      
      for (const file of files) {
        const src = path.join(extractedDir, file);
        if (fs.existsSync(src)) {
          copyFile(src, path.join(nodeDir, file));
        }
      }
      
      for (const dir of dirs) {
        const src = path.join(extractedDir, dir);
        if (fs.existsSync(src)) {
          copyDir(src, path.join(nodeDir, dir));
        }
      }
      
      // 清理
      fs.rmSync(extractedDir, { recursive: true, force: true });
    }
    
    // 删除 zip
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    
    console.log('  ✅ Node.js 准备完成\n');
    return nodeExe;
  } catch (error) {
    console.error('  ❌ Node.js 下载失败:', error.message);
    console.log('  请手动下载 Node.js 独立版并放到: ' + nodeDir);
    return null;
  }
}

// 编译 TypeScript
function buildTypeScript() {
  console.log('📦 步骤 2/6: 编译 TypeScript...');
  
  try {
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('  ✅ TypeScript 编译完成\n');
    return true;
  } catch (error) {
    console.error('  ❌ TypeScript 编译失败');
    return false;
  }
}

// 复制项目文件
function copyProjectFiles() {
  console.log('📦 步骤 3/6: 复制项目文件...');
  
  ensureDir(PACKAGE_DIR);
  
  // 复制 dist
  console.log('  复制 dist/...');
  copyDir(path.join(ROOT_DIR, 'dist'), path.join(PACKAGE_DIR, 'dist'));
  
  // 复制 public
  console.log('  复制 public/...');
  copyDir(path.join(ROOT_DIR, 'public'), path.join(PACKAGE_DIR, 'public'));
  
  // 复制 dictionaries
  console.log('  复制 dictionaries/...');
  copyDir(path.join(ROOT_DIR, 'dictionaries'), path.join(PACKAGE_DIR, 'dictionaries'));
  
  // 复制 data
  console.log('  复制 data/...');
  copyDir(path.join(ROOT_DIR, 'data'), path.join(PACKAGE_DIR, 'data'));
  
  // 复制 config
  console.log('  复制 config/...');
  copyDir(path.join(ROOT_DIR, 'config'), path.join(PACKAGE_DIR, 'config'));
  
  // 创建空的 models 目录
  ensureDir(path.join(PACKAGE_DIR, 'models'));
  console.log('  创建 models/ 目录');
  
  // 复制 node_modules (只复制必要的)
  console.log('  复制 node_modules (原生模块)...');
  const nodeModulesDir = path.join(PACKAGE_DIR, 'node_modules');
  ensureDir(nodeModulesDir);
  
  // 需要复制的模块
  const modulesToCopy = [
    'better-sqlite3',
    'node-llama-cpp',
    'amep-protocol',
    'ws',
    'zod',
    '@mozilla',
    'linkedom'
  ];
  
  for (const mod of modulesToCopy) {
    const src = path.join(ROOT_DIR, 'node_modules', mod);
    if (fs.existsSync(src)) {
      console.log(`    - ${mod}`);
      copyDir(src, path.join(nodeModulesDir, mod), ['.git', 'test', 'tests', 'examples', 'docs']);
    }
  }
  
  console.log('  ✅ 项目文件复制完成\n');
}

// 复制 Node.js 运行时
function copyNodeRuntime(nodeExe) {
  console.log('📦 步骤 4/6: 复制 Node.js 运行时...');
  
  const runtimeDir = path.join(PACKAGE_DIR, 'runtime');
  ensureDir(runtimeDir);
  
  // 复制 node.exe
  copyFile(nodeExe, path.join(runtimeDir, 'node.exe'));
  console.log('  ✅ node.exe');
  
  console.log('  ✅ Node.js 运行时复制完成\n');
}

// 创建启动脚本
function createStartScripts() {
  console.log('📦 步骤 5/6: 创建启动脚本...');
  
  // 主启动脚本
  const startBat = `@echo off
chcp 65001 >nul
title AHIVECORE - 智能体核心引擎
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║     AHIVECORE - 智能体核心引擎       ║
echo  ║        (c) 2026 星未来软件工作室      ║
echo  ╚══════════════════════════════════════╝
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

REM 启动浏览器
start "" http://127.0.0.1:18790

REM 启动服务
runtime\\node.exe dist\\start-isolated.js
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '启动服务.bat'), startBat);
  
  // 后台启动脚本
  const backgroundBat = `@echo off
cd /d "%~dp0"
start /b runtime\\node.exe dist\\start-isolated.js
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
taskkill /f /im node.exe /fi "MEMUSAGE gt 100000" 2>nul
echo 服务已停止
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '停止服务.bat'), stopBat);
  
  // 下载模型脚本
  const downloadBat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ╔══════════════════════════════════════╗
echo  ║          下载 AI 模型                ║
echo  ╚══════════════════════════════════════╝
echo.
echo  可选模型:
echo  1. Qwen2.5-1.5B (~1GB) - 推荐，4GB内存可用
echo  2. Qwen2.5-3B  (~2GB) - 8GB内存推荐
echo  3. Qwen2.5-7B  (~4GB) - 16GB内存+GPU推荐
echo.
echo  正在下载...
echo.

runtime\\node.exe scripts\\download-model.cjs

if %errorlevel%==0 (
    echo.
    echo  ✅ 模型下载完成！
    echo  现在可以运行 启动服务.bat
) else (
    echo.
    echo  ❌ 模型下载失败
    echo  请检查网络连接后重试
)
echo.
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '下载模型.bat'), downloadBat);
  
  // 复制下载脚本
  const scriptsDir = path.join(PACKAGE_DIR, 'scripts');
  ensureDir(scriptsDir);
  copyFile(
    path.join(ROOT_DIR, 'scripts', 'download-model.cjs'),
    path.join(scriptsDir, 'download-model.cjs')
  );
  
  console.log('  ✅ 启动脚本创建完成\n');
}

// 创建配置文件
function createConfigFiles() {
  console.log('📦 步骤 6/6: 创建配置文件...');
  
  // .env 文件
  const envContent = `# AHIVECORE 配置文件

# 服务端口
AHIVE_PORT=18790
AHIVE_HOST=127.0.0.1

# 日志级别 (debug, info, warn, error)
LOG_LEVEL=info

# 模型配置 (可选，默认使用内嵌模型)
# MODEL_MODE=embedded
# GPU_LAYERS=0
# THREADS=4
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '.env'), envContent);
  
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
  
  fs.writeFileSync(
    path.join(PACKAGE_DIR, 'config', 'agents.json'),
    JSON.stringify(agentsConfig, null, 2)
  );
  
  // README
  const readme = `# AHIVECORE - 智能体核心引擎

## 快速开始

1. **下载模型** (首次使用)
   - 双击 \`下载模型.bat\`
   - 选择要下载的模型（推荐 Qwen2.5-1.5B）

2. **启动服务**
   - 双击 \`启动服务.bat\` - 前台启动，显示日志
   - 双击 \`后台启动.bat\` - 后台启动，无窗口

3. **访问界面**
   - 服务启动后会自动打开浏览器
   - 或手动访问: http://127.0.0.1:18790

4. **停止服务**
   - 双击 \`停止服务.bat\`
   - 或在前台窗口按 Ctrl+C

## 目录结构

\`\`\`
AHIVECORE/
├── 启动服务.bat        # 前台启动
├── 后台启动.bat        # 后台启动
├── 停止服务.bat        # 停止服务
├── 下载模型.bat        # 下载模型
├── runtime/            # Node.js 运行时
│   └── node.exe
├── dist/               # 编译后的代码
├── models/             # AI 模型文件
├── public/             # Web 界面
├── config/             # 配置文件
├── data/               # 数据文件
├── dictionaries/       # 字典文件
└── node_modules/       # 依赖模块
\`\`\`

## 硬件要求

| 模型 | 内存 | GPU | 说明 |
|------|------|-----|------|
| Qwen2.5-1.5B | 4GB | 可选 | 最小配置 |
| Qwen2.5-3B | 8GB | 推荐 | 流畅运行 |
| Qwen2.5-7B | 16GB | 需要 | 最佳效果 |

## API 端点

- 健康检查: GET http://127.0.0.1:18790/health
- 聊天接口: POST http://127.0.0.1:18790/chat
- 智能体列表: GET http://127.0.0.1:18790/agents

## 配置

编辑 \`.env\` 文件修改配置：

\`\`\`
AHIVE_PORT=18790        # 服务端口
AHIVE_HOST=127.0.0.1    # 监听地址
LOG_LEVEL=info          # 日志级别
\`\`\`

## 故障排除

**端口被占用**
- 修改 .env 中的 AHIVE_PORT

**模型加载失败**
- 确认 models 目录中有模型文件
- 检查内存是否足够

**启动报错**
- 检查是否被杀毒软件拦截
- 尝试以管理员身份运行

---

© 2026 星未来软件工作室
QQ: 8980188 | 微信: etflyer
官网: https://ahive.starsfuture.cn
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, 'README.md'), readme);
  
  console.log('  ✅ 配置文件创建完成\n');
}

// 打包成 ZIP
function createZipPackage() {
  console.log('📦 创建 ZIP 压缩包...');
  
  const zipPath = path.join(RELEASE_DIR, 'AHIVECORE-standalone.zip');
  
  try {
    // 使用 PowerShell 压缩
    execSync(`powershell -Command "Compress-Archive -Path '${PACKAGE_DIR}' -DestinationPath '${zipPath}' -Force"`, {
      stdio: 'inherit'
    });
    console.log('  ✅ ZIP 压缩包创建完成\n');
    return true;
  } catch (error) {
    console.log('  ⚠️ ZIP 压缩失败，请手动压缩\n');
    return false;
  }
}

// 主函数
async function main() {
  const startTime = Date.now();
  
  // 清理旧文件
  if (fs.existsSync(PACKAGE_DIR)) {
    console.log('🗑️ 清理旧文件...\n');
    fs.rmSync(PACKAGE_DIR, { recursive: true, force: true });
  }
  
  ensureDir(RELEASE_DIR);
  
  // 步骤 1: 准备 Node.js
  const nodeExe = await downloadNodeJS();
  if (!nodeExe) {
    console.log('❌ 无法准备 Node.js 运行时，打包终止');
    process.exit(1);
  }
  
  // 步骤 2: 编译 TypeScript
  if (!buildTypeScript()) {
    console.log('❌ TypeScript 编译失败，打包终止');
    process.exit(1);
  }
  
  // 步骤 3: 复制项目文件
  copyProjectFiles();
  
  // 步骤 4: 复制 Node.js 运行时
  copyNodeRuntime(nodeExe);
  
  // 步骤 5: 创建启动脚本
  createStartScripts();
  
  // 步骤 6: 创建配置文件
  createConfigFiles();
  
  // 创建 ZIP
  createZipPackage();
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('========================================');
  console.log('  ✅ 打包完成！');
  console.log('========================================');
  console.log(`\n  输出目录: ${PACKAGE_DIR}`);
  console.log(`  ZIP 压缩包: ${path.join(RELEASE_DIR, 'AHIVECORE-standalone.zip')}`);
  console.log(`  耗时: ${elapsed}s\n`);
  console.log('  使用方法:');
  console.log('  1. 双击 下载模型.bat 下载模型');
  console.log('  2. 双击 启动服务.bat 启动服务');
  console.log('  3. 浏览器自动打开 http://127.0.0.1:18790\n');
}

main().catch(console.error);