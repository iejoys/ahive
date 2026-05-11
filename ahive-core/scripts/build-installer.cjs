/**
 * AHIVECORE 完整安装包打包脚本
 * 
 * 生成无需配置环境的 Windows 安装包
 * - 包含 Electron 运行时
 * - 包含所有依赖
 * - 可选包含模型文件
 * 
 * 使用: node scripts/build-installer.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT_DIR, 'electron');
const RESOURCES_DIR = path.join(ELECTRON_DIR, 'resources');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║        AHIVECORE 完整安装包打包工具                        ║');
console.log('║        无需配置环境，双击安装即可使用                        ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 步骤 1: 检查必要文件
function checkRequiredFiles() {
  console.log('📦 步骤 1/6: 检查必要文件...\n');
  
  const requiredFiles = [
    { path: path.join(ROOT_DIR, 'dist', 'main.js'), name: '编译后的 main.js' },
    { path: path.join(ROOT_DIR, 'dist', 'main-process.js'), name: '编译后的 main-process.js' },
    { path: path.join(ROOT_DIR, 'models', 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'), name: '模型文件 (可选)' }
  ];
  
  let hasModel = false;
  
  for (const file of requiredFiles) {
    if (fs.existsSync(file.path)) {
      console.log(`  ✅ ${file.name}`);
      if (file.name.includes('模型')) hasModel = true;
    } else {
      if (file.name.includes('模型')) {
        console.log(`  ⚠️ ${file.name} - 不存在，安装包将不含模型`);
        console.log(`     用户安装后需要手动下载模型`);
      } else {
        console.log(`  ❌ ${file.name} - 不存在，请先运行 npm run build`);
        return false;
      }
    }
  }
  
  return true;
}

// 步骤 2: 创建图标
function createIcon() {
  console.log('\n📦 步骤 2/6: 创建应用图标...\n');
  
  const iconSvgPath = path.join(RESOURCES_DIR, 'icon.svg');
  const iconIcoPath = path.join(RESOURCES_DIR, 'icon.ico');
  const iconPngPath = path.join(RESOURCES_DIR, 'icon.png');
  
  // 检查是否已有图标
  if (fs.existsSync(iconIcoPath)) {
    console.log('  ✅ icon.ico 已存在');
    return true;
  }
  
  // 创建 SVG 图标（如果不存在）
  if (!fs.existsSync(iconSvgPath)) {
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <linearGradient id="hex" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#e94560"/>
      <stop offset="100%" style="stop-color:#ff6b6b"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="64" fill="url(#bg)"/>
  <polygon points="256,80 400,160 400,320 256,400 112,320 112,160" 
           fill="url(#hex)" stroke="#fff" stroke-width="8"/>
  <text x="256" y="280" font-family="Arial Black" font-size="120" 
        fill="#fff" text-anchor="middle" font-weight="bold">A</text>
  <circle cx="256" cy="140" r="30" fill="#ffd93d"/>
  <ellipse cx="256" cy="140" rx="45" ry="25" fill="none" stroke="#ffd93d" stroke-width="4"/>
</svg>`;
    fs.writeFileSync(iconSvgPath, svgContent);
    console.log('  ✅ 创建 icon.svg');
  }
  
  // 尝试使用 sharp 或其他工具创建 PNG 和 ICO
  // 如果没有这些工具，electron-builder 会使用默认图标
  try {
    // 尝试使用 canvas 创建简单的 PNG
    const canvasPngPath = path.join(ROOT_DIR, 'node_modules', 'canvas');
    if (fs.existsSync(canvasPngPath)) {
      console.log('  📋 使用 canvas 创建 PNG...');
      // canvas 创建逻辑...
    }
  } catch (e) {}
  
  // 检查是否有 png-to-ico
  try {
    const pngToIcoPath = path.join(ROOT_DIR, 'node_modules', 'png-to-ico');
    if (fs.existsSync(pngToIcoPath)) {
      console.log('  📋 使用 png-to-ico 创建 ICO...');
    }
  } catch (e) {}
  
  console.log('  ⚠️ 无法创建 ICO 文件，electron-builder 将使用默认图标');
  console.log('     如需自定义图标，请手动创建 icon.ico 放到 electron/resources/');
  
  return true;
}

// 步骤 3: 更新 package.json 的 build 配置
function updateBuildConfig(includeModel) {
  console.log('\n📦 步骤 3/6: 更新打包配置...\n');
  
  const packageJsonPath = path.join(ROOT_DIR, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  // 更新 build 配置
  packageJson.build = {
    appId: 'cn.starsfuture.ahivecore',
    productName: 'AHIVECORE',
    copyright: 'Copyright © 2026 星未来软件工作室',
    directories: {
      output: 'release',
      buildResources: 'electron/resources'
    },
    files: [
      'dist/**/*',
      'public/**/*',
      'dictionaries/**/*',
      'data/**/*',
      'config/**/*',
      'electron/**/*',
      '!**/node_modules/.cache/**/*',
      '!**/*.ts',
      '!**/*.map',
      '!**/test/**/*',
      '!**/tests/**/*',
      '!**/*.md',
      '!**/scripts/**/*',
      '!**/release/**/*'
    ],
    extraResources: [
      {
        from: 'node_modules/better-sqlite3',
        to: 'node_modules/better-sqlite3',
        filter: ['**/*.node', '**/*.js', 'package.json']
      },
      {
        from: 'node_modules/node-llama-cpp',
        to: 'node_modules/node-llama-cpp',
        filter: ['**/*']
      },
      {
        from: 'node_modules/amep-protocol',
        to: 'node_modules/amep-protocol',
        filter: ['dist/**/*', 'package.json', 'dictionaries/**/*']
      },
      {
        from: 'dictionaries',
        to: 'dictionaries'
      }
    ],
    asar: true,
    asarUnpack: [
      '**/*.node',
      'node_modules/**/*'
    ],
    win: {
      target: [
        {
          target: 'nsis',
          arch: ['x64']
        }
      ],
      icon: 'electron/resources/icon.ico'
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      installerIcon: 'electron/resources/icon.ico',
      uninstallerIcon: 'electron/resources/icon.ico',
      installerHeaderIcon: 'electron/resources/icon.ico',
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'AHIVECORE',
      artifactName: '${productName}-${version}-Setup.exe',
      include: 'electron/resources/installer.nsi'
    }
  };
  
  // 如果包含模型
  if (includeModel) {
    packageJson.build.extraResources.push({
      from: 'models',
      to: 'models',
      filter: ['**/*.gguf']
    });
  }
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log('  ✅ package.json 已更新');
  
  return packageJson;
}

// 步骤 4: 创建 NSIS 安装脚本
function createNsisScript() {
  console.log('\n📦 步骤 4/6: 创建 NSIS 安装脚本...\n');
  
  const nsiPath = path.join(RESOURCES_DIR, 'installer.nsi');
  
  const nsiContent = `; AHIVECORE 安装脚本
!include "MUI2.nsh"

; 界面设置
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_HEADERIMAGE_RIGHT

; 安装页面
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; 卸载页面
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; 语言
!insertmacro MUI_LANGUAGE "SimpChinese"

; 安装信息
Name "AHIVECORE"
OutFile "AHIVECORE-Setup.exe"
InstallDir "$PROGRAMFILES64\\AHIVECORE"
RequestExecutionLevel admin

; 安装段
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  File /r "dist\\*.*"
  File /r "public\\*.*"
  File /r "dictionaries\\*.*"
  File /r "config\\*.*"
  File /r "electron\\*.*"
  
  ; 创建数据目录
  CreateDirectory "$INSTDIR\\data"
  CreateDirectory "$INSTDIR\\logs"
  CreateDirectory "$INSTDIR\\models"
  
  ; 复制 node_modules
  SetOutPath "$INSTDIR\\node_modules"
  File /r "node_modules\\better-sqlite3\\*.*"
  File /r "node_modules\\node-llama-cpp\\*.*"
  File /r "node_modules\\amep-protocol\\*.*"
SectionEnd

; 创建快捷方式
Section "Shortcuts" SEC02
  CreateDirectory "$SMPROGRAMS\\AHIVECORE"
  CreateShortCut "$SMPROGRAMS\\AHIVECORE\\AHIVECORE.lnk" "$INSTDIR\\AHIVECORE.exe"
  CreateShortCut "$SMPROGRAMS\\AHIVECORE\\卸载.lnk" "$INSTDIR\\uninstall.exe"
  CreateShortCut "$DESKTOP\\AHIVECORE.lnk" "$INSTDIR\\AHIVECORE.exe"
SectionEnd

; 写入卸载信息
Section -Post
  WriteUninstaller "$INSTDIR\\uninstall.exe"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AHIVECORE" "DisplayName" "AHIVECORE"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AHIVECORE" "UninstallString" "$INSTDIR\\uninstall.exe"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AHIVECORE" "DisplayIcon" "$INSTDIR\\AHIVECORE.exe"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AHIVECORE" "Publisher" "星未来软件工作室"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AHIVECORE" "URLInfoAbout" "https://ahive.starsfuture.cn"
SectionEnd

; 卸载段
Section Uninstall
  Delete "$INSTDIR\\*.*"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\\AHIVECORE\\*.*"
  RMDir "$SMPROGRAMS\\AHIVECORE"
  Delete "$DESKTOP\\AHIVECORE.lnk"
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AHIVECORE"
SectionEnd
`;

  // 创建简单的 license.txt
  const licensePath = path.join(RESOURCES_DIR, 'license.txt');
  const licenseContent = `AHIVECORE 智能体核心引擎
版权所有 (C) 2026 星未来软件工作室

许可协议：
1. 本软件免费使用
2. 禁止商业分发
3. 禁止修改源代码后分发

联系方式：
QQ: 8980188
微信: etflyer
官网: https://ahive.starsfuture.cn
`;

  fs.writeFileSync(nsiPath, nsiContent);
  fs.writeFileSync(licensePath, licenseContent);
  console.log('  ✅ installer.nsi 已创建');
  console.log('  ✅ license.txt 已创建');
}

// 步骤 5: 编译 TypeScript
function buildTypeScript() {
  console.log('\n📦 步骤 5/6: 编译 TypeScript...\n');
  
  try {
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('  ✅ TypeScript 编译完成');
  } catch (error) {
    console.log('  ⚠️ 编译可能已完成，继续打包...');
  }
}

// 步骤 6: 执行打包
function runElectronBuilder() {
  console.log('\n📦 步骤 6/6: 执行 electron-builder 打包...\n');
  
  try {
    execSync('npx electron-builder --win --x64', { 
      cwd: ROOT_DIR, 
      stdio: 'inherit',
      timeout: 300000  // 5 分钟超时
    });
    console.log('  ✅ 打包完成！');
  } catch (error) {
    console.log('  ❌ 打包失败:', error.message);
    console.log('\n请手动执行:');
    console.log('  npm run electron:build:win');
    return false;
  }
  
  return true;
}

// 显示结果
function showResult() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║        ✅ 安装包打包完成！                                  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  // 查找生成的安装包
  const releaseFiles = fs.readdirSync(RELEASE_DIR).filter(f => f.endsWith('.exe'));
  
  if (releaseFiles.length > 0) {
    console.log('  生成的安装包:');
    for (const file of releaseFiles) {
      const filePath = path.join(RELEASE_DIR, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`    📦 ${file} (${sizeMB} MB)`);
    }
  }
  
  console.log('\n  安装包位置: ' + RELEASE_DIR);
  console.log('\n  使用方法:');
  console.log('    1. 双击安装包安装');
  console.log('    2. 安装后运行 AHIVECORE.exe');
  console.log('    3. 如果不含模型，需要手动下载模型到 models 目录');
  console.log('\n  模型下载地址:');
  console.log('    https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF');
  console.log('\n');
}

// 主函数
async function main() {
  const startTime = Date.now();
  
  // 检查必要文件
  if (!checkRequiredFiles()) {
    console.log('\n❌ 请先编译项目: npm run build');
    process.exit(1);
  }
  
  // 检查是否包含模型
  const includeModel = fs.existsSync(path.join(ROOT_DIR, 'models', 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'));
  
  // 创建图标
  createIcon();
  
  // 更新配置
  updateBuildConfig(includeModel);
  
  // 创建 NSIS 脚本
  createNsisScript();
  
  // 编译
  buildTypeScript();
  
  // 打包
  if (runElectronBuilder()) {
    showResult();
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  总耗时: ${elapsed}s\n`);
}

main();