import esbuild from 'esbuild';
import { join } from 'path';

const isDev = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: [
    join(process.cwd(), 'electron/main.ts'),
    join(process.cwd(), 'electron/preload.ts'),
  ],
  outdir: join(process.cwd(), 'dist-electron'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: [
    'electron',
    'electron-log',
    'ws',
    'bufferutil',
    'utf-8-validate',
    // ahive-llm-center 是 ES Module，需要打包进去
    'ahive-core',
    'amep-protocol',
  ],
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
});

if (isDev) {
  // 监听模式
  await ctx.watch();
  console.log('Watching for changes...');
  
  // 启动 Electron
  const { spawn } = await import('child_process');
  const electron = spawn('electron', ['.'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });
  
  electron.on('close', () => {
    ctx.dispose();
    process.exit(0);
  });
} else {
  // 单次编译
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Build complete');
}