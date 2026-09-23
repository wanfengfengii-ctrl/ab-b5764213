// 尾咬合卷积码（tail-biting convolutional code）精确译码核心。
//
// 约定：
//  - 记忆阶数 m：寄存器保存 m 个历史位；状态为 m 位整数。
//  - 状态转移：next = ((state << 1) | bit) & ((1 << m) - 1)
//  - 输出符号：编码时先拼出“未截断寄存器字” word = (state << 1) | bit)（m+1 位），
//    对每个生成多项式 g 取奇偶校验位 parity(word & g)。
//    第 i 个多项式对应符号二进制的第 (k-1-i) 位（第一个多项式在最左 / 最高位），
//    k 为多项式个数（2 或 3），故符号数为 4 或 8。
//  - 每一步对全部输出符号给出整数代价，精确最小化整条闭合路径的总代价。

export interface SolverInput {
  memory: number;
  polynomials: number[];
  costs: number[][]; // costs[step][symbol]
}

export interface StepDetail {
  t: number;
  bit: 0 | 1;
  prevState: number;
  word: number; // 未截断寄存器字 (prevState << 1) | bit
  nextState: number;
  symbol: number;
  parityBits: string; // 各多项式校验位，按多项式顺序
  stepCost: number;
  cumulative: number;
}

export interface DecodedPath {
  startState: number;
  bits: number[];
  totalCost: number;
  steps: StepDetail[];
}

export interface SolveResult {
  memory: number;
  polynomials: number[];
  numStates: number;
  numSymbols: number;
  length: number;
  optimal: DecodedPath;
  unique: boolean;
  alternate?: DecodedPath; // 并列最优时字典序最小的另一条完整见证
}

export function parity(x: number, poly: number): 0 | 1 {
  let v = x & poly;
  let b = 0;
  while (v) {
    b ^= v & 1;
    v >>>= 1;
  }
  return b as 0 | 1;
}

export function popcount(x: number): number {
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

export function toBin(x: number, width: number): string {
  return x.toString(2).padStart(width, '0');
}

export function symbolOf(word: number, polys: number[]): { symbol: number; bits: number[] } {
  let symbol = 0;
  const bits: number[] = [];
  for (let i = 0; i < polys.length; i++) {
    const p = parity(word, polys[i]);
    bits.push(p);
    symbol |= p << (polys.length - 1 - i);
  }
  return { symbol, bits };
}

interface RunSummary {
  s0: number;
  c0: number;
  w0: bigint;
  bits0: number[];
  c1: number; // -1 表示不存在第二条
  w1: bigint;
  bits1: number[];
}

/**
 * 精确求解：枚举初始状态（至多 64 个），对每个初始状态在篱笆图上做 Viterbi。
 * 为在“总代价相同”的路径之间稳定挑出输入位串字典序最小者，给边权附加
 *     lex = 输入位串按 b0 为最高位解释的整数（0 .. 2^L-1）
 * 组成扰动权 w = 真实代价 * 2^L + lex；比较 w 即先比代价、再比字典序。
 * 每个节点保留最优 / 次优两条不同路径（list-Viterbi），用于发现同一闭合
 * 端点上的并列见证。
 */
export function solveTailBiting(input: SolverInput): SolveResult {
  const m = input.memory;
  const polys = input.polynomials;
  const costs = input.costs;
  const L = costs.length;
  const S = 1 << m;
  const K = polys.length;
  const numSymbols = 1 << K;
  const mask = S - 1;

  // 转移表：每条 (状态, 输入位) 边对应的输出符号
  const symT = new Int32Array(S * 2);
  for (let s = 0; s < S; s++) {
    for (let b = 0; b < 2; b++) {
      const word = (s << 1) | b;
      symT[s * 2 + b] = symbolOf(word, polys).symbol;
    }
  }

  const Lb = BigInt(L);
  const stride = S * 2;
  const backP = new Int8Array((L + 1) * stride);
  const backR = new Int8Array((L + 1) * stride);

  let wPrev: (bigint | null)[] = new Array(stride).fill(null);
  let cPrev = new Int32Array(stride);

  const runs: RunSummary[] = [];
  const hi = 1 << (m - 1);

  for (let s0 = 0; s0 < S; s0++) {
    wPrev.fill(null);
    cPrev.fill(-1);
    wPrev[s0 * 2] = 0n;
    cPrev[s0 * 2] = 0;

    for (let t = 0; t < L; t++) {
      const wCur: (bigint | null)[] = new Array(stride).fill(null);
      const cCur = new Int32Array(stride);
      const lexBit = 1n << BigInt(L - 1 - t);

      for (let q = 0; q < S; q++) {
        const b: 0 | 1 = (q & 1) as 0 | 1;
        const pLo = q >> 1;

        // 保留到达 q 的两条最小扰动权路径
        let bw0: bigint | null = null;
        let bc0 = -1;
        let bp0 = 0;
        let br0 = 0;
        let bw1: bigint | null = null;
        let bc1 = -1;
        let bp1 = 0;
        let br1 = 0;

        const preds = [pLo, pLo | hi];
        for (const p of preds) {
          const stepSym = symT[p * 2 + b];
          const stepCost = costs[t][stepSym];
          const edgeW = (BigInt(stepCost) << Lb) | (b ? lexBit : 0n);

          for (let r = 0; r < 2; r++) {
            const pw = wPrev[p * 2 + r];
            if (pw === null) continue;
            const cw = pw + edgeW;
            const cc = cPrev[p * 2 + r] + stepCost;

            if (bw0 === null || cw < bw0) {
              bw1 = bw0; bc1 = bc0; bp1 = bp0; br1 = br0;
              bw0 = cw; bc0 = cc; bp0 = p; br0 = r;
            } else if (bw1 === null || cw < bw1) {
              bw1 = cw; bc1 = cc; bp1 = p; br1 = r;
            }
          }
        }

        const base = (t + 1) * stride + q * 2;
        if (bw0 !== null) {
          wCur[q * 2] = bw0;
          cCur[q * 2] = bc0;
          backP[base] = bp0;
          backR[base] = br0;
          if (bw1 !== null) {
            wCur[q * 2 + 1] = bw1;
            cCur[q * 2 + 1] = bc1;
            backP[base + 1] = bp1;
            backR[base + 1] = br1;
          }
        }
      }

      wPrev = wCur;
      cPrev = cCur;
    }

    const reconstruct = (rank: number): number[] => {
      const bits = new Array<number>(L);
      let q = s0;
      let r = rank;
      for (let t = L; t >= 1; t--) {
        const idx = t * stride + q * 2 + r;
        const p = backP[idx];
        const pr = backR[idx];
        bits[t - 1] = q & 1;
        q = p;
        r = pr;
      }
      if (q !== s0) throw new Error('内部错误：回溯起点与初始状态不一致');
      return bits;
    };

    const c0 = cPrev[s0 * 2];
    const w0 = wPrev[s0 * 2];
    if (w0 === null || c0 < 0) throw new Error('内部错误：不存在闭合路径');
    const c1in = cPrev[s0 * 2 + 1];
    const w1in = wPrev[s0 * 2 + 1];
    runs.push({
      s0,
      c0,
      w0,
      bits0: reconstruct(0),
      c1: w1in !== null && c1in >= 0 ? c1in : -1,
      w1: w1in ?? 0n,
      bits1: w1in !== null ? reconstruct(1) : [],
    });
  }

  // 全局主结果：所有闭合 (s0 -> s0) 路径中扰动权最小者
  let primary = runs[0];
  for (const r of runs) {
    if (r.w0 < primary.w0) primary = r;
  }
  const optimalCost = primary.c0;

  // 另一条见证候选：与最优真实代价相同、且与主结果不是同一条位串。
  // 扰动权严格随 (代价, 位串字典序) 单调，故直接取候选中 w 最小者即可。
  let altW: bigint | null = null;
  let altRun: RunSummary | null = null;
  let altRank: 0 | 1 = 0;
  for (const r of runs) {
    if (r.s0 === primary.s0) {
      if (r.c1 === optimalCost) {
        if (altW === null || r.w1 < altW) {
          altW = r.w1; altRun = r; altRank = 1;
        }
      }
    } else if (r.c0 === optimalCost) {
      if (altW === null || r.w0 < altW) {
        altW = r.w0; altRun = r; altRank = 0;
      }
    }
  }

  const buildPath = (s0: number, bits: number[], totalCost: number): DecodedPath => {
    let state = s0;
    let cumulative = 0;
    const steps: StepDetail[] = [];
    for (let t = 0; t < L; t++) {
      const bit = bits[t] as 0 | 1;
      const word = (state << 1) | bit;
      const nextState = word & mask;
      const { symbol, bits: pb } = symbolOf(word, polys);
      const stepCost = costs[t][symbol];
      cumulative += stepCost;
      if (bit !== 0 && bit !== 1) throw new Error('内部错误：非二元输入位');
      steps.push({
        t,
        bit,
        prevState: state,
        word,
        nextState,
        symbol,
        parityBits: pb.join(''),
        stepCost,
        cumulative,
      });
      state = nextState;
    }
    if (state !== s0) throw new Error('内部错误：路径未闭合');
    if (cumulative !== totalCost) throw new Error('内部错误：累计代价不一致');
    return { startState: s0, bits, totalCost, steps };
  };

  const result: SolveResult = {
    memory: m,
    polynomials: polys.slice(),
    numStates: S,
    numSymbols,
    length: L,
    optimal: buildPath(primary.s0, primary.bits0, primary.c0),
    unique: altW === null,
  };
  if (altRun && altW !== null) {
    const bits = altRank === 0 ? altRun.bits0 : altRun.bits1;
    const cost = altRank === 0 ? altRun.c0 : altRun.c1;
    result.alternate = buildPath(altRun.s0, bits, cost);
  }
  return result;
}
