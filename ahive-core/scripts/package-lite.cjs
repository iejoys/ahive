/**
 * 极简版打包脚本 (CommonJS)
 * 
 * 特点：
 * - 不带模型文件
 * - 首次运行时让用户选择下载
 * - 包大小 ~50MB
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release', 'lite');
const PACKAGE_DIR = path.join(RELEASE_DIR, 'ahivecore-lite');

console.log('📦 Building AHIVECORE Lite Version...\n');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest, exclude) {
  exclude = exclude || [];
  ensureDir(dest);
  fs.readdirSync(src, { withFileTypes: true }).forEach(function(e) {
    if (exclude.indexOf(e.name) >= 0) return;
    var s = path.join(src, e.name);
    var d = path.join(dest, e.name);
    if (e.isDirectory()) {
      copyDir(s, d, exclude);
    } else {
      fs.copyFileSync(s, d);
    }
  });
}

function createScripts() {
  // Windows 启动脚本
  var bat = '@echo off\n' +
    'chcp 65001 >nul\n' +
    'title AHIVECORE Lite\n' +
    'cd /d "%~dp0"\n' +
    'echo.\n' +
    'echo  ========================================\n' +
    'echo    AHIVECORE Lite - 极简版\n' +
    'echo  ========================================\n' +
    'echo.\n' +
    'echo  [检查模型...]\n' +
    'if not exist "models\\Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" (\n' +
    '    echo.\n' +
    '    echo  [!] 未检测到模型文件\n' +
    '    echo.\n' +
    '    echo  请运行: npm run download-model\n' +
    '    echo.\n' +
    '    pause\n' +
    '    exit /b 1\n' +
    ')\n' +
    'echo  [OK] 模型已就绪\n' +
    'echo.\n' +
    'echo  [启动服务...]\n' +
    'start "" http://127.0.0.1:18790\n' +
    'node --import tsx src/main.ts\n';
  
  fs.writeFileSync(path.join(PACKAGE_DIR, '启动.bat'), bat);

  // 下载模型脚本
  var downloadBat = '@echo off\n' +
    'chcp 65001 >nul\n' +
    'cd /d "%~dp0"\n' +
    'echo.\n' +
    'echo  [下载模型]\n' +
    'echo.\n' +
    'echo  可选模型:\n' +
    'echo  1. Qwen2.5-1.5B (~1GB) - 推荐\n' +
    'echo  2. Qwen2.5-3B  (~2GB)\n' +
    'echo  3. Qwen2.5-7B  (~4GB)\n' +
    'echo.\n' +
    'node scripts/download-model.cjs\n' +
    'pause\n';
  
  fs.writeFileSync(path.join(PACKAGE_DIR, '下载模型.bat'), downloadBat);
}

function createReadme() {
  var content = '# AHIVECORE Lite - 极简版\n\n' +
    '## 使用方法\n\n' +
    '1. 安装依赖: `npm install`\n' +
    '2. 下载模型: 双击 `下载模型.bat`\n' +
    '3. 启动服务: 双击 `启动.bat`\n\n' +
    '## 硬件要求\n\n' +
    '| 模型 | 内存 | GPU |\n' +
    '|------|------|-----|\n' +
    '| Qwen2.5-1.5B | 4GB | 可选 |\n' +
    '| Qwen2.5-3B | 8GB | 推荐 |\n' +
    '| Qwen2.5-7B | 16GB | 需要 |\n\n' +
    '---\n' +
    '© 2026 星未来软件工作室 | QQ: 8980188 | 微信: etflyer\n';
  
  fs.writeFileSync(path.join(PACKAGE_DIR, 'README.md'), content);
}

function main() {
  console.log('  创建目录...');
  ensureDir(PACKAGE_DIR);
  
  console.log('  复制文件...');
  var dirs = ['src', 'public', 'scripts', 'dictionaries', 'data', 'config'];
  dirs.forEach(function(d) {
    var p = path.join(ROOT_DIR, d);
    if (fs.existsSync(p)) {
      console.log('    - ' + d + '/');
      copyDir(p, path.join(PACKAGE_DIR, d), ['.git', 'node_modules', 'models']);
    }
  });
  
  // 创建空的 models 目录
  ensureDir(path.join(PACKAGE_DIR, 'models'));
  
  var files = ['package.json', 'tsconfig.json'];
  files.forEach(function(f) {
    var p = path.join(ROOT_DIR, f);
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(PACKAGE_DIR, f));
    }
  });
  
  console.log('  创建启动脚本...');
  createScripts();
  
  console.log('  创建文档...');
  createReadme();
  
  // 安装运行依赖（跳过 postinstall 脚本，不自动下载模型）
  console.log('\n  安装运行依赖...');
  var { execSync } = require('child_process');
  try {
    execSync('npm install --production --ignore-scripts', {
      cwd: PACKAGE_DIR,
      stdio: 'inherit'
    });
    console.log('  ✅ 依赖安装完成');
  } catch (err) {
    console.log('  ⚠️ 依赖安装失败，请手动运行: npm install --production --ignore-scripts');
  }
  
  console.log('\n✅ 极简版打包完成！');
  console.log('   目录: ' + PACKAGE_DIR);
  console.log('   使用: 双击 启动.bat\n');
}

main();