// Dependency-free PNG icon generator for the Portfolio Dashboard PWA.
// Draws a navy rounded tile with three ascending "chart" bars + a trend dot.
// Run: node producer/gen-icons.mjs   (writes into ../icons)
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS = join(__dirname, '..', 'icons');
mkdirSync(ICONS, { recursive: true });

// --- minimal PNG encoder (truecolor + alpha) ---
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  // background gradient navy
  const top = hex('#1a1a2e'), bot = hex('#0f3460');
  const radius = maskable ? 0 : size * 0.22; // maskable fills the full square (safe zone handled by OS)
  const inCorner = (x, y) => {
    if (radius === 0) return true;
    const cx = x < radius ? radius : x > size - radius ? size - radius : x;
    const cy = y < radius ? radius : y > size - radius ? size - radius : y;
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    const tcol = [
      Math.round(top[0] + (bot[0] - top[0]) * (y / size)),
      Math.round(top[1] + (bot[1] - top[1]) * (y / size)),
      Math.round(top[2] + (bot[2] - top[2]) * (y / size)),
    ];
    for (let x = 0; x < size; x++) set(x, y, tcol, inCorner(x, y) ? 255 : 0);
  }
  // three ascending bars
  const pad = size * (maskable ? 0.30 : 0.24);
  const innerW = size - pad * 2;
  const barW = innerW * 0.22;
  const gap = (innerW - barW * 3) / 2;
  const baseY = size - pad;
  const heights = [0.34, 0.58, 0.86];
  const colors = ['#6366f1', '#3b82f6', '#10b981'];
  heights.forEach((h, i) => {
    const bx = Math.round(pad + i * (barW + gap));
    const bh = Math.round(innerW * h);
    const col = hex(colors[i]);
    for (let y = Math.round(baseY - bh); y < baseY; y++)
      for (let x = bx; x < bx + barW; x++) set(x, y, col, 255);
  });
  return encodePNG(size, size, buf);
}

const outputs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];
for (const [name, size, opts] of outputs) {
  writeFileSync(join(ICONS, name), draw(size, opts));
  console.log('wrote icons/' + name + ' (' + size + 'x' + size + ')');
}
