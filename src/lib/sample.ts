import { symbolOf } from './codec';

export interface SampleConfig {
  memory: number;
  polynomials: number[];
  costs: number[][];
}

/**
 * 构造一份可读的示例：随机取一条闭合位串（初态 = 末 m 位），编码得到每步
 * 真实符号；真实符号代价给小值（偶发噪声），其余符号给较大随机代价。
 * 这样译码主结果通常还原该位串，工程师也能沿时间轴逐项复核。
 */
export function buildSample(
  memory = 6,
  polys: number[] = [0o133, 0o171],
  length = 64,
  seed = 20260923,
): SampleConfig {
  let s = seed >>> 0;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
  const k = polys.length;
  const ns = 1 << k;
  const mask = (1 << memory) - 1;

  // 直接生成位串；尾咬初态强制为末 m 位，天然闭合。
  const bits = Array.from({ length }, () => (rnd() < 0.5 ? 0 : 1));
  let state = 0;
  for (let i = length - memory; i < length; i++) state = (state << 1) | bits[i];
  const start = state & mask;

  const costs: number[][] = [];
  state = start;
  for (let t = 0; t < length; t++) {
    const word = (state << 1) | bits[t];
    const trueSym = symbolOf(word, polys).symbol;
    const row: number[] = [];
    for (let sy = 0; sy < ns; sy++) {
      if (sy === trueSym) {
        row.push(rnd() < 0.85 ? 0 : 1 + Math.floor(rnd() * 3));
      } else {
        row.push(20 + Math.floor(rnd() * 200));
      }
    }
    costs.push(row);
    state = word & mask;
  }
  return { memory, polynomials: polys, costs };
}

export function sampleToJson(c: SampleConfig): string {
  return JSON.stringify(
    { memory: c.memory, polynomials: c.polynomials, costs: c.costs },
    null,
    2,
  );
}
