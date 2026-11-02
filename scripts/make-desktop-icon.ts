// Draws the app icon (a torii gate) as a PNG, so the icon is made by the repository and not by a binary nobody can review.
//   tsx scripts/make-desktop-icon.ts
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const size = 512;
const pixels = Buffer.alloc(size * size * 4);
const fill = (x0: number, y0: number, x1: number, y1: number, [r, g, b, a]: number[]): void => {
  for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
      const i = (y * size + x) * 4;
      pixels[i] = r ?? 0;
      pixels[i + 1] = g ?? 0;
      pixels[i + 2] = b ?? 0;
      pixels[i + 3] = a ?? 255;
    }
  }
};

const red = [143, 45, 31, 255];
const dark = [31, 29, 26, 255];
// A rounded dark tile, then the gate: two pillars, a lower beam and a wider top beam that curves up at the ends.
const radius = 96;
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
    const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
    if (dx * dx + dy * dy <= radius * radius) {
      fill(x, y, x + 1, y + 1, dark);
    }
  }
}
fill(150, 190, 190, 410, red);
fill(322, 190, 362, 410, red);
fill(120, 232, 392, 262, red);
fill(90, 150, 422, 192, red);
fill(76, 128, 112, 150, red);
fill(400, 128, 436, 150, red);

const crc = (buf: Buffer): number => {
  let c: number;
  let value = 0xffffffff;
  for (const byte of buf) {
    c = (value ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    value = (value >>> 8) ^ c;
  }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
};

const rows = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
  rows[y * (size * 4 + 1)] = 0;
  pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
fs.writeFileSync(path.join(import.meta.dirname, "../packages/desktop/resources/icon.png"), png);
console.log(`wrote icon.png (${String(png.length)} bytes)`);
