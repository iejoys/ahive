/**
 * 下载 Qwen3-4B-Function-Calling-Pro 模型
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 模型配置
const MODEL_CONFIG = {
  name: 'Qwen3-4B-Function-Calling-Pro.gguf',
  expectedSize: 3117612090, // 约 2.9GB
  mirrors: [
    {
      name: 'HuggingFace 镜像 (国内推荐)',
      url: 'https://hf-mirror.com/Manojb/Qwen3-4B-toolcalling-gguf-codex/resolve/main/Qwen3-4B-Function-Calling-Pro.gguf'
    },
    {
      name: 'HuggingFace 原版',
      url: 'https://huggingface.co/Manojb/Qwen3-4B-toolcalling-gguf-codex/resolve/main/Qwen3-4B-Function-Calling-Pro.gguf'
    }
  ]
};

const MODELS_DIR = path.join(__dirname, '..', 'models');
const MODEL_PATH = path.join(MODELS_DIR, MODEL_CONFIG.name);

// 进度显示
let lastPercent = 0;

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`\n  📥 下载中: ${url.substring(0, 70)}...`);
    
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    let totalSize = 0;
    
    const request = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      // 处理重定向
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`  ↪️ 重定向到: ${redirectUrl.substring(0, 70)}...`);
        file.close();
        fs.unlinkSync(dest);
        downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`下载失败: HTTP ${response.statusCode}`));
        return;
      }
      
      totalSize = parseInt(response.headers['content-length'], 10) || 0;
      console.log(`  📦 文件大小: ${formatBytes(totalSize)}`);
      
      response.pipe(file);
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = totalSize ? Math.floor((downloaded / totalSize) * 100) : 0;
        
        // 每 5% 更新一次
        if (percent - lastPercent >= 5 || percent === 100) {
          lastPercent = percent;
          process.stdout.write(`\r  ⏳ 进度: ${percent}% (${formatBytes(downloaded)}/${formatBytes(totalSize)})`);
        }
      });
      
      file.on('finish', () => {
        file.close();
        console.log('\n  ✅ 下载完成!');
        resolve();
      });
    });
    
    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
    
    request.setTimeout(600000, () => { // 10分钟超时
      request.destroy();
      reject(new Error('下载超时'));
    });
  });
}

async function downloadModel() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║        Qwen3-4B-Function-Calling-Pro 模型下载器           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  // 检查现有文件
  if (fs.existsSync(MODEL_PATH)) {
    const stats = fs.statSync(MODEL_PATH);
    console.log(`  📁 现有文件大小: ${formatBytes(stats.size)}`);
    
    if (stats.size >= 3000000000) { // 大于3GB认为完整
      console.log('  ✅ 模型文件已完整，跳过下载。\n');
      return;
    } else {
      console.log('  ⚠️ 文件不完整，重新下载...');
      fs.unlinkSync(MODEL_PATH);
    }
  }
  
  // 创建目录
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
  
  console.log(`  🤖 模型: ${MODEL_CONFIG.name}`);
  console.log(`  📁 路径: ${MODEL_PATH}`);
  console.log(`  💾 预期大小: ~2.9GB`);
  console.log('');
  
  // 尝试各个镜像
  for (let i = 0; i < MODEL_CONFIG.mirrors.length; i++) {
    const mirror = MODEL_CONFIG.mirrors[i];
    console.log(`\n  [${i + 1}/${MODEL_CONFIG.mirrors.length}] 尝试: ${mirror.name}`);
    
    try {
      lastPercent = 0;
      await downloadFile(mirror.url, MODEL_PATH);
      
      // 验证文件大小
      const stats = fs.statSync(MODEL_PATH);
      console.log(`\n  📊 下载文件大小: ${formatBytes(stats.size)}`);
      
      if (stats.size >= 3000000000) {
        console.log('\n  🎉 模型下载成功!\n');
        return;
      } else {
        console.log('  ⚠️ 文件大小不符合预期，可能下载不完整');
        fs.unlinkSync(MODEL_PATH);
      }
    } catch (error) {
      console.log(`\n  ❌ 下载失败: ${error.message}`);
      
      // 清理失败的文件
      if (fs.existsSync(MODEL_PATH)) {
        fs.unlinkSync(MODEL_PATH);
      }
      
      if (i < MODEL_CONFIG.mirrors.length - 1) {
        console.log('  尝试下一个镜像...');
      }
    }
  }
  
  // 所有镜像都失败
  console.log('\n  ⚠️ 自动下载失败。请手动下载模型:');
  console.log(`    下载地址: ${MODEL_CONFIG.mirrors[0].url}`);
  console.log(`    保存到: ${MODEL_PATH}`);
  console.log('');
}

// 运行下载
downloadModel().catch((error) => {
  console.error('  下载出错:', error.message);
  process.exit(1);
});