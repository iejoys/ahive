/**
 * AHIVECORE 标准版打包脚本 (CommonJS)
 * 
 * 特点：
 * - 包含所有运行依赖 (node_modules)
 * - 支持 pnpm monorepo workspace 依赖
 * - 不带模型文件（用户自行下载）
 * - 开箱即用，无需 npm install
 * 
 * 使用: node scripts/package-standard.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const MONOREPO_ROOT = path.join(ROOT_DIR, '..');  // ahive_project 目录
const RELEASE_DIR = path.join(ROOT_DIR, 'release', 'standard');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const PACKAGE_DIR = path.join(RELEASE_DIR, `ahivecore-standard-${TIMESTAMP}`);

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║        AHIVECORE 标准版打包工具                           ║');
console.log('║        包含运行依赖，开箱即用                               ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// 读取 package.json
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 复制目录（解析符号链接）
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
        // 解析符号链接并复制实际内容
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

// 计算目录大小
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

// 格式化大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 复制源代码
function copySource() {
  console.log('\n📂 复制源代码...\n');
  
  const dirs = [
    { name: 'src', exclude: ['.git', 'node_modules'] },
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

// 复制配置文件
function copyConfig() {
  console.log('\n📄 复制配置文件...\n');
  
  const files = ['tsconfig.json'];
  for (const file of files) {
    const srcPath = path.join(ROOT_DIR, file);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(PACKAGE_DIR, file));
      console.log(`  ✅ ${file}`);
    }
  }
}

// 创建 package.json
function createPackageJson() {
  console.log('\n📄 创建 package.json...\n');
  
  const original = readJson(path.join(ROOT_DIR, 'package.json'));
  
  const pkg = {
    name: 'ahivecore-standard',
    version: original.version,
    description: original.description,
    type: 'module',
    main: 'src/main.ts',
    author: original.author,
    license: original.license,
    homepage: original.homepage,
    scripts: {
      start: 'node --import tsx src/main.ts',
      'start:isolated': 'node --import tsx src/start-isolated.ts',
      'download-model': 'node scripts/download-model.cjs'
    },
    dependencies: {
      "@mozilla/readability": "^0.6.0",
      "better-sqlite3": "^11.0.0",
      "linkedom": "^0.18.12",
      "node-llama-cpp": "^3.17.1",
      "ws": "^8.20.0",
      "zod": "^3.22.4"
    },
    devDependencies: {
      "tsx": "^4.19.0",
      "typescript": "^5.6.0"
    },
    engines: {
      node: '>=20.0.0'
    }
  };
  
  fs.writeFileSync(
    path.join(PACKAGE_DIR, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );
  console.log('  ✅ package.json');
}

// 创建启动脚本
function createScripts() {
  console.log('\n📝 创建启动脚本...\n');
  
  // Windows 启动脚本
  const startBat = `@echo off
chcp 65001 >nul
title AHIVECORE Standard
cd /d "%~dp0"

echo.
echo  ╔═════════════════════════════════════════════════════════╗
echo  ║        AHIVECORE Standard - 标准版                        ║
echo  ║        开箱即用，无需安装依赖                              ║
echo  ╚═════════════════════════════════════════════════════════╝
echo.

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [!] 未检测到 Node.js，请先安装 Node.js 20+
    echo      下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo  [检查模型...]
if not exist "models\\Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" (
    echo.
    echo  [!] 未检测到模型文件
    echo.
    echo  请运行: 下载模型.bat
    echo.
    pause
    exit /b 1
)
echo  [OK] 模型已就绪
echo.
echo  [启动服务...]
echo  访问: http://127.0.0.1:18790
echo.
node --import tsx src/main.ts
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '启动.bat'), startBat);
  console.log('  ✅ 启动.bat');

  // 隔离模式启动脚本
  const isolatedBat = `@echo off
chcp 65001 >nul
title AHIVECORE Standard - 隔离模式
cd /d "%~dp0"

echo.
echo  ╔═════════════════════════════════════════════════════════╗
echo  ║        AHIVECORE Standard - 隔离模式                      ║
echo  ║        每个智能体独立进程                                  ║
echo  ╚═════════════════════════════════════════════════════════╝
echo.

node --import tsx src/start-isolated.ts
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '启动-隔离模式.bat'), isolatedBat);
  console.log('  ✅ 启动-隔离模式.bat');

  // 下载模型脚本
  const downloadBat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ╔═════════════════════════════════════════════════════════╗
echo  ║        AHIVECORE 模型下载器                              ║
echo  ╚═════════════════════════════════════════════════════════╝
echo.
echo  可选模型:
echo  1. Qwen2.5-1.5B (~1GB) - 推荐，最低配置
echo  2. Qwen2.5-3B  (~2GB) - 中等配置
echo  3. Qwen2.5-7B  (~4GB) - 高配置
echo.
node scripts/download-model.cjs
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '下载模型.bat'), downloadBat);
  console.log('  ✅ 下载模型.bat');

  // 安装依赖脚本
  const installBat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ╔═════════════════════════════════════════════════════════╗
echo  ║        安装/更新依赖                                      ║
echo  ╚═════════════════════════════════════════════════════════╝
echo.

npm install
echo.
echo  ✅ 依赖安装完成
pause
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, '安装依赖.bat'), installBat);
  console.log('  ✅ 安装依赖.bat');
}

// 创建 README
function createReadme() {
  const content = `# AHIVECORE Standard - 标准版

## 特点

- ✅ 开箱即用
- ✅ 支持普通模式和隔离模式
- ❌ 不含模型文件（首次运行需下载）

## 系统要求

- Node.js 20.0.0 或更高版本
- 内存: 4GB+ (推荐 8GB+)
- 磁盘: 2GB+ (含模型)

## 使用方法

### 1. 安装依赖（首次使用）
双击 \`安装依赖.bat\`

### 2. 下载模型
双击 \`下载模型.bat\`，选择合适的模型下载。

### 3. 启动服务
- 普通模式: 双击 \`启动.bat\`
- 隔离模式: 双击 \`启动-隔离模式.bat\`

### 4. 访问服务
打开浏览器访问: http://127.0.0.1:18790

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
ahivecore-standard/
├── src/              # 源代码
├── public/           # 前端页面
├── node_modules/     # 运行依赖
├── models/           # 模型文件（需下载）
├── dictionaries/     # 字典文件
├── config/           # 配置文件
├── 启动.bat          # 启动服务（普通模式）
├── 启动-隔离模式.bat  # 启动服务（隔离模式）
├── 下载模型.bat      # 下载模型
└── 安装依赖.bat      # 安装依赖
\`\`\`

## 常见问题

### Q: 启动失败，提示找不到模块？
A: 运行 \`安装依赖.bat\` 安装依赖。

### Q: 模型下载失败？
A: 手动下载模型文件，放入 \`models/\` 目录：
- Qwen2.5-1.5B: https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF

### Q: 内存不足？
A: 使用更小的模型，或增加系统内存。

---
© 2026 星未来软件工作室
QQ: 8980188 | 微信: etflyer
官网: https://ahive.starsfuture.cn
`;

  fs.writeFileSync(path.join(PACKAGE_DIR, 'README.md'), content);
  console.log('  ✅ README.md');
}

// 复制 amep-protocol
function copyAmepProtocol() {
  console.log('\n📦 复制 amep-protocol...\n');
  
  // 查找 amep-protocol 包
  const amepPaths = [
    path.join(MONOREPO_ROOT, 'amep-protocol'),
    path.join(MONOREPO_ROOT, 'packages', 'amep-protocol')
  ];
  
  let amepPath = null;
  for (const p of amepPaths) {
    if (fs.existsSync(p)) {
      amepPath = p;
      break;
    }
  }
  
  if (!amepPath) {
    console.log('  ⚠️ 未找到 amep-protocol 包');
    return false;
  }
  
  const destModules = path.join(PACKAGE_DIR, 'node_modules');
  const destPath = path.join(destModules, 'amep-protocol');
  
  console.log(`  源路径: ${amepPath}`);
  
  // 复制 amep-protocol
  copyDir(amepPath, destPath, {
    exclude: ['.git', '.github', 'test', 'tests', 'example', 'examples', 'doc', 'docs', 'node_modules', 'src']
  });
  
  // 确保有 dist 目录
  const distPath = path.join(amepPath, 'dist');
  if (fs.existsSync(distPath)) {
    copyDir(distPath, path.join(destPath, 'dist'));
    console.log('  ✅ 已复制 dist 目录');
  }
  
  console.log('  ✅ amep-protocol 已复制');
  return true;
}

// 复制 node_modules 中的依赖
function copyNodeModules() {
  console.log('\n📦 复制依赖包...\n');
  
  // 需要复制的依赖列表
  const deps = [
    '@mozilla/readability',
    'better-sqlite3',
    'linkedom',
    'node-llama-cpp',
    'ws',
    'zod',
    'tsx',
    'typescript'
  ];
  
  // 查找 node_modules
  const possibleNodeModules = [
    path.join(ROOT_DIR, 'node_modules'),
    path.join(MONOREPO_ROOT, 'node_modules')
  ];
  
  let nodeModulesPath = null;
  for (const p of possibleNodeModules) {
    if (fs.existsSync(p)) {
      nodeModulesPath = p;
      break;
    }
  }
  
  if (!nodeModulesPath) {
    console.log('  ❌ 未找到 node_modules');
    return false;
  }
  
  console.log(`  使用 node_modules: ${nodeModulesPath}`);
  
  const destModules = path.join(PACKAGE_DIR, 'node_modules');
  ensureDir(destModules);
  
  // 复制每个依赖
  for (const dep of deps) {
    const srcPath = path.join(nodeModulesPath, dep);
    const destPath = path.join(destModules, dep);
    
    if (fs.existsSync(srcPath)) {
      console.log(`  ✅ ${dep}`);
      copyDir(srcPath, destPath, {
        exclude: ['.git', '.cache', 'test', 'tests', 'example', 'examples', 'doc', 'docs', '.github', 'src']
      });
    } else {
      console.log(`  ⚠️ 缺失: ${dep}`);
    }
  }
  
  // 复制 .bin 目录
  const srcBin = path.join(nodeModulesPath, '.bin');
  const destBin = path.join(destModules, '.bin');
  if (fs.existsSync(srcBin)) {
    ensureDir(destBin);
    const binFiles = fs.readdirSync(srcBin, { withFileTypes: true });
    for (const file of binFiles) {
      const src = path.join(srcBin, file.name);
      const dest = path.join(destBin, file.name);
      try {
        if (file.isSymbolicLink()) {
          // 解析符号链接并复制实际文件
          const realPath = fs.realpathSync(src);
          fs.copyFileSync(realPath, dest);
        } else {
          fs.copyFileSync(src, dest);
        }
      } catch (e) {}
    }
    console.log('  ✅ .bin 目录');
  }
  
  return true;
}

// 主函数
function main() {
  try {
    console.log('📁 工作目录:', ROOT_DIR);
    console.log('📁 输出目录:', PACKAGE_DIR);
    
    // 清理旧文件
    if (fs.existsSync(PACKAGE_DIR)) {
      console.log('\n🗑️  清理旧文件...');
      try {
        fs.rmSync(PACKAGE_DIR, { recursive: true, force: true });
      } catch (e) {
        console.log('  ⚠️ 清理警告:', e.message);
      }
    }
    
    // 创建目录
    console.log('\n📁 创建目录...');
    ensureDir(PACKAGE_DIR);
    console.log('  ✅', PACKAGE_DIR);
    
    // 复制源代码
    copySource();
    
    // 复制配置文件
    copyConfig();
    
    // 创建 package.json
    createPackageJson();
    
    // 创建启动脚本
    createScripts();
    createReadme();
    
    // 复制 amep-protocol
    copyAmepProtocol();
    
    // 复制 node_modules
    copyNodeModules();
    
    // 计算大小
    const totalSize = getDirSize(PACKAGE_DIR);
    
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║        ✅ 标准版打包完成！                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(`\n  📁 输出目录: ${PACKAGE_DIR}`);
    console.log(`  📦 总大小: ${formatSize(totalSize)}`);
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