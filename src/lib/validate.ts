/**
 * 译码输入校验
 *
 * 规则：
 *  - memory ∈ [1, 6] 整数
 *  - 生成多项式 2~3 个，每个为非零整数且 ≤ 2^(memory+1)-1（寄存器宽度内）
 *  - 步数 L ∈ [8, 512]
 *  - 每步必须为全部 2^G 个输出符号给出 [0, 1_000_000] 的整数代价
 */
import type { DecoderInput } from './types';

export interface ValidationError {
  /** 机器可读错误码 */
  code:
    | 'MEMORY_RANGE'
    | 'MEMORY_INTEGER'
    | 'GEN_COUNT'
    | 'GEN_NONZERO'
    | 'GEN_OUT_OF_RANGE'
    | 'GEN_INTEGER'
    | 'STEP_COUNT'
    | 'STEP_ROW_LENGTH'
    | 'COST_RANGE'
    | 'COST_INTEGER'
    | 'COST_ROW_NOT_ARRAY';
  message: string;
  /** 错误定位：第几步（0 起） */
  step?: number;
  /** 错误定位：第几个符号/多项式（0 起） */
  index?: number;
}

export const LIMITS = {
  MIN_MEMORY: 1,
  MAX_MEMORY: 6,
  MIN_STEPS: 8,
  MAX_STEPS: 512,
  MIN_GENS: 2,
  MAX_GENS: 3,
  MIN_COST: 0,
  MAX_COST: 1_000_000,
};

export function validateInput(input: DecoderInput): ValidationError[] {
  const errors: ValidationError[] = [];
  const { memory, generators, costs } = input;

  // ---- memory ----
  if (typeof memory !== 'number' || !Number.isFinite(memory) || !Number.isInteger(memory)) {
    errors.push({ code: 'MEMORY_INTEGER', message: '记忆阶数必须是 1~6 的整数。' });
  } else if (memory < LIMITS.MIN_MEMORY || memory > LIMITS.MAX_MEMORY) {
    errors.push({ code: 'MEMORY_RANGE', message: '记忆阶数必须在 1 到 6 之间。' });
  }

  const memOk =
    typeof memory === 'number' &&
    Number.isInteger(memory) &&
    memory >= LIMITS.MIN_MEMORY &&
    memory <= LIMITS.MAX_MEMORY;

  // ---- generators ----
  if (!Array.isArray(generators) || generators.length < LIMITS.MIN_GENS || generators.length > LIMITS.MAX_GENS) {
    errors.push({
      code: 'GEN_COUNT',
      message: `生成多项式个数必须为 ${LIMITS.MIN_GENS} 或 ${LIMITS.MAX_GENS} 个，当前 ${Array.isArray(generators) ? generators.length : 0} 个。`,
    });
  } else {
    const maxReg = memOk ? (1 << (memory + 1)) - 1 : Infinity;
    generators.forEach((g, i) => {
      if (typeof g !== 'number' || !Number.isFinite(g) || !Number.isInteger(g)) {
        errors.push({ code: 'GEN_INTEGER', index: i, message: `第 ${i + 1} 个生成多项式必须是整数。` });
        return;
      }
      if (g === 0) {
        errors.push({ code: 'GEN_NONZERO', index: i, message: `第 ${i + 1} 个生成多项式不能为零。` });
      }
      if (memOk && g > maxReg) {
        errors.push({
          code: 'GEN_OUT_OF_RANGE',
          index: i,
          message: `第 ${i + 1} 个生成多项式八进制 ${g.toString(8)} 超出寄存器宽度（最大 ${maxReg.toString(8)}，即 ${memory + 1} 位）。`,
        });
      }
    });
  }

  // ---- costs ----
  if (!Array.isArray(costs) || costs.length < LIMITS.MIN_STEPS || costs.length > LIMITS.MAX_STEPS) {
    errors.push({
      code: 'STEP_COUNT',
      message: `符号代价表步数必须在 ${LIMITS.MIN_STEPS} 到 ${LIMITS.MAX_STEPS} 之间，当前 ${Array.isArray(costs) ? costs.length : 0} 步。`,
    });
  } else {
    const gOk = Array.isArray(generators) && generators.length >= LIMITS.MIN_GENS && generators.length <= LIMITS.MAX_GENS;
    const need = gOk ? 1 << generators.length : 0;
    costs.forEach((row, t) => {
      if (!Array.isArray(row)) {
        errors.push({ code: 'COST_ROW_NOT_ARRAY', step: t, message: `第 ${t + 1} 步的代价行不是数组。` });
        return;
      }
      if (gOk && row.length !== need) {
        errors.push({
          code: 'STEP_ROW_LENGTH',
          step: t,
          message: `第 ${t + 1} 步需要 ${need} 个符号代价（2^${generators.length}），实际 ${row.length} 个。`,
        });
      }
      row.forEach((c, sym) => {
        if (typeof c !== 'number' || !Number.isFinite(c) || !Number.isInteger(c)) {
          errors.push({ code: 'COST_INTEGER', step: t, index: sym, message: `第 ${t + 1} 步符号 ${sym} 的代价必须是整数。` });
        } else if (c < LIMITS.MIN_COST || c > LIMITS.MAX_COST) {
          errors.push({
            code: 'COST_RANGE',
            step: t,
            index: sym,
            message: `第 ${t + 1} 步符号 ${sym} 的代价 ${c} 超出范围 [0, 1,000,000]。`,
          });
        }
      });
    });
  }

  return errors;
}
