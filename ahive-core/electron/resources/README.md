# Electron 图标资源

## 所需文件

- `icon.ico` - Windows 应用图标 (256x256 或更大)
- `icon.png` - PNG 格式图标 (512x512 推荐)

## 图标要求

1. **尺寸**: 至少 256x256 像素
2. **格式**: 
   - Windows: `.ico` 格式
   - Linux/Mac: `.png` 格式
3. **风格**: 建议使用蜜蜂🐝或六边形元素

## 快速生成

### 方法一：在线工具

1. 访问 https://icoconvert.com/ 或 https://convertio.co/png-ico/
2. 上传 512x512 的 PNG 图片
3. 选择需要的尺寸 (16x16, 32x32, 48x48, 64x64, 128x128, 256x256)
4. 下载生成的 `.ico` 文件
5. 保存为 `icon.ico`

### 方法二：使用 ImageMagick

```bash
# 安装 ImageMagick
# Windows: choco install imagemagick
# Mac: brew install imagemagick

# 从 PNG 生成 ICO
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### 方法三：使用 Node.js

```bash
npm install -g to-ico

# 从 PNG 生成
to-ico icon.png > icon.ico
```

## 临时方案

打包时会使用 Electron 默认图标。
请尽快替换为自定义图标。

---
© 2026 星未来软件工作室