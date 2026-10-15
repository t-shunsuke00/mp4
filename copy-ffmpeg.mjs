import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.cwd();
const dest = resolve(root, 'public/ffmpeg');
await mkdir(dest, { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(resolve(root, 'node_modules/@ffmpeg/core/dist/umd', file), resolve(dest, file));
}
console.log('Copied single-thread ffmpeg.wasm runtime into public/ffmpeg');
