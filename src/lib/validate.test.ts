import { describe, it, expect } from 'vitest';
import { validateInput, LIMITS } from './validate';
import type { DecoderInput } from './types';

function baseInput(over: Partial<DecoderInput> = {}): DecoderInput {
  return {
    memory: 2,
    generators: [0o7, 0o5],
    costs: Array.from({ length: 8 }, () => [0, 1, 2, 3]),
    ...over,
  };
}

describe('输入校验', () => {
  it('合法输入无错误', () => {
    expect(validateInput(baseInput())).toEqual([]);
  });

  it('memory 越界与非整数', () => {
    expect(validateInput(baseInput({ memory: 0 })).map((e) => e.code)).toContain('MEMORY_RANGE');
    expect(validateInput(baseInput({ memory: 7 })).map((e) => e.code)).toContain('MEMORY_RANGE');
    expect(validateInput(baseInput({ memory: 2.5 })).map((e) => e.code)).toContain('MEMORY_INTEGER');
  });

  it('多项式个数、零值、超宽度', () => {
    expect(validateInput(baseInput({ generators: [0o7] })).map((e) => e.code)).toContain('GEN_COUNT');
    expect(validateInput(baseInput({ generators: [0o7, 0o5, 0o3, 0o1] })).map((e) => e.code)).toContain('GEN_COUNT');
    expect(validateInput(baseInput({ generators: [0, 0o5] })).map((e) => e.code)).toContain('GEN_NONZERO');
    // memory=2 宽度 3 位，最大 7
    expect(validateInput(baseInput({ generators: [0o10, 0o5] })).map((e) => e.code)).toContain('GEN_OUT_OF_RANGE');
    // memory=6 宽度 7 位，最大 177(oct)
    const ok = validateInput({
      memory: 6,
      generators: [0o177, 0o133],
      costs: Array.from({ length: 8 }, () => [0, 0, 0, 0]),
    });
    expect(ok).toEqual([]);
  });

  it('步数边界 7 / 8 / 512 / 513', () => {
    const mk = (L: number) => baseInput({ costs: Array.from({ length: L }, () => [0, 0, 0, 0]) });
    expect(validateInput(mk(7)).map((e) => e.code)).toContain('STEP_COUNT');
    expect(validateInput(mk(8))).toEqual([]);
    expect(validateInput(mk(512))).toEqual([]);
    expect(validateInput(mk(513)).map((e) => e.code)).toContain('STEP_COUNT');
  });

  it('每行符号数必须等于 2^G', () => {
    const costs = Array.from({ length: 8 }, () => [0, 0, 0]); // 应为 4
    expect(validateInput(baseInput({ costs })).every((e) => e.code === 'STEP_ROW_LENGTH')).toBe(true);
    const costs8 = Array.from({ length: 8 }, () => [0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateInput(baseInput({ generators: [0o7, 0o5, 0o3], costs: costs8 }))).toEqual([]);
  });

  it('代价范围与整数', () => {
    const costs = Array.from({ length: 8 }, () => [0, 0, 0, 0]);
    costs[3][2] = LIMITS.MAX_COST + 1;
    const errs1 = validateInput(baseInput({ costs }));
    expect(errs1.map((e) => e.code)).toContain('COST_RANGE');
    expect(errs1.find((e) => e.code === 'COST_RANGE')?.step).toBe(3);
    expect(errs1.find((e) => e.code === 'COST_RANGE')?.index).toBe(2);

    const costs2 = Array.from({ length: 8 }, () => [0, 0, 0, 0]);
    costs2[0][0] = -1;
    expect(validateInput(baseInput({ costs: costs2 })).map((e) => e.code)).toContain('COST_RANGE');

    const costs3 = Array.from({ length: 8 }, () => [0, 1.5, 0, 0]);
    expect(validateInput(baseInput({ costs: costs3 })).map((e) => e.code)).toContain('COST_INTEGER');
  });
});
