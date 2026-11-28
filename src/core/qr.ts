/**
 * A small QR Code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1–10, which holds up to
 * 213 bytes. Enough for a phone inbox address; the full standard is out of scope.
 */

/** Level M per version 1–10: EC codewords per block, then [block count, data codewords per block] groups. */
const LAYOUT: readonly (readonly [number, ...(readonly [number, number])[]])[] = [
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];

/** Alignment pattern centres for versions 2–10 (version 1 has none). */
const ALIGNMENT: readonly (readonly number[])[] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const MAX_VERSION = 10;
const LEVEL_M_BITS = 0b00;

/** Modules of a QR code (true = dark), quiet zone not included; undefined when the text needs more than version 10. */
export function qrMatrix(text: string, mask?: number): boolean[][] | undefined {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length);
  if (!version) return undefined;
  const codewords = interleave(dataCodewords(bytes, version), version);
  const base = new Grid(version);
  base.drawFunctionPatterns();
  base.placeCodewords(codewords);
  const masks = mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
  let best: Grid | undefined;
  let bestScore = Infinity;
  for (const candidate of masks) {
    const grid = base.copy();
    grid.applyMask(candidate);
    // Format and version bits go in before scoring; the reference scores the finished symbol.
    grid.drawFormatBits(candidate);
    const score = grid.penalty();
    // Strictly lower keeps the lower mask number on a tie.
    if (score < bestScore) { best = grid; bestScore = score; }
  }
  return best!.modules;
}

function dataCapacity(version: number): number {
  const [, ...groups] = LAYOUT[version - 1]!;
  return groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

function pickVersion(length: number): number | undefined {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + 8 * length <= dataCapacity(version) * 8) return version;
  }
  return undefined;
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCapacity(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  for (let pad = 0xec; words.length < capacity / 8; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

/** Split into blocks, add Reed–Solomon codewords, and interleave data then error correction. */
function interleave(data: number[], version: number): number[] {
  const [ecLength, ...groups] = LAYOUT[version - 1]!;
  const divisor = rsDivisor(ecLength);
  const blocks: number[][] = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) { blocks.push(data.slice(offset, offset + size)); offset += size; }
  }
  const ec = blocks.map((block) => rsRemainder(block, divisor));
  const result: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.length));
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.length) result.push(block[i]!);
  for (let i = 0; i < ecLength; i += 1) for (const block of ec) result.push(block[i]!);
  return result;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Generator polynomial coefficients for `degree` EC codewords, highest power first (leading 1 omitted). */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => { result[i] ^= gfMultiply(coefficient, factor); });
  }
  return result;
}

class Grid {
  readonly size: number;
  modules: boolean[][];
  reserved: boolean[][];

  constructor(readonly version: number, modules?: boolean[][], reserved?: boolean[][]) {
    this.size = 17 + 4 * version;
    this.modules = modules ?? Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = reserved ?? Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  copy(): Grid {
    return new Grid(this.version, this.modules.map((row) => [...row]), this.reserved);
  }

  private set(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.reserved[y]![x] = true;
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i += 1) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const centres = ALIGNMENT[this.version - 1]!;
    const last = centres.length - 1;
    centres.forEach((x, i) => centres.forEach((y, j) => {
      // Skip the three corners that hold finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      this.drawAlignment(x, y);
    }));
    // Reserve format and version areas with placeholder bits; drawFormatBits() writes the real ones.
    this.drawFormatBits(0);
    this.drawVersionBits();
  }

  private drawFinder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      this.set(x, y, distance !== 2 && distance !== 4);
    }
  }

  private drawAlignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormatBits(mask: number): void {
    const data = (LEVEL_M_BITS << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true);
  }

  private drawVersionBits(): void {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  /** The standard zigzag: column pairs from the right, skipping the vertical timing column. */
  placeCodewords(codewords: readonly number[]): void {
    let index = 0;
    const total = codewords.length * 8;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (this.reserved[y]![x] || index >= total) continue;
          this.modules[y]![x] = ((codewords[index >>> 3]! >>> (7 - (index & 7))) & 1) !== 0;
          index += 1;
        }
      }
    }
  }

  applyMask(mask: number): void {
    const flip = [
      (x: number, y: number) => (x + y) % 2 === 0,
      (_x: number, y: number) => y % 2 === 0,
      (x: number) => x % 3 === 0,
      (x: number, y: number) => (x + y) % 3 === 0,
      (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ][mask]!;
    for (let y = 0; y < this.size; y += 1) for (let x = 0; x < this.size; x += 1) {
      if (!this.reserved[y]![x] && flip(x, y)) this.modules[y]![x] = !this.modules[y]![x];
    }
  }

  /** The four penalty rules, scored on rows and columns the way the reference does. */
  penalty(): number {
    const n = this.size;
    let score = 0;
    const line = (get: (i: number) => boolean) => {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      const addHistory = (length: number) => {
        if (history[0] === 0) length += n;
        history.pop();
        history.unshift(length);
      };
      const countPatterns = () => {
        const m = history[1]!;
        const core = m > 0 && history[2] === m && history[3] === m * 3 && history[4] === m && history[5] === m;
        return (core && history[0]! >= m * 4 && history[6]! >= m ? 1 : 0) + (core && history[6]! >= m * 4 && history[0]! >= m ? 1 : 0);
      };
      for (let i = 0; i < n; i += 1) {
        if (get(i) === runColor) {
          runLength += 1;
          if (runLength === 5) score += 3;
          else if (runLength > 5) score += 1;
        } else {
          addHistory(runLength);
          if (!runColor) score += countPatterns() * 40;
          runColor = get(i);
          runLength = 1;
        }
      }
      // Close the run against the light quiet zone.
      if (runColor) { addHistory(runLength); runLength = 0; }
      runLength += n;
      addHistory(runLength);
      score += countPatterns() * 40;
    };
    for (let y = 0; y < n; y += 1) line((x) => this.modules[y]![x]!);
    for (let x = 0; x < n; x += 1) line((y) => this.modules[y]![x]!);
    for (let y = 0; y < n - 1; y += 1) for (let x = 0; x < n - 1; x += 1) {
      const color = this.modules[y]![x];
      if (color === this.modules[y]![x + 1] && color === this.modules[y + 1]![x] && color === this.modules[y + 1]![x + 1]) score += 3;
    }
    const dark = this.modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return score + k * 10;
  }
}
