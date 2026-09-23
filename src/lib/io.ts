/**
 * 文本/JSON 导入导出、样例与随机代价生成
 */
import type { DecoderInput } from './types';
import { outputSymbol, nextState, type CodeSpec } from './code';

/** 解析八进制多项式文本：支持 "171"、"0o171"、"  75 "；失败返回 null */
export function parseOctal(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(?:0o)?([0-7]+)$/);
  if (!m) return null;
  const v = parseInt(m[1], 8);
  return Number.isFinite(v) ? v : null;
}

export function toOctal(v: number): string {
  return v.toString(8);
}

/**
 * 解析代价表文本：每行一个时刻，行内为各符号代价，逗号/空白分隔。
 * 返回 { rows, errors }；errors 为 {row, col, kind} 用于定位。
 */
export interface CellError {
  row: number; // 0 起
  col: number; // 0 起
  kind: 'not-integer' | 'out-of-range';
}

export function parseCostText(text: string): { rows: number[][]; cellErrors: CellError[]; raggedRows: number[] } {
  const lines = text.split(/\r?\n/);
  const rows: number[][] = [];
  const cellErrors: CellError[] = [];
  const raggedRows: number[] = [];
  lines.forEach((line, row) => {
    const t = line.trim();
    if (!t) return; // 空行跳过（不计入步数）
    const tokens = t.split(/[\s,;]+/).filter(Boolean);
    const vals: number[] = [];
    tokens.forEach((tok, col) => {
      if (!/^[+-]?\d+$/.test(tok)) {
        cellErrors.push({ row, col, kind: 'not-integer' });
        vals.push(NaN);
        return;
      }
      const v = Number(tok);
      if (v < 0 || v > 1_000_000) {
        cellErrors.push({ row, col, kind: 'out-of-range' });
      }
      vals.push(v);
    });
    rows.push(vals);
  });
  return { rows, cellErrors, raggedRows };
}

export function costsToText(costs: number[][]): string {
  return costs.map((row) => row.join(' ')).join('\n');
}

/** 导入 JSON（FileReader 读出的文本） */
export function importJson(text: string): DecoderInput {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON。');
  }
  if (typeof data !== 'object' || data === null) throw new Error('JSON 顶层必须是对象。');
  const obj = data as Record<string, unknown>;

  const memory = obj.memory;
  if (typeof memory !== 'number') throw new Error('缺少数值字段 memory。');

  if (!Array.isArray(obj.generators)) throw new Error('缺少数组字段 generators。');
  const generators = obj.generators.map((g, i) => {
    if (typeof g === 'number') return g; // 数值按十进制实际值
    if (typeof g === 'string') {
      const v = parseOctal(g); // 字符串按八进制（可带 0o 前缀）
      if (v === null) throw new Error(`第 ${i + 1} 个生成多项式 "${g}" 不是合法八进制数。`);
      return v;
    }
    throw new Error(`第 ${i + 1} 个生成多项式必须是数字或八进制字符串。`);
  });

  if (!Array.isArray(obj.costs)) throw new Error('缺少数组字段 costs。');
  const costs = obj.costs.map((row, t) => {
    if (!Array.isArray(row)) throw new Error(`第 ${t + 1} 步代价不是数组。`);
    return row.map((c, sym) => {
      if (typeof c !== 'number' || !Number.isInteger(c)) {
        throw new Error(`第 ${t + 1} 步符号 ${sym} 的代价必须是整数。`);
      }
      return c;
    });
  });

  return { memory, generators, costs };
}

/** 导出 JSON：生成多项式用八进制字符串明确表示 */
export function exportJson(input: DecoderInput): string {
  const payload = {
    memory: input.memory,
    generators: input.generators.map((g) => '0o' + g.toString(8)),
    costs: input.costs,
  };
  return JSON.stringify(payload, null, 2);
}

/** 简易确定性 PRNG */
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 构造一份典型样例：随机选一条闭合路径作为"发送"路径，
 * 真实符号代价为 0，其余符号给随机正代价（混入少量近似竞争），
 * 使译码结果可以人工复核。
 */
export function buildSample(memory = 2, L = 24, seed = 20260923): {
  input: DecoderInput;
  transmitted: { startState: number; bits: number[] };
} {
  const generators = memory >= 3 ? [0o13, 0o17] : [0o7, 0o5];
  const spec: CodeSpec = { memory, generators };
  const syms = 1 << generators.length;
  const rng = makeRng(seed);

  // 找一条随机闭合位串：随机选 L-memory 位，末 memory 位由回到 start=0 的条件决定
  // 简化：直接随机位串后，令起始状态 = 该位串自然演化的末态（尾咬合圆周）：
  // 从 0 出发跑 L 步得到末态 e，再以 e 为起始状态重跑——由于圆周移位寄存器性质，
  // 末态仍为 e（位序列相同、初态改为末态，等价于圆周序列）。
  const bits = Array.from({ length: L }, () => (rng() < 0.5 ? 0 : 1));
  let e = 0;
  for (const b of bits) e = nextState(memory, e, b as 0 | 1);
  const startState = e;

  const costs: number[][] = [];
  let q = startState;
  for (let t = 0; t < L; t++) {
    const word = (q << 1) | bits[t];
    const sent = outputSymbol(spec, word);
    const row: number[] = [];
    for (let s = 0; s < syms; s++) {
      if (s === sent) {
        row.push(0);
      } else {
        // 大部分符号代价较高，少量接近 0，制造可复核的竞争
        row.push(Math.floor(rng() * 40) + 18);
      }
    }
    costs.push(row);
    q = word & ((1 << memory) - 1);
  }
  if (q !== startState) throw new Error('样例构造失败：路径未闭合');
  return { input: { memory, generators, costs }, transmitted: { startState, bits } };
}

/** 为当前参数生成纯随机代价表 */
export function randomCosts(genCount: number, L: number, maxCost: number, seed: number): number[][] {
  const syms = 1 << genCount;
  const rng = makeRng(seed);
  return Array.from({ length: L }, () =>
    Array.from({ length: syms }, () => Math.floor(rng() * (maxCost + 1)))
  );
}
