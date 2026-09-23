/**
 * 译码器测试：用小规模暴力枚举作为独立参考实现交叉验证
 */
import { describe, it, expect } from 'vitest';
import { decode } from './decoder';
import { outputSymbol, buildTrace, nextState, parity, type CodeSpec } from './code';
import type { DecoderInput } from './types';

/** 简单确定性 PRNG（不依赖随机种子环境） */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeCosts(rng: () => number, L: number, syms: number, maxCost = 20): number[][] {
  const costs: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let s = 0; s < syms; s++) row.push(Math.floor(rng() * (maxCost + 1)));
    costs.push(row);
  }
  return costs;
}

/** 暴力枚举全部 2^L 条位串，返回所有闭合路径（按位串字典序） */
function bruteForce(spec: CodeSpec, costs: number[][]) {
  const L = costs.length;
  const mask = (1 << spec.memory) - 1;
  const found: { start: number; bits: number[]; cost: number }[] = [];
  const total = 1 << L;
  for (let x = 0; x < total; x++) {
    const bits: number[] = [];
    for (let i = 0; i < L; i++) bits.push((x >> (L - 1 - i)) & 1); // x 的高位 = bit[0]，x 递增即字典序
    for (let start = 0; start <= mask; start++) {
      let q = start;
      let cost = 0;
      for (let t = 0; t < L; t++) {
        const word = (q << 1) | bits[t];
        cost += costs[t][outputSymbol(spec, word)];
        q = word & mask;
      }
      if (q === start) found.push({ start, bits: [...bits], cost });
    }
  }
  found.sort((a, b) => {
    for (let i = 0; i < L; i++) if (a.bits[i] !== b.bits[i]) return a.bits[i] - b.bits[i];
    return a.start - b.start;
  });
  return found;
}

function runCrossCheck(memory: number, gens: number[], L: number, seed: number, maxCost = 20) {
  const rng = makeRng(seed);
  const costs = makeCosts(rng, L, 1 << gens.length, maxCost);
  const input: DecoderInput = { memory, generators: gens, costs };
  const spec: CodeSpec = { memory, generators: gens };

  const result = decode(input);
  const all = bruteForce(spec, costs);
  const best = Math.min(...all.map((p) => p.cost));
  const optimal = all.filter((p) => p.cost === best);

  expect(result.primary.totalCost).toBe(best);
  expect(result.primary.bits).toEqual(optimal[0].bits);
  expect(result.primary.startState).toBe(optimal[0].start);
  expect(result.unique).toBe(optimal.length === 1);
  if (optimal.length >= 2) {
    expect(result.alternate).not.toBeNull();
    expect(result.alternate!.bits).toEqual(optimal[1].bits);
    expect(result.alternate!.startState).toBe(optimal[1].start);
    expect(result.alternate!.totalCost).toBe(best);
    // 两条见证必须不同
    expect(result.alternate!.bits.some((b, i) => b !== result.primary.bits[i])).toBe(true);
  } else {
    expect(result.alternate).toBeNull();
  }

  // 轨迹一致性：闭合、代价、转移、输出逐行核对
  for (const w of [result.primary, result.alternate].filter(Boolean) as typeof result.primary[]) {
    expect(w.trace).toHaveLength(L);
    w.trace.forEach((r, t) => {
      expect(r.t).toBe(t);
      expect(r.bit).toBe(w.bits[t]);
      expect(r.registerWord).toBe(((r.prevState << 1) | r.bit) >>> 0);
      expect(r.nextState).toBe(nextState(memory, r.prevState, r.bit as 0 | 1));
      const expectBits = gens.map((g) => parity(g & r.registerWord));
      expect(r.outputBits).toEqual(expectBits);
      let sym = 0;
      gens.forEach((g, j) => {
        if (parity(g & r.registerWord)) sym |= 1 << (gens.length - 1 - j);
      });
      expect(r.symbol).toBe(sym);
      expect(r.stepCost).toBe(costs[t][sym]);
    });
    // 累计代价
    let cum = 0;
    w.trace.forEach((r) => {
      cum += r.stepCost;
      expect(r.cumCost).toBe(cum);
    });
    expect(w.totalCost).toBe(cum);
    // 首尾闭合
    expect(w.trace[L - 1].nextState).toBe(w.startState);
    expect(w.trace[0].prevState).toBe(w.startState);
  }
}

describe('编码器模型', () => {
  it('(7,5) 码从 0 态全零输入恒输出 00', () => {
    const spec: CodeSpec = { memory: 2, generators: [0o7, 0o5] };
    let s = 0;
    for (let t = 0; t < 8; t++) {
      const word = (s << 1) | 0;
      expect(outputSymbol(spec, word)).toBe(0);
      s = nextState(2, s, 0);
    }
  });

  it('(7,5) 码经典序列 1101100... 输出核对', () => {
    // 起始状态 0，输入 1,1,0,1,1,0,0,0（尾咬合闭合到 0）
    const spec: CodeSpec = { memory: 2, generators: [0o7, 0o5] };
    const bits = [1, 1, 0, 1, 1, 0, 0, 0];
    const zeroCosts = bits.map(() => [0, 0, 0, 0]);
    const trace = buildTrace(spec, 0, bits, zeroCosts);
    // 手算：word 依次为 001,011,110,101,011,110,100,000
    // word=001: 7&1=1->1, 5&1=1->1 => 11(3)
    // word=011: 7&3=3->0, 5&3=1->1 => 01(1)
    // word=110(6): 7&6=6->0, 5&6=4->1 => 01(1)
    // word=101(5): 7&5=5->0, 5&5=5->0 => 00(0)
    // word=011 => 01(1); word=110 => 01(1); word=100(4): 7&4=4->1,5&4=4->1 => 11(3); 000 => 00
    expect(trace.map((r) => r.symbol)).toEqual([3, 1, 1, 0, 1, 1, 3, 0]);
    expect(trace[trace.length - 1].nextState).toBe(0);
  });
});

describe('译码器 —— 与暴力枚举交叉验证', () => {
  const cases: [number, number[], number, number][] = [
    [1, [0o3, 0o1], 8, 1],
    [1, [0o2, 0o3], 9, 2],
    [2, [0o7, 0o5], 8, 3],
    [2, [0o7, 0o5], 10, 4],
    [2, [0o6, 0o5], 8, 5],
    [2, [0o7, 0o5, 0o3], 8, 6], // 3 个生成多项式 => 8 个符号
    [3, [0o13, 0o17], 8, 7],
    [3, [0o15, 0o13, 0o11], 9, 8],
    [4, [0o23, 0o31], 8, 9],
  ];
  for (const [memory, gens, L, seed] of cases) {
    it(`memory=${memory} gens=[${gens.map((g) => g.toString(8)).join(',')}] L=${L} seed=${seed}`, () => {
      runCrossCheck(memory, gens, L, seed);
    });
  }

  it('多轮随机代价均与暴力结果一致（含并列判定）', () => {
    for (let seed = 100; seed < 140; seed++) {
      runCrossCheck(2, [0o7, 0o5], 8, seed, seed % 3 === 0 ? 2 : 8);
    }
  });

  it('memory=1 / 3、3 个多项式、L=9~10 多参数组合交叉验证', () => {
    let seed = 1000;
    const combos: [number, number[], number][] = [
      [1, [0o3, 0o2], 10],
      [1, [0o3, 0o2, 0o1], 9],
      [3, [0o13, 0o17], 9],
      [3, [0o15, 0o13, 0o11], 9],
      [2, [0o7, 0o5, 0o3], 10],
      [4, [0o31, 0o27], 8],
    ];
    for (const [m, g, L] of combos) {
      for (let k = 0; k < 8; k++) {
        runCrossCheck(m, g, L, seed++, k % 4 === 0 ? 1 : 12);
      }
    }
  });

  it('全零代价：所有闭合路径并列，主结果为字典序最小闭合串，次优为第二小', () => {
    const spec: CodeSpec = { memory: 2, generators: [0o7, 0o5] };
    const L = 8;
    const costs = Array.from({ length: L }, () => [0, 0, 0, 0]);
    const result = decode({ memory: 2, generators: [0o7, 0o5], costs });
    const all = bruteForce(spec, costs);
    expect(result.primary.totalCost).toBe(0);
    expect(result.primary.bits).toEqual(all[0].bits);
    expect(result.unique).toBe(false);
    expect(result.alternate!.bits).toEqual(all[1].bits);
  });

  it('memory=1 全零代价：闭合要求偶数个 1，字典序主结果为全 0，次优为单个 1 置于最后', () => {
    const L = 8;
    const costs = Array.from({ length: L }, () => [0, 0, 0, 0]);
    const result = decode({ memory: 1, generators: [0o3, 0o2], costs });
    expect(result.primary.bits).toEqual(new Array(L).fill(0));
    expect(result.primary.startState).toBe(0);
    // 字典序最小的含单 1 闭合串：1 在最后一位（起始 0，末态需回 0）
    const expected = new Array(L).fill(0);
    expected[L - 1] = 1;
    expect(result.alternate!.bits).toEqual(expected);
  });
});

describe('译码器 —— 边界与性能', () => {
  it('memory=6、L=512、最大代价上限可快速完成且轨迹闭合', () => {
    const rng = makeRng(42);
    const L = 512;
    const costs = makeCosts(rng, L, 4, 1_000_000);
    const t0 = Date.now();
    const result = decode({ memory: 6, generators: [0o171, 0o133], costs });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(result.primary.trace).toHaveLength(L);
    expect(result.primary.trace[L - 1].nextState).toBe(result.primary.startState);
    expect(result.primary.totalCost).toBeGreaterThan(0);
    expect(result.primary.totalCost).toBeLessThanOrEqual(L * 1_000_000);
  });

  it('L=8 最小步数', () => {
    const rng = makeRng(7);
    const costs = makeCosts(rng, 8, 8, 10);
    const result = decode({ memory: 1, generators: [0o3, 0o2, 0o1], costs });
    expect(result.stepCount).toBe(8);
    expect(result.symbolCount).toBe(8);
  });

  it('三多项式 memory=6 宽度边界（171 / 133 / 165 均 ≤ 177）', () => {
    const rng = makeRng(99);
    const costs = makeCosts(rng, 8, 8, 5);
    const result = decode({ memory: 6, generators: [0o171, 0o133, 0o165], costs });
    expect(result.primary.trace[7].nextState).toBe(result.primary.startState);
  });
});
