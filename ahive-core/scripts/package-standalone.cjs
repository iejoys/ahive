/**
 * AHIVECORE 独立版打包脚本
 * 
 * 特点：
 * - 内嵌 Node.js 运行时，无需用户安装
 * - 包含所有依赖（包括原生模块）
 * - 解压即用，零配置
 * 
 * 使用: node scripts/package-standalone.cjs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release', 'standalone');
const PACKAGE_DIR = path.join(RELEASE_DIR, 'AHIVECORE');
const NODE_VERSION = '20.18.1';
const NODE_DIST_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║        AHIVECORE 独立版打包工具                           ║');
console.log('║        内嵌 Node.js，解压即用                              ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// 工具函数
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function getDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let size = 0;
  
  function walk(p) {
    try {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(p, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          size += fs.statSync(fullPath).size;
        }
      }
    } catch (e) {}
  }
  walk(dir);
  return size;
}

function copyDir(src, dest, options = {}) {
  const { exclude = [] } = options;
  if (!fs.existsSync(src)) return;
  
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    try {
      if (entry.isSymbolicLink()) {
        const realPath = fs.realpathSync(srcPath);
        if (fs.statSync(realPath).isDirectory()) {
          copyDir(realPath, destPath, options);
        } else {
          fs.copyFileSync(realPath, destPath);
        }
      } else if (entry.isDirectory()) {
        copyDir(srcPath, destPath, options);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    } catch (e) {
      // 忽略错误
    }
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  下载: ${url}`);
    console.log(`  保存到: ${dest}`);
    
    const file = fs.createWriteStream(dest);
    
    const request = (urlStr) => {
      https.get(urlStr, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // 跟随重定向
          request(response.headers.location);
          return;
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: ${response.statusCode}`));
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          const percent = ((downloaded / totalSize) * 100).toFixed(1);
          process.stdout.write(`\r  进度: ${percent}% (${formatSize(downloaded)}/${formatSize(totalSize)})`);
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log('\n  ✅ 下载完成');
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };
    
    request(url);
  });
}

function extractZip(zipPath, destDir) {
  console.log(`  解压: ${zipPath}`);
  
  // 使用 PowerShell 解压
  const psCmd = `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`;
  
  try {
    execSync(`powershell -Command "${psCmd}"`, { stdio: 'inherit' });
    console.log('  ✅ 解压完成');
    return true;
  } catch (e) {
    console.error('  ❌ 解压失败:', e.message);
    return false;
  }
}

// 步骤 1: 下载 Node.js
async function downloadNodeJS() {
  console.log('\n📦 步骤 1: 下载 Node.js...\n');
  
  const nodeDir = path.join(RELEASE_DIR, 'nodejs');
  const zipPath = path.join(RELEASE_DIR, 'node.zip');
  
  // 检查是否已下载
  const nodeExe = path.join(nodeDir, 'node.exe');
  if (fs.existsSync(nodeExe)) {
    console.log('  ✅ Node.js 已存在，跳过下载');
    return nodeDir;
  }
  
  ensureDir(RELEASE_DIR);
  
  // 下载
  await downloadFile(NODE_DIST_URL, zipPath);
  
  // 解压
  ensureDir(nodeDir);
  if (!extractZip(zipPath, RELEASE_DIR)) {
    throw new Error('解压 Node.js 失败');
  }
  
  // 重命名目录
  const extractedDir = path.join(RELEASE_DIR, `node-v${NODE_VERSION}-win-x64`);
  if (fs.existsSync(extractedDir) && !fs.existsSync(nodeDir)) {
    fs.renameSync(extractedDir, nodeDir);
  }
  
  // 删除 zip 文件
  fs.unlinkSync(zipPath);
  
  console.log(`  ✅ Node.js 已准备: ${nodeDir}`);
  return nodeDir;
}

// 步骤 2: 复制源代码
function copySource() {
  console.log('\n📂 步骤 2: 复制源代码...\n');
  
  const dirs = [
    { name: 'dist', exclude: ['.git'] },
    { name: 'public', exclude: ['.git'] },
    { name: 'scripts', exclude: ['.git'] },
    { name: 'dictionaries', exclude: ['.git'] },
    { name: 'config', exclude: ['.git'] },
    { name: 'templates', exclude: ['.git'] },
    { name: 'prompts', exclude: ['.git'] },
    { name: 'skills', exclude: ['.git'] }
  ];
  
  for (const dir of dirs) {
    const srcPath = path.join(ROOT_DIR, dir.name);
    if (fs.existsSync(srcPath)) {
      console.log(`  ✅ ${dir.name}/`);
      copyDir(srcPath, path.join(PACKAGE_DIR, dir.name), { exclude: dir.exclude });
    }
  }
  
  // 创建空的 models 目录
  ensureDir(path.join(PACKAGE_DIR, 'models'));
  console.log('  ✅ models/ (空目录)');
}

// 步骤 3: 复制依赖
function copyNodeModules() {
  console.log('\n📦 步骤 3: 复制依赖包...\n');
  
  const srcModules = path.join(ROOT_DIR, 'node_modules');
  const destModules = path.join(PACKAGE_DIR, 'node_modules');
  
  if (!fs.existsSync(srcModules)) {
    console.log('  ❌ 未找到 node_modules，请先运行 npm install');
    return false;
  }
  
  // 需要复制的核心依赖
  const coreDeps = [
    '@mozilla',
    '@node-llama-cpp',
    'better-sqlite3',
    'linkedom',
    'node-llama-cpp',
    'ws',
    'zod',
    'amep-protocol'
  ];
  
  // 复制核心依赖
  for (const dep of coreDeps) {
    const srcPath = path.join(srcModules, dep);
    const destPath = path.join(destModules, dep);
    
    if (fs.existsSync(srcPath)) {
      console.log(`  ✅ ${dep}`);
      copyDir(srcPath, destPath, {
        exclude: ['.git', '.cache', 'test', 'tests', 'example', 'examples', 'doc', 'docs', '.github', 'src', '*.md']
      });
    }
  }
  
  // 复制所有依赖（排除不必要的文件）
  console.log('\n  复制所有依赖...');
  copyDir(srcModules, destModules, {
    exclude: ['.git', '.cache', '.github', '*.md', 'CHANGELOG*', 'README*', 'readme*', 'LICENSE*', 'licence*']
  });
  
  console.log('\n  ✅ 依赖复制完成');
  return true;
}

// 步骤 4: 创建配置文件
function createConfig() {
  console.log('\n📄 步骤 4: 创建配置文件...\n');
  
  // package.json
  const pkg = {
    name: 'ahivecore-standalone',
    version: '0.1.0',
    description: 'AHIVECORE 独立版 - 内嵌 Node.js，解压即用',
    type: 'module',
    main: 'dist/main.js',
    author: '星未来软件工作室',
    license: 'MIT',
    homepage: 'https://ahive.starsfuture.cn'
  };
  
  fs.writeFileSync(
    path.join(PACKAGE_DIR, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );
  console.log('  ✅ package.json');
}

// 步骤 5: 创建启动脚本
function createScripts() {
  console.log('\n📝 步骤 5: 创建启动脚本...\n');
  
  // 主启动脚本
  const startBat = `@echo off
chcp 65001 >nul
title AHIVECORE
cd /d "%~dp0"

echo.
echo  ╔═════════════════════════════════════════════════════════╗
echo  ║        AHIVECORE - 智能体核心引擎                          ║
echo  ║        内嵌 Node.js，无需安装环境                          ║
echo  ╚═════════════════════════════════════════════════════════╝
echo.

REM 检查模型
if not exist "models\\Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" (
    if not exist "models\\*.gguf" (
        echo  [!] 未检测到模型文件
        echo.
        echo  请运行: 下载模型.bat
        echo.
        pause
        exit /b 1
    )
)
echo  [OK] 模型已就绪
echo.

REM 设置环境变量
set NODE_PATH=%~dp0node_modules
set PATH=%~dp0nodejs;%PATH%

echo  [启动服务...]
echo  访问: http://127.0.0.1:18790
echo.

REM 启动 Node.js
"%~dp0nodejs\\node.exe" "%~dp0dist\\main.js"

if %errorlevel% neq 0 (
    echo.
    echo  [!] 启动失败，错误代码: %errorlevel%
    pause
)
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '启动.bat'), startBat);
  console.log('  ✅ 启动.bat');

  // 隔离模式启动脚本
  const isolatedBat = `@echo off
chcp 65001 >nul
title AHIVECORE - 隔离模式
cd /d "%~dp0"

echo.
echo  ╔═════════════════════════════════════════════════════════╗
echo  ║        AHIVECORE - 隔离模式                               ║
echo  ║        每个智能体独立进程                                  ║
echo  ╚═════════════════════════════════════════════════════════╝
echo.

REM 设置环境变量
set NODE_PATH=%~dp0node_modules
set PATH=%~dp0nodejs;%PATH%

echo  [启动隔离模式...]
echo  访问: http://127.0.0.1:18790
echo.

"%~dp0nodejs\\node.exe" "%~dp0dist\\start-isolated.js"

if %errorlevel% neq 0 (
    echo.
    echo  [!] 启动失败，错误代码: %errorlevel%
    pause
)
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '启动-隔离模式.bat'), isolatedBat);
  console.log('  ✅ 启动-隔离模式.bat');

  // 下载模型脚本
  const downloadBat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ╔═════════════════════════════════════════════════════════╗
echo  ║        AHIVECORE 模型下载器                               ║
echo  ╚═════════════════════════════════════════════════════════╝
echo.
echo  可选模型:
echo  1. Qwen2.5-1.5B (~1GB) - 推荐，最低配置
echo  2. Qwen2.5-3B  (~2GB) - 中等配置
echo  3. Qwen2.5-7B  (~4GB) - 高配置
echo.

REM 设置环境变量
set NODE_PATH=%~dp0node_modules
set PATH=%~dp0nodejs;%PATH%

"%~dp0nodejs\\node.exe" "%~dp0scripts\\download-model.cjs"
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '下载模型.bat'), downloadBat);
  console.log('  ✅ 下载模型.bat');

  // Web 管理界面快捷方式
  const webBat = `@echo off
start http://127.0.0.1:18790
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '打开管理界面.bat'), webBat);
  console.log('  ✅ 打开管理界面.bat');
}

// 步骤 6: 创建文档
function createReadme() {
  const content = `# AHIVECORE 独立版

## 特点

- ✅ **解压即用** - 内嵌 Node.js 运行时，无需安装任何环境
- ✅ **开箱即用** - 包含所有依赖，无需 npm install
- ✅ **完全独立** - 可放在任意目录运行，不污染系统环境

## 系统要求

- Windows 10/11 (64位)
- 内存: 4GB+ (推荐 8GB+)
- 磁盘: 2GB+ (含模型)

## 使用方法

### 1. 下载模型（首次使用）
双击 \`下载模型.bat\`，选择合适的模型下载。

### 2. 启动服务
- **普通模式**: 双击 \`启动.bat\`
- **隔离模式**: 双击 \`启动-隔离模式.bat\`

### 3. 访问管理界面
启动后自动打开浏览器，或手动访问: http://127.0.0.1:18790

## 模式说明

| 模式 | 启动方式 | 特点 |
|------|----------|------|
| 普通模式 | \`启动.bat\` | 单进程，所有智能体在同一进程 |
| 隔离模式 | \`启动-隔离模式.bat\` | 多进程，每个智能体独立子进程 |

## 硬件要求

| 模型 | 内存 | GPU | 说明 |
|------|------|-----|------|
| Qwen2.5-1.5B | 4GB | 可选 | 最低配置 |
| Qwen2.5-3B | 8GB | 推荐 | 中等配置 |
| Qwen2.5-7B | 16GB | 需要 | 高配置 |

## 目录结构

\`\`\`
AHIVECORE/
├── nodejs/              # 内嵌的 Node.js 运行时
├── dist/                # 编译后的代码
├── public/              # 前端页面
├── node_modules/        # 运行依赖
├── models/              # 模型文件（需下载）
├── dictionaries/        # 字典文件
├── config/              # 配置文件
├── 启动.bat             # 启动服务（普通模式）
├── 启动-隔离模式.bat     # 启动服务（隔离模式）
├── 下载模型.bat         # 下载模型
└── 打开管理界面.bat     # 打开 Web 管理界面
\`\`\`

## 常见问题

### Q: 启动失败，提示缺少 DLL？
A: 安装 Visual C++ Redistributable:
https://aka.ms/vs/17/release/vc_redist.x64.exe

### Q: 模型下载失败？
A: 手动下载模型文件，放入 \`models/\` 目录：
- Qwen2.5-1.5B: https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF

### Q: 内存不足？
A: 使用更小的模型，或增加系统内存。

### Q: 端口被占用？
A: 修改 \`config/default.json\` 中的端口配置。

---
© 2026 星未来软件工作室
QQ: 8980188 | 微信: etflyer
官网: https://ahive.starsfuture.cn
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, 'README.md'), content);
  console.log('  ✅ README.md');
}

// 步骤 7: 打包成 ZIP
function createZip() {
  console.log('\n📦 步骤 7: 打包成 ZIP...\n');
  
  const zipPath = path.join(RELEASE_DIR, `AHIVECORE-独立版.zip`);
  
  // 使用 PowerShell 压缩
  const psCmd = `Compress-Archive -Path "${PACKAGE_DIR}" -DestinationPath "${zipPath}" -Force`;
  
  try {
    execSync(`powershell -Command "${psCmd}"`, { stdio: 'inherit' });
    console.log(`  ✅ 已创建: ${zipPath}`);
    return zipPath;
  } catch (e) {
    console.error('  ❌ 打包失败:', e.message);
    return null;
  }
}

// 主函数
async function main() {
  try {
    console.log('📁 工作目录:', ROOT_DIR);
    console.log('📁 输出目录:', PACKAGE_DIR);
    
    // 清理旧文件
    if (fs.existsSync(PACKAGE_DIR)) {
      console.log('\n🗑️  清理旧文件...');
      fs.rmSync(PACKAGE_DIR, { recursive: true, force: true });
    }
    
    // 创建目录
    ensureDir(PACKAGE_DIR);
    
    // 步骤 1: 下载 Node.js
    const nodeDir = await downloadNodeJS();
    
    // 复制 Node.js 到包目录
    console.log('\n  复制 Node.js 到包目录...');
    copyDir(nodeDir, path.join(PACKAGE_DIR, 'nodejs'));
    console.log('  ✅ Node.js 已复制');
    
    // 步骤 2: 复制源代码
    copySource();
    
    // 步骤 3: 复制依赖
    copyNodeModules();
    
    // 步骤 4: 创建配置文件
    createConfig();
    
    // 步骤 5: 创建启动脚本
    createScripts();
    
    // 步骤 6: 创建文档
    createReadme();
    
    // 计算大小
    const totalSize = getDirSize(PACKAGE_DIR);
    
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║        ✅ 独立版打包完成！                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(`\n  📁 输出目录: ${PACKAGE_DIR}`);
    console.log(`  📦 总大小: ${formatSize(totalSize)}`);
    
    // 询问是否打包成 ZIP
    console.log('\n  是否打包成 ZIP? (y/n)');
    
    // 自动打包
    const zipPath = createZip();
    if (zipPath) {
      const zipSize = fs.statSync(zipPath).size;
      console.log(`  📦 ZIP 大小: ${formatSize(zipSize)}`);
    }
    
    console.log('\n  使用方法:');
    console.log('    1. 双击 下载模型.bat 下载模型');
    console.log('    2. 双击 启动.bat 启动服务');
    console.log('    3. 访问 http://127.0.0.1:18790\n');
    
  } catch (error) {
    console.error('\n❌ 打包失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();