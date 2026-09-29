import zlib from 'node:zlib';

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 无过滤的最小 PNG 编码器，供种子数据生成真实可解码图像 */
export function encodePng(width, height, pixelAt) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = y * (stride + 1) + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PAPER = [246, 242, 232];
const INK = [23, 24, 23];
const RULE = [150, 145, 130];
const SEAL = [178, 59, 47];

export function chartPng({ bars = [], titleBars = 0, peak = 0 } = {}) {
  const width = 720;
  const height = 420;
  const baseY = height - 56;
  const top = 40;
  const colW = (width - 96) / Math.max(bars.length, 1);
  return encodePng(width, height, (x, y) => {
    if (y % 40 === 0 && y > top - 8 && y < baseY) return RULE;
    if (y === baseY || x === 48) return INK;
    const index = Math.floor((x - 56) / colW);
    const value = bars[index];
    if (value !== undefined && x > 56 + index * colW + colW * 0.18 && x < 56 + index * colW + colW * 0.82) {
      const h = ((baseY - top) * value) / Math.max(peak, ...bars, 1);
      if (y > baseY - h) return index === titleBars ? SEAL : [122, 118, 105];
    }
    return PAPER;
  });
}
