'use strict';

/**
 * Gera o ícone mestre do AutoFlow Desktop (build/icon.png, 1024×1024) sem
 * depender de nenhuma biblioteca externa de imagem — apenas o módulo
 * `zlib` do próprio Node para codificar o PNG.
 *
 * Desenho: quadrado arredondado com gradiente diagonal na cor da marca
 * (verde WhatsApp) e um raio ⚡ em negativo (azul-marinho), o mesmo
 * conceito visual do "brand-mark" usado na barra lateral do builder.
 *
 * O electron-builder deriva automaticamente o .ico (Windows) e o .icns
 * (macOS) a partir deste único PNG de alta resolução.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const SUPERSAMPLE = 2; // renderiza em 2048² e reduz para suavizar as bordas
const RENDER_SIZE = SIZE * SUPERSAMPLE;

const COLOR_BG_START = [37, 211, 102]; // #25d366
const COLOR_BG_END = [30, 169, 82]; // #1ea952
const COLOR_BOLT = [11, 18, 32]; // #0b1220

// Raio no viewBox 24x24 (mesmo desenho do ícone "zap" clássico).
const BOLT_POLYGON = [
  [13, 2],
  [3, 14],
  [12, 14],
  [11, 22],
  [21, 10],
  [12, 10],
];

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(x, y, w, h, r) {
  const nx = Math.min(x, w - 1 - x);
  const ny = Math.min(y, h - 1 - y);
  if (nx >= r || ny >= r) return true;
  const dx = r - nx;
  const dy = r - ny;
  return dx * dx + dy * dy <= r * r;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildBoltTransform() {
  // Bounding box do raio dentro do viewBox 24x24.
  const minX = 3;
  const maxX = 21;
  const minY = 2;
  const maxY = 22;
  const boltW = maxX - minX;
  const boltH = maxY - minY;

  const targetHeight = RENDER_SIZE * 0.58;
  const scale = targetHeight / boltH;
  const scaledW = boltW * scale;
  const scaledH = boltH * scale;

  const offsetX = (RENDER_SIZE - scaledW) / 2 - minX * scale;
  const offsetY = (RENDER_SIZE - scaledH) / 2 - minY * scale;

  return BOLT_POLYGON.map(([vx, vy]) => [offsetX + vx * scale, offsetY + vy * scale]);
}

function render() {
  const boltPoly = buildBoltTransform();
  const cornerRadius = RENDER_SIZE * 0.22;
  const buffer = Buffer.alloc(RENDER_SIZE * RENDER_SIZE * 4);

  for (let y = 0; y < RENDER_SIZE; y++) {
    for (let x = 0; x < RENDER_SIZE; x++) {
      const idx = (y * RENDER_SIZE + x) * 4;

      if (!insideRoundedRect(x, y, RENDER_SIZE, RENDER_SIZE, cornerRadius)) {
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0; // transparente fora do quadrado arredondado
        continue;
      }

      const t = (x + y) / (2 * RENDER_SIZE); // gradiente diagonal
      let r = Math.round(lerp(COLOR_BG_START[0], COLOR_BG_END[0], t));
      let g = Math.round(lerp(COLOR_BG_START[1], COLOR_BG_END[1], t));
      let b = Math.round(lerp(COLOR_BG_START[2], COLOR_BG_END[2], t));

      if (pointInPolygon(x + 0.5, y + 0.5, boltPoly)) {
        [r, g, b] = COLOR_BOLT;
      }

      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = 255;
    }
  }

  return buffer;
}

/** Reduz o buffer supersampleado (RENDER_SIZE²) para SIZE² fazendo média de blocos. */
function downsample(srcBuffer) {
  const dst = Buffer.alloc(SIZE * SIZE * 4);
  const factor = SUPERSAMPLE;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const sxCoord = x * factor + sx;
          const syCoord = y * factor + sy;
          const sIdx = (syCoord * RENDER_SIZE + sxCoord) * 4;
          r += srcBuffer[sIdx];
          g += srcBuffer[sIdx + 1];
          b += srcBuffer[sIdx + 2];
          a += srcBuffer[sIdx + 3];
        }
      }
      const count = factor * factor;
      const dIdx = (y * SIZE + x) * 4;
      dst[dIdx] = Math.round(r / count);
      dst[dIdx + 1] = Math.round(g / count);
      dst[dIdx + 2] = Math.round(b / count);
      dst[dIdx + 3] = Math.round(a / count);
    }
  }

  return dst;
}

// ---------------------------------------------------------------------
// Codificador PNG mínimo (assinatura + IHDR + IDAT + IEND, sem interlace,
// filtro "none" por linha, cor RGBA de 8 bits).
// ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(rgba, size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filtro "none"
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const rendered = render();
  const downsampled = downsample(rendered);
  const png = encodePNG(downsampled, SIZE);

  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'icon.png');
  fs.writeFileSync(outPath, png);

  console.log(`✅ Ícone gerado em ${outPath} (${SIZE}x${SIZE})`);
}

main();
