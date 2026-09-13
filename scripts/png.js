const zlib = require('node:zlib');

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const circle = (cx, cy, r) => (px, py) => Math.hypot(px - cx, py - cy) <= r;

const roundedRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  if (qx <= 0 || qy <= 0) return true;
  return Math.hypot(qx, qy) <= r;
};

const stroke = (segments, halfWidth) => (px, py) => {
  for (const s of segments) {
    if (distToSegment(px, py, s[0], s[1], s[2], s[3]) <= halfWidth) return true;
  }
  return false;
};

const polygon = (points) => (px, py) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const difference = (a, b) => (px, py) => a(px, py) && !b(px, py);
const union = (...shapes) => (px, py) => shapes.some((s) => s(px, py));

function cubeSegments(cx, cy, r) {
  const k = Math.sqrt(3) / 2;
  const v = [
    [cx, cy - r],
    [cx + k * r, cy - r / 2],
    [cx + k * r, cy + r / 2],
    [cx, cy + r],
    [cx - k * r, cy + r / 2],
    [cx - k * r, cy - r / 2]
  ];
  const segs = [];
  for (let i = 0; i < 6; i++) segs.push([...v[i], ...v[(i + 1) % 6]]);
  segs.push([cx, cy, ...v[0]]);
  segs.push([cx, cy, ...v[2]]);
  segs.push([cx, cy, ...v[4]]);
  return segs;
}

class Surface {
  constructor(width, height, samples = 4) {
    this.width = width;
    this.height = height;
    this.samples = samples;
    this.data = Buffer.alloc(width * height * 4);
  }

  paint(shape, color) {
    const [r, g, b] = color;
    const ss = this.samples;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let hits = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            if (shape(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss)) hits++;
          }
        }
        if (hits === 0) continue;
        const a = hits / (ss * ss);
        const i = (y * this.width + x) * 4;
        const da = this.data[i + 3] / 255;
        const oa = a + da * (1 - a);
        const mix = (src, dst) => Math.round((src * a + dst * da * (1 - a)) / oa);
        this.data[i] = mix(r, this.data[i]);
        this.data[i + 1] = mix(g, this.data[i + 1]);
        this.data[i + 2] = mix(b, this.data[i + 2]);
        this.data[i + 3] = Math.round(oa * 255);
      }
    }
    return this;
  }

  toPng() {
    return encodePng(this.width, this.height, this.data);
  }
}

module.exports = {
  Surface,
  circle,
  roundedRect,
  stroke,
  polygon,
  difference,
  union,
  cubeSegments
};
