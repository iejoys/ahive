/**
 * 创建应用图标
 * 使用 canvas 生成 PNG 和 ICO 文件
 */

const fs = require('fs');
const path = require('path');

// 检查是否有 canvas 包
let createCanvas;
try {
  createCanvas = require('canvas').createCanvas;
} catch (e) {
  console.log('canvas 包未安装，使用简单方案');
}

const RESOURCES_DIR = path.join(__dirname, '..', 'electron', 'resources');

// 创建简单的 SVG 图标
function createSvgIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
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
  
  <!-- 背景 -->
  <rect width="512" height="512" rx="80" fill="url(#bg)"/>
  
  <!-- 六边形 -->
  <polygon points="256,80 400,160 400,320 256,400 112,320 112,160" 
           fill="none" stroke="url(#hex)" stroke-width="12"/>
  
  <!-- 内部六边形 -->
  <polygon points="256,140 350,195 350,305 256,360 162,305 162,195" 
           fill="url(#hex)" opacity="0.3"/>
  
  <!-- 蜜蜂图标 -->
  <g transform="translate(256, 240)">
    <!-- 身体 -->
    <ellipse cx="0" cy="20" rx="35" ry="45" fill="#f4d03f"/>
    <!-- 条纹 -->
    <rect x="-35" y="5" width="70" height="10" fill="#1a1a2e"/>
    <rect x="-35" y="25" width="70" height="10" fill="#1a1a2e"/>
    <!-- 头 -->
    <circle cx="0" cy="-35" r="25" fill="#f4d03f"/>
    <!-- 眼睛 -->
    <circle cx="-10" cy="-40" r="5" fill="#1a1a2e"/>
    <circle cx="10" cy="-40" r="5" fill="#1a1a2e"/>
    <!-- 翅膀 -->
    <ellipse cx="-45" cy="0" rx="25" ry="35" fill="white" opacity="0.6"/>
    <ellipse cx="45" cy="0" rx="25" ry="35" fill="white" opacity="0.6"/>
  </g>
  
  <!-- 文字 -->
  <text x="256" y="470" text-anchor="middle" font-family="Arial, sans-serif" 
        font-size="36" font-weight="bold" fill="#e94560">AHIVE</text>
</svg>`;

  const svgPath = path.join(RESOURCES_DIR, 'icon.svg');
  fs.writeFileSync(svgPath, svg);
  console.log('✅ 创建 SVG 图标:', svgPath);
  return svgPath;
}

// 创建 PNG 图标 (使用 sharp 或 jimp)
async function createPngIcon() {
  const sharp = require('sharp');
  const svgPath = path.join(RESOURCES_DIR, 'icon.svg');
  const pngPath = path.join(RESOURCES_DIR, 'icon.png');
  
  await sharp(svgPath)
    .resize(512, 512)
    .png()
    .toFile(pngPath);
  
  console.log('✅ 创建 PNG 图标:', pngPath);
  return pngPath;
}

// 创建 ICO 图标
async function createIcoIcon() {
  const pngPath = path.join(RESOURCES_DIR, 'icon.png');
  const icoPath = path.join(RESOURCES_DIR, 'icon.ico');
  
  // 尝试使用 png-to-ico
  try {
    const pngToIco = require('png-to-ico');
    const buffer = await pngToIco(pngPath);
    fs.writeFileSync(icoPath, buffer);
    console.log('✅ 创建 ICO 图标:', icoPath);
    return icoPath;
  } catch (e) {
    console.log('⚠️ png-to-ico 未安装，尝试其他方案...');
  }
  
  // 尝试使用 sharp 生成多尺寸 PNG，然后手动创建 ICO
  // ICO 文件格式比较复杂，这里使用简单方案
  console.log('⚠️ 无法创建 ICO，electron-builder 会自动从 PNG 生成');
  return null;
}

// 主函数
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║        创建 AHIVECORE 应用图标                              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  // 确保目录存在
  if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  }
  
  // 创建 SVG
  createSvgIcon();
  
  // 尝试创建 PNG
  try {
    await createPngIcon();
  } catch (e) {
    console.log('⚠️ 创建 PNG 失败:', e.message);
    console.log('   请安装 sharp: npm install sharp');
  }
  
  // 尝试创建 ICO
  try {
    await createIcoIcon();
  } catch (e) {
    console.log('⚠️ 创建 ICO 失败:', e.message);
  }
  
  console.log('\n✅ 图标创建完成！');
}

main().catch(console.error);