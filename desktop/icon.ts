// Icône de l'appli, dessinée en code (aucune image Riot) : un disque coupé en diagonale,
// bleu (assassin) et rouge (Rhaast), avec un anneau sombre. Encodeur PNG minimal (RGBA, zlib).
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre : aucun
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const BLUE = [91, 140, 255];
const RED = [224, 83, 93];
const RING = [24, 22, 34];

/** Icône carrée RGBA, avec anticrénelage par sur-échantillonnage 4×4. */
export function iconPng(size = 256): Buffer {
  const px = new Uint8Array(size * size * 4);
  const r = size / 2;
  const ring = size * 0.07;
  const gap = size * 0.035;
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, cr = 0, cg = 0, cb = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S - r, fy = y + (sy + 0.5) / S - r;
          const d = Math.hypot(fx, fy);
          if (d > r - 0.5) continue;
          let col: number[];
          if (d > r - ring) col = RING;
          else {
            const diag = (fx + fy) / Math.SQRT2; // distance signée à la diagonale ↗
            if (Math.abs(diag) < gap / 2) col = RING;
            else col = diag < 0 ? BLUE : RED;
          }
          a++; cr += col[0]; cg += col[1]; cb += col[2];
        }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = cr / a; px[i + 1] = cg / a; px[i + 2] = cb / a; px[i + 3] = Math.round((a / (S * S)) * 255); }
    }
  }
  return encodePng(size, size, px);
}
