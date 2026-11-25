// Icône de Full Clear, dessinée en code (aucune image Riot) : sur un carré arrondi sombre, un circuit vert presque
// fermé terminé par une flèche (le tour complet de la jungle) autour d'un point doré (l'objectif). Lisible aussi en
// 16 px dans la zone de notification. Encodeur PNG minimal (RGBA, zlib).
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

const BG = [24, 26, 36];
const GREEN = [79, 195, 138];
const GOLD = [231, 176, 75];

/** Point dans le triangle (a, b, c) ? */
function inTriangle(px: number, py: number, t: [number, number][]): boolean {
  const [[ax, ay], [bx, by], [cx, cy]] = t;
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Icône carrée RGBA, avec anticrénelage par sur-échantillonnage 4×4. */
export function iconPng(size = 256): Buffer {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const corner = size * 0.22;
  const R = size * 0.3, thick = size * 0.1;
  // Circuit : de 40° à 300° (sens horaire depuis le haut), flèche au bout.
  const START = (40 * Math.PI) / 180, END = (300 * Math.PI) / 180;
  const at = (ang: number, rad: number): [number, number] => [c + Math.sin(ang) * rad, c - Math.cos(ang) * rad];
  const tip = at(END + 0.42, R);
  const arrow: [number, number][] = [at(END, R - thick * 1.15), at(END, R + thick * 1.15), tip];
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, cr = 0, cg = 0, cb = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S, fy = y + (sy + 0.5) / S;
          // Carré arrondi.
          const qx = Math.max(Math.abs(fx - c) - (c - corner), 0), qy = Math.max(Math.abs(fy - c) - (c - corner), 0);
          if (Math.hypot(qx, qy) > corner) continue;
          let col = BG;
          const dx = fx - c, dy = fy - c, d = Math.hypot(dx, dy);
          let ang = Math.atan2(dx, -dy); if (ang < 0) ang += 2 * Math.PI;
          if (Math.abs(d - R) <= thick / 2 && ang >= START && ang <= END) col = GREEN;
          else if (inTriangle(fx, fy, arrow)) col = GREEN;
          else if (d <= size * 0.085) col = GOLD;
          a++; cr += col[0]; cg += col[1]; cb += col[2];
        }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = cr / a; px[i + 1] = cg / a; px[i + 2] = cb / a; px[i + 3] = Math.round((a / (S * S)) * 255); }
    }
  }
  return encodePng(size, size, px);
}
