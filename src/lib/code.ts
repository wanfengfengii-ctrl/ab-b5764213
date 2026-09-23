/**
 * 卷积码模型
 *
 * 寄存器布局（与题目一致）：
 *   移位寄存器宽度 = memory + 1 位，记 registerWord = ((state << 1) | bit)
 *   - state 为移入前低 memory 位（移位寄存器旧内容）
 *   - 新输入位 bit 进入最低位
 *   - next = ((state << 1) | bit) & ((1 << memory) - 1)
 *   - 第 j 个输出位 = popcount(generators[j] & registerWord) 的奇偶
 *   - 输出符号：第 j 个多项式对应输出位为从高到低第 j 位
 *     （sym = Σ bit_j · 2^(G-1-j)）
 */

export interface CodeSpec {
  memory: number;
  generators: number[];
}

/** 状态数 = 2^memory */
export function stateCount(memory: number): number {
  return 1 << memory;
}

/** 输出符号数 = 2^G */
export function symbolCount(generators: number[]): number {
  return 1 << generators.length;
}

/** 状态截断掩码 = 2^memory - 1 */
export function stateMask(memory: number): number {
  return (1 << memory) - 1;
}

/**
 * 输出符号。
 * @param word 未截断寄存器字（宽度 memory+1）
 */
export function outputSymbol(spec: CodeSpec, word: number): number {
  let sym = 0;
  const g = spec.generators;
  for (let j = 0; j < g.length; j++) {
    const odd = parity(g[j] & word);
    if (odd) {
      sym |= 1 << (g.length - 1 - j);
    }
  }
  return sym;
}

/** 单步状态转移（截断后） */
export function nextState(memory: number, state: number, bit: 0 | 1): number {
  return ((state << 1) | bit) & ((1 << memory) - 1);
}

/** 未截断寄存器字 */
export function registerWord(state: number, bit: 0 | 1): number {
  return ((state << 1) | bit) >>> 0;
}

/** 奇偶校验（1 的个数是否为奇数） */
export function parity(x: number): 0 | 1 {
  let v = x >>> 0;
  v ^= v >>> 16;
  v ^= v >>> 8;
  v ^= v >>> 4;
  v ^= v >>> 2;
  v ^= v >>> 1;
  return (v & 1) as 0 | 1;
}

/** 由起始状态和输入位串重建完整逐步轨迹（用于复核与展示） */
export function buildTrace(
  spec: CodeSpec,
  startState: number,
  bits: Array<0 | 1 | number>,
  costs: number[][]
): {
  prevState: number;
  nextState: number;
  registerWord: number;
  outputBits: number[];
  symbol: number;
  stepCost: number;
  cumCost: number;
}[] {
  let state = startState;
  let cum = 0;
  const trace = [];
  for (let t = 0; t < bits.length; t++) {
    const bit = bits[t] ? 1 : 0;
    const word = registerWord(state, bit);
    const outBits = spec.generators.map((gn) => parity(gn & word));
    const sym = outputSymbol(spec, word);
    const stepCost = costs[t][sym];
    cum += stepCost;
    const ns = nextState(spec.memory, state, bit as 0 | 1);
    trace.push({
      prevState: state,
      nextState: ns,
      registerWord: word,
      outputBits: outBits,
      symbol: sym,
      stepCost,
      cumCost: cum,
    });
    state = ns;
  }
  return trace;
}
