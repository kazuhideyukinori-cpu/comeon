import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "..", "node_modules", "@ffmpeg", "core", "dist", "esm");
const destDir = path.join(root, "..", "public", "ffmpeg");

mkdirSync(destDir, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}
console.log("ffmpeg-core copied to public/ffmpeg/");
