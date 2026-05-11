/**
 * AHIVECORE 安装包生成脚本
 * 
 * 功能：
 * - 检查并创建图标
 * - 编译 TypeScript
 * - 生成 Windows 安装包
 * - 包含所有依赖和模型
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const RESOURCES_DIR = path.join(ROOT_DIR, 'electron', 'resources');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║        AHIVECORE 安装包生成器                              ║');
console.log('║        一键安装，无需配置环境                               ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// 检查图标
function checkIcon() {
  console.log('📋 检查图标文件...\n');
  
  const iconIco = path.join(RESOURCES_DIR, 'icon.ico');
  const iconPng = path.join(RESOURCES_DIR, 'icon.png');
  const iconSvg = path.join(RESOURCES_DIR, 'icon.svg');
  
  if (fs.existsSync(iconIco)) {
    console.log('  ✅ icon.ico 已存在');
    return true;
  }
  
  // 如果有 PNG，尝试转换
  if (fs.existsSync(iconPng)) {
    console.log('  📦 发现 icon.png，尝试转换为 ico...');
    try {
      // 使用 electron-builder 的图标转换
      const { createICO } = require('electron-builder-lib/out/targets/nsis/nsisUtil');
      // 简单方案：复制 PNG 作为临时方案
      console.log('  ⚠️ 无法自动转换，将使用 PNG 图标');
      return true;
    } catch (e) {
      console.log('  ⚠️ 转换失败:', e.message);
    }
  }
  
  // 创建默认图标
  console.log('  📝 创建默认图标...');
  createDefaultIcon();
  return true;
}

// 创建默认图标（简单的 Base64 编码的 PNG）
function createDefaultIcon() {
  // 使用 electron-builder 默认图标
  const defaultIcon = path.join(
    ROOT_DIR, 
    'node_modules', 
    'app-builder-lib', 
    'templates', 
    'icons', 
    'proton-native', 
    'proton-native.ico'
  );
  
  if (fs.existsSync(defaultIcon)) {
    const destIcon = path.join(RESOURCES_DIR, 'icon.ico');
    fs.copyFileSync(defaultIcon, destIcon);
    console.log('  ✅ 已创建默认图标');
    return;
  }
  
  console.log('  ⚠️ 未找到默认图标，将使用 electron-builder 默认图标');
}

// 检查模型文件
function checkModel() {
  console.log('\n📋 检查模型文件...\n');
  
  const modelsDir = path.join(ROOT_DIR, 'models');
  const modelFile = 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf';
  const modelPath = path.join(modelsDir, modelFile);
  
  if (fs.existsSync(modelPath)) {
    const stats = fs.statSync(modelPath);
    const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);
    console.log(`  ✅ 模型已存在: ${modelFile} (${sizeGB} GB)`);
    return true;
  }
  
  console.log('  ⚠️ 模型文件不存在');
  console.log('  📥 请运行: npm run download-model');
  return false;
}

// 编译 TypeScript
function buildTypeScript() {
  console.log('\n🔨 编译 TypeScript...\n');
  
  try {
    execSync('npx tsc', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('\n  ✅ TypeScript 编译完成');
    return true;
  } catch (e) {
    console.error('\n  ❌ TypeScript 编译失败:', e.message);
    return false;
  }
}

// 运行 electron-builder
function buildInstaller() {
  console.log('\n📦 生成安装包...\n');
  
  // 设置环境变量
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
  process.env.ELECTRON_CUSTOM_DIR = 'v32.3.3';
  
  try {
    execSync('npx electron-builder --win --x64', { 
      cwd: ROOT_DIR, 
      stdio: 'inherit',
      env: process.env
    });
    console.log('\n  ✅ 安装包生成完成');
    return true;
  } catch (e) {
    console.error('\n  ❌ 安装包生成失败:', e.message);
    return false;
  }
}

// 显示结果
function showResult() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║        ✅ 安装包生成完成！                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  // 查找生成的安装包
  if (fs.existsSync(RELEASE_DIR)) {
    const files = fs.readdirSync(RELEASE_DIR).filter(f => f.endsWith('.exe'));
    if (files.length > 0) {
      console.log('  📁 安装包位置:');
      files.forEach(f => {
        const filePath = path.join(RELEASE_DIR, f);
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`     - ${f} (${sizeMB} MB)`);
      });
    }
  }
  
  console.log('\n  📝 使用说明:');
  console.log('     1. 双击安装包进行安装');
  console.log('     2. 安装后运行 AHIVECORE');
  console.log('     3. 访问 http://127.0.0.1:18790\n');
}

// 主函数
async function main() {
  try {
    // 1. 检查图标
    checkIcon();
    
    // 2. 检查模型
    const hasModel = checkModel();
    if (!hasModel) {
      console.log('\n  ⚠️ 警告: 安装包将不包含模型文件');
      console.log('     用户安装后需要手动下载模型\n');
    }
    
    // 3. 编译 TypeScript
    if (!buildTypeScript()) {
      process.exit(1);
    }
    
    // 4. 生成安装包
    if (!buildInstaller()) {
      process.exit(1);
    }
    
    // 5. 显示结果
    showResult();
    
  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();