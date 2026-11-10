import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// Render in floating point, then dither once at export. No browser blur,
// repeated noise tile, blend mode, or opacity mask is needed on the page.
const width = 1600;
const height = 1100;
const gridWidth = 401;
const gridHeight = 276;
const base = 26;
const destination = new URL('../site/assets/', import.meta.url);
const field = new Float64Array(gridWidth * gridHeight * 3);

const layers = [
  {
    curves: [
      [
        [320, -100],
        [960, -30],
        [1350, 70],
        [1110, 285],
      ],
      [
        [1110, 285],
        [870, 500],
        [650, 440],
        [825, 600],
      ],
      [
        [825, 600],
        [1000, 760],
        [1390, 735],
        [1680, 650],
      ],
    ],
    start: [320, 80],
    end: [1280, 710],
    halfWidth: 125,
    blur: 66,
    stops: [
      [0, [116, 114, 123, 0]],
      [0.4, [146, 144, 151, 0.38]],
      [0.72, [114, 113, 120, 0.48]],
      [1, [114, 113, 120, 0]],
    ],
  },
  {
    curves: [
      [
        [1570, -150],
        [1130, -10],
        [870, 90],
        [1005, 265],
      ],
      [
        [1005, 265],
        [1140, 440],
        [1310, 390],
        [1205, 545],
      ],
    ],
    start: [1380, -90],
    end: [700, 510],
    halfWidth: 60,
    blur: 42,
    stops: [
      [0, [89, 139, 255, 0]],
      [0.45, [89, 139, 255, 0.24]],
      [1, [89, 139, 255, 0]],
    ],
  },
  {
    curves: [
      [
        [1680, 160],
        [1510, 220],
        [1160, 285],
        [1205, 400],
      ],
      [
        [1205, 400],
        [1250, 515],
        [1500, 505],
        [1640, 580],
      ],
    ],
    start: [900, 240],
    end: [1640, 580],
    halfWidth: 70,
    blur: 42,
    stops: [
      [0, [216, 107, 255, 0]],
      [0.6, [204, 134, 186, 0.17]],
      [1, [204, 134, 186, 0]],
    ],
  },
];

function bezier(points, t) {
  const s = 1 - t;
  return [0, 1].map(
    (axis) =>
      s ** 3 * points[0][axis] +
      3 * s * s * t * points[1][axis] +
      3 * s * t * t * points[2][axis] +
      t ** 3 * points[3][axis],
  );
}

function erf(x) {
  const sign = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return (
    sign *
    (1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
        t +
        0.254829592) *
        t *
        Math.exp(-x * x))
  );
}

for (const layer of layers) {
  layer.segments = layer.curves.flatMap((curve) =>
    Array.from({ length: 64 }, (_, i) => {
      const a = bezier(curve, i / 64),
        b = bezier(curve, (i + 1) / 64);
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      return { x: a[0], y: a[1], dx, dy, lengthSquared: dx * dx + dy * dy };
    }),
  );
}

for (let gy = 0; gy < gridHeight; gy++) {
  const y = (gy / (gridHeight - 1)) * height;
  for (let gx = 0; gx < gridWidth; gx++) {
    const x = (gx / (gridWidth - 1)) * width;
    const rgb = [base, base, base];
    for (const layer of layers) {
      let distanceSquared = Infinity;
      for (const segment of layer.segments) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - segment.x) * segment.dx + (y - segment.y) * segment.dy) /
              segment.lengthSquared,
          ),
        );
        const px = segment.x + t * segment.dx,
          py = segment.y + t * segment.dy;
        const d = (x - px) ** 2 + (y - py) ** 2;
        if (d < distanceSquared) distanceSquared = d;
      }
      const d = Math.sqrt(distanceSquared),
        sigma = Math.SQRT2 * layer.blur;
      const coverage =
        0.5 *
        (erf((layer.halfWidth + d) / sigma) +
          erf((layer.halfWidth - d) / sigma));
      const vx = layer.end[0] - layer.start[0],
        vy = layer.end[1] - layer.start[1];
      const position = Math.max(
        0,
        Math.min(
          1,
          ((x - layer.start[0]) * vx + (y - layer.start[1]) * vy) /
            (vx * vx + vy * vy),
        ),
      );
      let upper = layer.stops.findIndex((stop) => stop[0] >= position);
      if (upper < 1) upper = 1;
      const [a, ca] = layer.stops[upper - 1],
        [b, cb] = layer.stops[upper];
      const t = (position - a) / (b - a);
      const alpha = (ca[3] + (cb[3] - ca[3]) * t) * coverage;
      for (let channel = 0; channel < 3; channel++)
        rgb[channel] +=
          (ca[channel] + (cb[channel] - ca[channel]) * t - rgb[channel]) *
          alpha;
    }
    const scrim = 0.5 + (0.15 - 0.5) * Math.min(1, x / (width * 0.7));
    const fade = 1 - Math.max(0, Math.min(1, (y / height - 0.65) / 0.35));
    const index = (gy * gridWidth + gx) * 3;
    for (let channel = 0; channel < 3; channel++)
      field[index + channel] =
        base + (rgb[channel] - base) * (1 - scrim) * fade;
  }
}

// Smooth the field before quantization, including the joins between curves.
const radius = 12;
const weights = Array.from({ length: radius * 2 + 1 }, (_, i) =>
  Math.exp(-((i - radius) ** 2) / 32),
);
const weightSum = weights.reduce((a, b) => a + b, 0);
for (let i = 0; i < weights.length; i++) weights[i] /= weightSum;
const scratch = new Float64Array(field.length);
for (const horizontal of [true, false]) {
  for (let y = 0; y < gridHeight; y++)
    for (let x = 0; x < gridWidth; x++) {
      for (let c = 0; c < 3; c++) {
        let value = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal
            ? Math.max(0, Math.min(gridWidth - 1, x + k))
            : x;
          const sy = horizontal
            ? y
            : Math.max(0, Math.min(gridHeight - 1, y + k));
          value += field[(sy * gridWidth + sx) * 3 + c] * weights[k + radius];
        }
        scratch[(y * gridWidth + x) * 3 + c] = value;
      }
    }
  field.set(scratch);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type),
    body = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}

function render(scale) {
  const w = width * scale,
    h = height * scale,
    stride = w * 3;
  const scanlines = Buffer.alloc((stride + 1) * h);
  let state = 0x6d2b79f5;
  function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  for (let y = 0; y < h; y++) {
    const py = (y / (h - 1)) * (gridHeight - 1),
      y0 = Math.min(gridHeight - 2, Math.floor(py)),
      ty = py - y0;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) {
      const px = (x / (w - 1)) * (gridWidth - 1),
        x0 = Math.min(gridWidth - 2, Math.floor(px)),
        tx = px - x0;
      const a = (y0 * gridWidth + x0) * 3,
        b = a + gridWidth * 3;
      const grain = (random() - 0.5) * 0.6,
        threshold = random();
      for (let c = 0; c < 3; c++) {
        const top = field[a + c] + (field[a + 3 + c] - field[a + c]) * tx;
        const bottom = field[b + c] + (field[b + 3 + c] - field[b + c]) * tx;
        row[x * 3 + c] = Math.max(
          0,
          Math.min(
            255,
            Math.floor(top + (bottom - top) * ty + grain + threshold),
          ),
        );
      }
    }
    const start = y * (stride + 1);
    scanlines[start] = 1;
    for (let x = 0; x < stride; x++)
      scanlines[start + 1 + x] = (row[x] - (x >= 3 ? row[x - 3] : 0)) & 255;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('sRGB', Buffer.from([0])),
    chunk(
      'tEXt',
      Buffer.from(
        'Description\0Generated by scripts/generate-marketing-hero.mjs; floating-point curved color fields with non-repeating final-resolution grain and stochastic dithering.',
      ),
    ),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(destination, { recursive: true });
for (const scale of [1, 2]) {
  const name = `hero-atmosphere${scale === 2 ? '@2x' : ''}.png`;
  const png = render(scale);
  await writeFile(new URL(name, destination), png);
  console.log(
    `${name}: ${width * scale}×${height * scale}, ${(png.length / 1024).toFixed(0)} KiB`,
  );
}
