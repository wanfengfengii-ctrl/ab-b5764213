// 输入解析与校验。所有校验错误一次性收集，并带定位信息（字段 / 多项式序号 /
// 代价表行号、列号），供 UI 一次性展示全部错误。

export interface Config {
  memory: number;
  polynomials: number[]; // 已解析为整数
  costs: number[][]; // costs[step][symbol]
}

export interface ConfigIssue {
  scope: 'memory' | 'polynomial' | 'costs' | 'file';
  /** 多项式序号（从 0 起）或代价表行号（从 0 起） */
  index?: number;
  /** 1 基行号，便于在文本框中定位 */
  line?: number;
  /** 代价行内列号（从 0 起） */
  column?: number;
  message: string;
}

export const MIN_STEPS = 8;
export const MAX_STEPS = 512;
export const MIN_COST = 0;
export const MAX_COST = 1_000_000;
export const MIN_MEMORY = 1;
export const MAX_MEMORY = 6;

/**
 * 解析单个生成多项式：
 *  - 0b 前缀：二进制；0x：十六进制；0o 或无前缀：八进制（深空码惯例，如 133、171）
 *  - 允许中间空白；不能为空。
 */
export function parsePolynomial(raw: string): { value?: number; error?: string } {
  const s = raw.trim().replace(/\s+/g, '');
  if (!s) return { error: '多项式为空' };
  let base = 8;
  let body = s;
  if (/^0b/i.test(s)) {
    base = 2;
    body = s.slice(2);
  } else if (/^0x/i.test(s)) {
    base = 16;
    body = s.slice(2);
  } else if (/^0o/i.test(s)) {
    base = 8;
    body = s.slice(2);
  }
  const digits = base === 2 ? /^[01]+$/ : base === 16 ? /^[0-9a-fA-F]+$/ : /^[0-7]+$/;
  if (!digits.test(body)) {
    const name = base === 2 ? '二进制' : base === 16 ? '十六进制' : '八进制';
    return { error: `不是合法的${name}整数：${raw.trim()}` };
  }
  return { value: parseInt(body, base) };
}

export function formatPolynomial(value: number): string {
  return '0o' + value.toString(8);
}

function isSafeInt(s: string): boolean {
  return /^[+-]?\d+$/.test(s.trim());
}

export interface ParsedCosts {
  costs: number[][];
  issues: ConfigIssue[];
}

/**
 * 解析代价表文本：每个时间步一行，行内为全部输出符号的整数代价，
 * 以逗号或空白分隔。保留原始行号用于错误定位（跳过完全为空的首尾行不现实，
 * 这里空行报“缺少数据”，避免静默改变步数）。
 */
export function parseCostsText(text: string): ParsedCosts {
  const costs: number[][] = [];
  const issues: ConfigIssue[] = [];
  const lines = text.split(/\r?\n/);
  // 容忍文件末尾换行产生的单个空尾行；中间空行仍按错误定位。
  if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      issues.push({ scope: 'costs', index: i, line: i + 1, message: '该行为空，每个时间步必须占一行' });
      costs.push([]); // 占位，保持行号与索引对齐；长度校验会因已有错误而跳过
      continue;
    }
    const tokens = line.trim().split(/\s*[,\s]\s*/).filter((t) => t !== '');
    const row: number[] = [];
    tokens.forEach((tok, col) => {
      if (!isSafeInt(tok)) {
        issues.push({
          scope: 'costs',
          index: i,
          line: i + 1,
          column: col,
          message: `第 ${col + 1} 列不是整数：${tok}`,
        });
        return;
      }
      const v = Number(tok);
      if (!Number.isSafeInteger(v) || v < MIN_COST || v > MAX_COST) {
        issues.push({
          scope: 'costs',
          index: i,
          line: i + 1,
          column: col,
          message: `第 ${col + 1} 列代价 ${v} 超出允许范围 [${MIN_COST}, ${MAX_COST}]`,
        });
        return;
      }
      row.push(v);
    });
    costs.push(row);
  }
  return { costs, issues };
}

export interface RawConfig {
  memoryText: string;
  polynomialsText: string;
  costsText: string;
}

export interface ValidationResult {
  config?: Config;
  issues: ConfigIssue[];
}

export function validateRaw(raw: RawConfig): ValidationResult {
  const issues: ConfigIssue[] = [];

  // 记忆阶数
  let memory = 0;
  const mt = raw.memoryText.trim();
  if (!/^\d+$/.test(mt)) {
    issues.push({ scope: 'memory', message: `记忆阶数必须是 ${MIN_MEMORY}–${MAX_MEMORY} 的整数` });
  } else {
    memory = Number(mt);
    if (memory < MIN_MEMORY || memory > MAX_MEMORY) {
      issues.push({ scope: 'memory', message: `记忆阶数必须在 ${MIN_MEMORY}–${MAX_MEMORY} 之间，当前为 ${memory}` });
    }
  }

  // 生成多项式
  const polyTokens = raw.polynomialsText
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
  const polynomials: number[] = [];
  if (polyTokens.length < 2 || polyTokens.length > 3) {
    issues.push({
      scope: 'polynomial',
      message: `生成多项式必须为 2 或 3 个，当前有 ${polyTokens.length} 个`,
    });
  }
  polyTokens.forEach((tok, i) => {
    const parsed = parsePolynomial(tok);
    if (parsed.error) {
      issues.push({ scope: 'polynomial', index: i, message: `第 ${i + 1} 个多项式：${parsed.error}` });
      return;
    }
    const v = parsed.value!;
    if (v === 0) {
      issues.push({ scope: 'polynomial', index: i, message: `第 ${i + 1} 个多项式不能为零` });
      return;
    }
    if (memory >= MIN_MEMORY && memory <= MAX_MEMORY) {
      const widthMax = (1 << (memory + 1)) - 1;
      if (v > widthMax) {
        issues.push({
          scope: 'polynomial',
          index: i,
          message: `第 ${i + 1} 个多项式 ${tok}(=${v}) 超出 ${memory + 1} 位寄存器宽度（最大 ${widthMax} / 0o${widthMax.toString(8)}）`,
        });
        return;
      }
    }
    polynomials.push(v);
  });

  // 代价表
  const parsed = parseCostsText(raw.costsText);
  issues.push(...parsed.issues);
  const costs = parsed.costs;
  if (costs.length < MIN_STEPS || costs.length > MAX_STEPS) {
    issues.push({
      scope: 'costs',
      message: `时间步数必须在 ${MIN_STEPS}–${MAX_STEPS} 之间，当前为 ${costs.length}`,
    });
  }
  const numSymbols = 1 << polyTokens.length;
  if (polyTokens.length >= 2 && polyTokens.length <= 3) {
    costs.forEach((row, i) => {
      if (row.length !== numSymbols && (!parsed.issues.some((x) => x.index === i))) {
        issues.push({
          scope: 'costs',
          index: i,
          line: i + 1,
          message: `第 ${i + 1} 行有 ${row.length} 个代价，应为 ${numSymbols} 个（${polyTokens.length} 个多项式 → ${numSymbols} 个输出符号）`,
        });
      }
    });
  }

  if (issues.length > 0) return { issues };
  return { config: { memory, polynomials, costs }, issues: [] };
}

/** 导入 JSON：{ memory, polynomials: (number|string)[], costs: number[][] } */
export function configToText(cfg: Config): RawConfig {
  return {
    memoryText: String(cfg.memory),
    polynomialsText: cfg.polynomials.map((p) => '0o' + p.toString(8)).join(' '),
    costsText: cfg.costs.map((row) => row.join(' ')).join('\n'),
  };
}

export function parseImportedJson(text: string): { raw?: RawConfig; issues: ConfigIssue[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { issues: [{ scope: 'file', message: `JSON 解析失败：${(e as Error).message}` }] };
  }
  if (typeof data !== 'object' || data === null) {
    return { issues: [{ scope: 'file', message: '导入内容必须是 JSON 对象' }] };
  }
  const obj = data as Record<string, unknown>;
  const issues: ConfigIssue[] = [];
  if (typeof obj.memory !== 'number' || !Number.isInteger(obj.memory)) {
    issues.push({ scope: 'memory', message: 'memory 必须是整数' });
  }
  if (!Array.isArray(obj.polynomials) || obj.polynomials.some((p) => typeof p !== 'number' && typeof p !== 'string')) {
    issues.push({ scope: 'polynomial', message: 'polynomials 必须是数字或字符串数组（2–3 项）' });
  }
  if (!Array.isArray(obj.costs) || obj.costs.some((r) => !Array.isArray(r))) {
    issues.push({ scope: 'costs', message: 'costs 必须是二维数组' });
  }
  if (issues.length) return { issues };

  const polys = (obj.polynomials as (number | string)[]).map((p) =>
    typeof p === 'number' ? String(p) : (p as string),
  );
  // JSON 中裸数字按十进制解释；带 0o/0x/0b 前缀的字符串按对应进制解释，
  // 统一规范化为八进制文本交给后续校验。
  const normalized = polys
    .map((p) => {
      const t = p.trim();
      if (/^0[oxb]/i.test(t)) return t;
      return '0o' + parseInt(t, 10).toString(8);
    })
    .join(' ');

  const raw: RawConfig = {
    memoryText: String(obj.memory),
    polynomialsText: normalized,
    costsText: (obj.costs as number[][]).map((row) => row.map((v) => String(v)).join(' ')).join('\n'),
  };
  return { raw, issues: [] };
}
