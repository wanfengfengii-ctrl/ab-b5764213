/**
 * 尾咬合卷积码精确译码器
 *
 * 求解模型：
 *   在长度 L 的网格上找一条闭合路径（起始状态 s0 任意，末态必须等于 s0），
 *   精确最小化各步符号代价之和；主结果在并列最优中取输入位串字典序最小者，
 *   并判定最优是否唯一；若不唯一，给出字典序最小的另一条完整见证。
 *
 * 算法：
 *   1. 前向 Viterbi（对全部起始状态并行）：diag[s] = 从 s 出发、走 L 步回到 s 的最小代价。
 *      闭合路径总存在（例如状态 0 配全零输入位）。
 *   2. 最优总代价 B* = min_s diag[s]，候选起始状态集合 C = { s | diag[s] = B* }。
 *   3. 对每个候选 s 做后向 DP g[t][q]（从 (t,q) 到 (L,s) 的最小剩余代价），
 *      逐位贪心（优先 bit=0，用 g 做可行性判定）得到该 s 下字典序最小的 B* 位串；
 *      全局取最小即为主结果。
 *   4. 再对每个候选 s 做"必须与主位串至少有一位不同"的后向 DP（suf0），
 *      同样逐位贪心，构造不同于主结果的字典序最小并列串，即另一条见证；
 *      不存在则最优唯一。
 *
 * 数值范围：L ≤ 512、单代价 ≤ 10^6，总代价 ≤ 5.12×10^8，远低于 2^53，比较精确。
 */
import type { DecodeResult, DecodeWitness, DecoderInput, StepRecord } from './types';
import { buildTrace, type CodeSpec } from './code';

const INF = Number.MAX_SAFE_INTEGER;

/** 前向 Viterbi：返回每个起始状态 s 的闭合最小代价（不可行为 INF） */
function forwardClosedCosts(spec: CodeSpec, costs: number[][]): Float64Array {
  const m = spec.memory;
  const S = 1 << m;
  const mask = S - 1;
  const L = costs.length;
  const G = spec.generators.length;

  // dp[s][q]：所有起始状态并行；扁平为 S*S
  let prev = new Float64Array(S * S).fill(INF);
  let cur = new Float64Array(S * S);
  for (let s = 0; s < S; s++) prev[s * S + s] = 0;

  for (let t = 0; t < L; t++) {
    cur.fill(INF);
    const row = costs[t];
    for (let s = 0; s < S; s++) {
      const base = s * S;
      for (let q = 0; q < S; q++) {
        const v = prev[base + q];
        if (v === INF) continue;
        const shifted = q << 1;
        for (let b = 0; b <= 1; b++) {
          const word = shifted | b;
          const qn = word & mask;
          let sym = 0;
          for (let j = 0; j < G; j++) {
            if (parity(spec.generators[j] & word)) sym |= 1 << (G - 1 - j);
          }
          const nv = v + row[sym];
          const idx = base + qn;
          if (nv < cur[idx]) cur[idx] = nv;
        }
      }
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }

  const diag = new Float64Array(S);
  for (let s = 0; s < S; s++) diag[s] = prev[s * S + s];
  return diag;
}

/** 奇偶校验（1 的个数为奇数） */
function parity(x: number): 0 | 1 {
  let v = x >>> 0;
  v ^= v >>> 16;
  v ^= v >>> 8;
  v ^= v >>> 4;
  v ^= v >>> 2;
  v ^= v >>> 1;
  return (v & 1) as 0 | 1;
}

/** 后向 DP：g[t*S + q] = 从 (t,q) 到 (L,endState) 的最小剩余代价 */
function backwardDP(spec: CodeSpec, costs: number[][], endState: number): Float64Array {
  const m = spec.memory;
  const S = 1 << m;
  const mask = S - 1;
  const L = costs.length;
  const G = spec.generators.length;

  const g = new Float64Array((L + 1) * S).fill(INF);
  g[L * S + endState] = 0;

  for (let t = L - 1; t >= 0; t--) {
    const row = costs[t];
    const curBase = t * S;
    const nextBase = (t + 1) * S;
    for (let q = 0; q < S; q++) {
      const shifted = q << 1;
      let best = INF;
      for (let b = 0; b <= 1; b++) {
        const word = shifted | b;
        const qn = word & mask;
        const rest = g[nextBase + qn];
        if (rest === INF) continue;
        let sym = 0;
        for (let j = 0; j < G; j++) {
          if (parity(spec.generators[j] & word)) sym |= 1 << (G - 1 - j);
        }
        const v = row[sym] + rest;
        if (v < best) best = v;
      }
      g[curBase + q] = best;
    }
  }
  return g;
}

/**
 * 后向 DP（带"必须偏离主位串"约束）：
 * suf0[t*S + q] 仅对主路径在 t 时刻的在轨状态有意义，
 * 表示从此出发、到 (L,endState)、且后续至少有一位与主串不同的最小代价。
 */
function deviationDP(
  spec: CodeSpec,
  costs: number[][],
  endState: number,
  primaryBits: number[],
  g: Float64Array
): Float64Array {
  const m = spec.memory;
  const S = 1 << m;
  const mask = S - 1;
  const L = costs.length;
  const G = spec.generators.length;

  // 主路径的在轨状态轨迹 onPath[t]
  const onPath = new Int32Array(L + 1);
  onPath[0] = endState;
  for (let t = 0; t < L; t++) {
    onPath[t + 1] = ((onPath[t] << 1) | primaryBits[t]) & mask;
  }

  const suf = new Float64Array((L + 1) * S).fill(INF);
  // t = L：仍在轨即完全没偏离 => 不可行（INF）

  for (let t = L - 1; t >= 0; t--) {
    const q = onPath[t];
    const row = costs[t];
    const shifted = q << 1;
    const pb = primaryBits[t];
    let best = INF;
    for (let b = 0; b <= 1; b++) {
      const word = shifted | b;
      const qn = word & mask;
      let sym = 0;
      for (let j = 0; j < G; j++) {
        if (parity(spec.generators[j] & word)) sym |= 1 << (G - 1 - j);
      }
      // 选 b：若 b == 主串位则仍在轨，剩余必须由 suf 保证将来偏离；否则已偏离，剩余自由（g）
      const rest = b === pb ? suf[(t + 1) * S + qn] : g[(t + 1) * S + qn];
      if (rest === INF) continue;
      const v = row[sym] + rest;
      if (v < best) best = v;
    }
    suf[t * S + q] = best;
  }
  return suf;
}

/** 用后向代价逐位贪心：构造从 startState 回到 endState、总代价恰为 budget 的字典序最小位串 */
function greedyLexBits(
  spec: CodeSpec,
  costs: number[][],
  startState: number,
  endState: number,
  budget: number,
  g: Float64Array
): number[] | null {
  const m = spec.memory;
  const S = 1 << m;
  const mask = S - 1;
  const L = costs.length;
  const G = spec.generators.length;

  const bits: number[] = new Array(L);
  let q = startState;
  let spent = 0;
  for (let t = 0; t < L; t++) {
    const shifted = q << 1;
    let chosen: number | null = null;
    for (let b = 0; b <= 1; b++) {
      const word = shifted | b;
      const qn = word & mask;
      let sym = 0;
      for (let j = 0; j < G; j++) {
        if (parity(spec.generators[j] & word)) sym |= 1 << (G - 1 - j);
      }
      const rest = g[(t + 1) * S + qn];
      if (rest !== INF && spent + costs[t][sym] + rest === budget) {
        chosen = b;
        break; // b=0 优先
      }
    }
    if (chosen === null) return null;
    bits[t] = chosen;
    q = ((shifted | chosen) & mask) >>> 0;
    spent += costs[t][symOf(spec, shifted | chosen)];
  }
  if (q !== endState || spent !== budget) return null;
  return bits;
}

/** 用 g 与 suf 贪心：构造总代价恰为 budget、且与主串至少一位不同的字典序最小位串 */
function greedyDistinctBits(
  spec: CodeSpec,
  costs: number[][],
  startState: number,
  endState: number,
  budget: number,
  primaryBits: number[],
  g: Float64Array,
  suf: Float64Array
): number[] | null {
  const m = spec.memory;
  const S = 1 << m;
  const mask = S - 1;
  const L = costs.length;

  const bits: number[] = new Array(L);
  let q = startState;
  let spent = 0;
  let deviated = false;
  for (let t = 0; t < L; t++) {
    const shifted = q << 1;
    let chosen: number | null = null;
    for (let b = 0; b <= 1; b++) {
      const word = shifted | b;
      const qn = word & mask;
      const nd = deviated || b !== primaryBits[t];
      // 偏离后剩余只需 g；仍在轨则剩余必须由 suf 保证将来偏离
      const rest = nd ? g[(t + 1) * S + qn] : suf[(t + 1) * S + qn];
      if (rest !== INF && spent + costs[t][symOf(spec, word)] + rest === budget) {
        chosen = b;
        break;
      }
    }
    if (chosen === null) return null;
    bits[t] = chosen;
    q = ((shifted | chosen) & mask) >>> 0;
    spent += costs[t][symOf(spec, shifted | chosen)];
    if (chosen !== primaryBits[t]) deviated = true;
  }
  if (!deviated || q !== endState || spent !== budget) return null;
  return bits;
}

function symOf(spec: CodeSpec, word: number): number {
  const G = spec.generators.length;
  let sym = 0;
  for (let j = 0; j < G; j++) {
    if (parity(spec.generators[j] & word)) sym |= 1 << (G - 1 - j);
  }
  return sym;
}

function bitsLexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

function bitsEqual(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function makeWitness(
  spec: CodeSpec,
  costs: number[][],
  startState: number,
  bits: number[],
  totalCost: number
): DecodeWitness {
  const raw = buildTrace(spec, startState, bits, costs);
  const trace: StepRecord[] = raw.map((r, t) => ({
    t,
    bit: bits[t] as 0 | 1,
    prevState: r.prevState,
    nextState: r.nextState,
    registerWord: r.registerWord,
    outputBits: r.outputBits,
    symbol: r.symbol,
    stepCost: r.stepCost,
    cumCost: r.cumCost,
  }));
  // 防御性自检：首尾闭合且总代价一致
  const last = trace[trace.length - 1];
  if (last.nextState !== startState) {
    throw new Error(`内部错误：路径未闭合（${startState} -> ${last.nextState}）`);
  }
  if (last.cumCost !== totalCost) {
    throw new Error(`内部错误：总代价不一致（${last.cumCost} != ${totalCost}）`);
  }
  return { startState, bits, trace, totalCost };
}

/** 主入口：对一份已通过校验的输入执行精确译码 */
export function decode(input: DecoderInput): DecodeResult {
  const spec: CodeSpec = { memory: input.memory, generators: input.generators };
  const costs = input.costs;
  const S = 1 << spec.memory;
  const L = costs.length;

  // 1. 各起始状态的闭合最小代价
  const diag = forwardClosedCosts(spec, costs);

  // 2. 最优总代价与候选起始状态
  let best = INF;
  for (let s = 0; s < S; s++) if (diag[s] < best) best = diag[s];
  if (best === INF) throw new Error('内部错误：不存在闭合路径');
  const candidates: number[] = [];
  for (let s = 0; s < S; s++) if (diag[s] === best) candidates.push(s);

  // 3. 每个候选起始状态下字典序最小的最优位串
  let primaryBits: number[] | null = null;
  let primaryStart = -1;
  const perCandidate: { s: number; g: Float64Array; bits: number[] }[] = [];
  for (const s of candidates) {
    const g = backwardDP(spec, costs, s);
    const bits = greedyLexBits(spec, costs, s, s, best, g);
    if (!bits) throw new Error('内部错误：后向贪心失败');
    perCandidate.push({ s, g, bits });
    if (primaryBits === null || bitsLexLess(bits, primaryBits)) {
      primaryBits = bits;
      primaryStart = s;
    }
  }
  if (!primaryBits) throw new Error('内部错误：主结果缺失');
  const pBits: number[] = primaryBits;

  // 4. 寻找不同于主位串的字典序最小并列串（允许任意闭合起始状态）
  let altBits: number[] | null = null;
  let altStart = -1;
  for (const { s, g } of perCandidate) {
    const suf = deviationDP(spec, costs, s, pBits, g);
    // 仅当起始就在轨（s === 主串初态）时由 suf 约束；其他起始状态首步必然偏离，
    // 仍可统一使用 greedyDistinctBits（其在 t=0 在轨判断：q 与主轨迹 t=0 状态不同时，
    // b 与 primaryBits[0] 的比较无意义）。为语义清晰，分两种情形：
    let bits: number[] | null;
    if (s === primaryStart) {
      bits = greedyDistinctBits(spec, costs, s, s, best, pBits, g, suf);
    } else {
      // 起始状态不同 => 整条路径天然不同于主串；首步起即视为已偏离
      bits = greedyFromDifferentStart(spec, costs, s, best, pBits, g);
    }
    if (bits && (altBits === null || bitsLexLess(bits, altBits))) {
      altBits = bits;
      altStart = s;
    }
  }

  const primary = makeWitness(spec, costs, primaryStart, pBits, best);
  const alternate =
    altBits !== null && !bitsEqual(altBits, pBits)
      ? makeWitness(spec, costs, altStart, altBits, best)
      : null;

  return {
    memory: spec.memory,
    generators: spec.generators,
    symbolCount: 1 << spec.generators.length,
    stepCount: L,
    primary,
    closedCosts: Array.from(diag),
    alternate,
    unique: alternate === null,
  };
}

/**
 * 起始状态与主串不同时的字典序贪心：每一步都视为"已偏离"，
 * 用 g 判定可行性即可（闭合约束 endState = s 已编码在 g 中）。
 */
function greedyFromDifferentStart(
  spec: CodeSpec,
  costs: number[][],
  s: number,
  budget: number,
  _primaryBits: number[],
  g: Float64Array
): number[] | null {
  return greedyLexBits(spec, costs, s, s, budget, g);
}
