import { describe, it, expect } from 'vitest';
import { solveTailBiting, parity, symbolOf, type SolverInput } from './codec';
import {
  validateRaw,
  parseCostsText,
  parsePolynomial,
  parseImportedJson,
  MIN_STEPS,
  MAX_COST,
} from './validation';

// 朴素暴力参考实现：枚举全部位串，筛选闭合路径，直接统计最优与并列。
function bruteForce(input: SolverInput) {
  const { memory: m, polynomials: polys, costs } = input;
  const L = costs.length;
  const mask = (1 << m) - 1;
  const closed: { bits: string; cost: number }[] = [];
  for (let n = 0; n < 1 << L; n++) {
    const bits = n.toString(2).padStart(L, '0');
    let state = n & ((1 << m) - 1); // 尾咬：初态 = 末态 = 末 m 位
    let cost = 0;
    let end = state;
    for (let t = 0; t < L; t++) {
      const bit = Number(bits[t]);
      const word = (state << 1) | bit;
      state = word & mask;
      cost += costs[t][symbolOf(word, polys).symbol];
      end = state;
    }
    if (end === (n & ((1 << m) - 1))) closed.push({ bits, cost });
  }
  closed.sort((a, b) => a.cost - b.cost || (a.bits < b.bits ? -1 : 1));
  const best = closed[0];
  const alts = closed.filter((c) => c.cost === best.cost && c.bits !== best.bits);
  return { best, alternate: alts[0], total: closed.length };
}

function randomInput(seed: number, m: number, k: 2 | 3, L: number): SolverInput {
  let s = seed >>> 0;
  const rnd = () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
  const widthMax = (1 << (m + 1)) - 1;
  const polys: number[] = [];
  while (polys.length < k) {
    const v = 1 + Math.floor(rnd() * widthMax);
    if (!polys.includes(v)) polys.push(v);
  }
  const ns = 1 << k;
  const costs: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    // 偏向小代价，更容易制造并列
    for (let sy = 0; sy < ns; sy++) row.push(Math.floor(rnd() * rnd() * 5));
    costs.push(row);
  }
  return { memory: m, polynomials: polys, costs };
}

describe('codec 基本编码规则', () => {
  it('parity 为奇偶校验', () => {
    expect(parity(0b1011, 0b1111)).toBe(1);
    expect(parity(0b1001, 0b1111)).toBe(0);
    expect(parity(0b101, 0b101)).toBe(0);
  });

  it('经典 (7,1/2) 多项式 0o171/0o133 的首步输出正确', () => {
    // m=2, 初态 0，输入 1：word=0b001
    const { symbol, bits } = symbolOf(0b001, [0o171, 0o133]);
    expect(bits).toEqual([1, 1]);
    expect(symbol).toBe(0b11);
    // 输入 0：word=0b000
    expect(symbolOf(0, [0o171, 0o133]).symbol).toBe(0);
  });
});

describe('solveTailBiting 与暴力枚举一致', () => {
  const cases: { m: number; k: 2 | 3; L: number }[] = [
    { m: 1, k: 2, L: 8 },
    { m: 1, k: 3, L: 9 },
    { m: 2, k: 2, L: 10 },
    { m: 2, k: 3, L: 11 },
    { m: 3, k: 2, L: 12 },
    { m: 3, k: 3, L: 10 },
    { m: 4, k: 2, L: 13 },
  ];

  for (const c of cases) {
    for (let seed = 1; seed <= 6; seed++) {
      it(`m=${c.m} k=${c.k} L=${c.L} seed=${seed}`, () => {
        const input = randomInput(seed * 7919 + c.m * 131 + c.L, c.m, c.k, c.L);
        const ref = bruteForce(input);
        const res = solveTailBiting(input);
        expect(res.optimal.totalCost).toBe(ref.best.cost);
        expect(res.optimal.bits.join('')).toBe(ref.best.bits);
        expect(res.optimal.startState).toBe(parseInt(ref.best.bits.slice(c.L - c.m), 2));
        expect(res.unique).toBe(ref.alternate === undefined);
        if (ref.alternate) {
          expect(res.alternate).toBeDefined();
          expect(res.alternate!.totalCost).toBe(ref.best.cost);
          expect(res.alternate!.bits.join('')).toBe(ref.alternate.bits);
          expect(res.alternate!.bits.join('')).not.toBe(ref.best.bits);
        } else {
          expect(res.alternate).toBeUndefined();
        }
        // 时间轴明细一致性
        let acc = 0;
        let st = res.optimal.startState;
        for (const d of res.optimal.steps) {
          expect(d.prevState).toBe(st);
          expect(d.word).toBe((st << 1) | d.bit);
          expect(d.nextState).toBe(((st << 1) | d.bit) & ((1 << c.m) - 1));
          acc += d.stepCost;
          expect(d.cumulative).toBe(acc);
          st = d.nextState;
        }
        expect(st).toBe(res.optimal.startState);
      });
    }
  }

  it('全零代价：主结果为全零串，且不唯一，见证为字典序次小闭合串', () => {
    const m = 2;
    const L = 8;
    const input: SolverInput = {
      memory: m,
      polynomials: [0o7, 0o5],
      costs: Array.from({ length: L }, () => [0, 0, 0, 0]),
    };
    const ref = bruteForce(input);
    const res = solveTailBiting(input);
    expect(res.optimal.totalCost).toBe(0);
    expect(res.optimal.bits.join('')).toBe(ref.best.bits);
    expect(res.optimal.bits.join('')).toBe('00000000');
    expect(res.unique).toBe(false);
    expect(res.alternate!.bits.join('')).toBe(ref.alternate!.bits);
    // 尾咬下任意位串以末 m 位为初态均闭合，字典序次小即 00000001
    expect(res.alternate!.bits.join('')).toBe('00000001');
  });

  it('只有一条闭合路径达到最优（构造唯一情形）', () => {
    // 随机搜索一个唯一解配置并复核
    for (let seed = 100; seed < 400; seed++) {
      const input = randomInput(seed, 2, 2, 9);
      const ref = bruteForce(input);
      if (ref.alternate === undefined) {
        const res = solveTailBiting(input);
        expect(res.unique).toBe(true);
        expect(res.alternate).toBeUndefined();
        expect(res.optimal.bits.join('')).toBe(ref.best.bits);
        return;
      }
    }
    throw new Error('测试自身失败：未随机构造到唯一解');
  });

  it('支持最大步数 512 与 m=6 的规模且结果闭合', () => {
    const m = 6;
    const L = 512;
    const costs: number[][] = [];
    let s = 42 >>> 0;
    for (let t = 0; t < L; t++) {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      costs.push([0, 1, 2, 3].map((b) => ((s >>> (b * 4)) & 0xf)));
    }
    const input: SolverInput = { memory: m, polynomials: [0o133, 0o171], costs };
    const res = solveTailBiting(input);
    expect(res.length).toBe(L);
    const last = res.optimal.steps[L - 1];
    expect(last.nextState).toBe(res.optimal.startState);
    expect(last.cumulative).toBe(res.optimal.totalCost);
  });
});

describe('多项式解析', () => {
  it('支持八进制（默认与 0o）、二进制、十六进制', () => {
    expect(parsePolynomial('133').value).toBe(0o133);
    expect(parsePolynomial('0o171').value).toBe(0o171);
    expect(parsePolynomial('0b1011011').value).toBe(0b1011011);
    expect(parsePolynomial('0x5b').value).toBe(0x5b);
    expect(parsePolynomial('19').error).toBeTruthy();
    expect(parsePolynomial('').error).toBeTruthy();
  });
});

describe('validateRaw 错误定位', () => {
  const goodCosts = (rows: number, cols: number, v = 0) =>
    Array.from({ length: rows }, () => Array.from({ length: cols }, () => v).join(' ')).join('\n');

  it('合法配置通过', () => {
    const r = validateRaw({
      memoryText: '2',
      polynomialsText: '5 7',
      costsText: goodCosts(8, 4),
    });
    expect(r.issues).toHaveLength(0);
    expect(r.config!.polynomials).toEqual([0o5, 0o7]);
  });

  it('一次性报告全部错误并定位行列', () => {
    // 阶数 9 非法；多项式 0 非法、9 非八进制数字
    const r = validateRaw({
      memoryText: '9',
      polynomialsText: '0 9',
      costsText: `0 0 0 0\nx 1 2 3\n1 2 3\n${goodCosts(7, 4)}`,
    });
    const msgs = r.issues.map((i) => i.message);
    expect(r.issues.some((i) => i.scope === 'memory')).toBe(true);
    expect(r.issues.filter((i) => i.scope === 'polynomial').length).toBeGreaterThanOrEqual(2);
    expect(msgs.join(' ')).toContain('不能为零');
    expect(r.issues.some((i) => i.scope === 'costs' && i.line === 2 && i.column === 0)).toBe(true);
    expect(r.issues.some((i) => i.line === 3 && i.message.includes('4'))).toBe(true);
  });

  it('阶数越界导致多项式超宽也报错', () => {
    const r = validateRaw({
      memoryText: '1',
      polynomialsText: '133 171',
      costsText: goodCosts(MIN_STEPS, 4),
    });
    expect(r.issues.some((i) => i.message.includes('寄存器宽度'))).toBe(true);
  });

  it('步数越界与代价越界', () => {
    const tooFew = validateRaw({
      memoryText: '2',
      polynomialsText: '7 5',
      costsText: goodCosts(7, 4),
    });
    expect(tooFew.issues.some((i) => i.message.includes('时间步数'))).toBe(true);

    const text = `0 0 0 ${MAX_COST + 1}\n` + goodCosts(MIN_STEPS - 1, 4);
    const rows = parseCostsText(text);
    expect(rows.issues[0].line).toBe(1);
    expect(rows.issues[0].column).toBe(3);
  });
});

describe('JSON 导入', () => {
  it('接受十进制数字与带前缀字符串', () => {
    const json = JSON.stringify({
      memory: 2,
      polynomials: [91, 117], // 十进制 == 0o133/0o165
      costs: Array.from({ length: 8 }, () => [0, 1, 2, 3]),
    });
    const r = parseImportedJson(json);
    expect(r.issues).toHaveLength(0);
    expect(r.raw!.polynomialsText).toBe('0o133 0o165');
  });

  it('坏 JSON 报错', () => {
    expect(parseImportedJson('{').issues[0].scope).toBe('file');
  });
});
