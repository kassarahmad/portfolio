// Generates public/og.png (1200×630) for link previews from an SVG.
// Dev-time only: needs `sharp` (npm install --no-save sharp).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || "sharp");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#f3f5f7"/>
  <rect x="0" y="0" width="16" height="630" fill="#0b5563"/>
  <text x="96" y="250" font-family="IBM Plex Sans, DejaVu Sans, sans-serif" font-size="92" font-weight="600" fill="#15202b" letter-spacing="-2">Ahmad Kassar</text>
  <text x="96" y="330" font-family="IBM Plex Sans, DejaVu Sans, sans-serif" font-size="40" fill="#3c4a57">Software engineer: full-stack development,</text>
  <text x="96" y="384" font-family="IBM Plex Sans, DejaVu Sans, sans-serif" font-size="40" fill="#3c4a57">Linux and cloud infrastructure</text>
  <text x="96" y="520" font-family="IBM Plex Sans, DejaVu Sans, sans-serif" font-size="28" fill="#5b6875">Case studies with the evidence behind every claim</text>
</svg>`;

const portrait = await sharp(path.join(ROOT, "public/ahmad-kassar.jpg")).resize(200, 222).png().toBuffer();
await sharp(Buffer.from(svg))
  .composite([{ input: portrait, left: 920, top: 120 }])
  .png({ compressionLevel: 9 })
  .toFile(path.join(ROOT, "public/og.png"));
process.stdout.write("wrote public/og.png\n");
