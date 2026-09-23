/**
 * 尾咬合卷积码译码复核台 —— 核心类型定义
 */

/** 一份可复核的译码输入 */
export interface DecoderInput {
  /** 记忆阶数 K-1（约束长度 K = memory + 1），取值 1..6 */
  memory: number;
  /** 生成多项式（八进制），2 或 3 个；每个非零且不超过寄存器宽度 2^(memory+1)-1 */
  generators: number[];
  /**
   * 每个时刻、对每个可能输出符号的整数代价。
   * costs[t][sym] 表示第 t 步收到符号 sym（sym ∈ [0, 2^G)）的代价。
   * 步数 L ∈ [8, 512]，每个代价 ∈ [0, 1_000_000]。
   */
  costs: number[][];
}

/** 单个时刻的逐步复核记录 */
export interface StepRecord {
  /** 时刻索引，从 0 开始 */
  t: number;
  /** 该时刻移入的输入位 */
  bit: 0 | 1;
  /** 移位前的状态（移入前低 memory 位） */
  prevState: number;
  /** 移位并截断后的状态 */
  nextState: number;
  /** 未截断的寄存器字：((prevState << 1) | bit)，宽度 memory+1 位 */
  registerWord: number;
  /** 各生成多项式对应的输出位（按 generators 顺序） */
  outputBits: number[];
  /** 输出符号（第 i 个多项式的输出位为从高到低第 i 位） */
  symbol: number;
  /** 该步代价 */
  stepCost: number;
  /** 沿该路径到该时刻末的累计代价（含本步） */
  cumCost: number;
}

/** 一次完整译码的结果（针对某个首尾闭合状态） */
export interface DecodeWitness {
  /** 初始（=末尾）状态 */
  startState: number;
  /** 输入位串：bits[t] 为第 t 步移入的位 */
  bits: number[];
  /** 逐步复核记录，长度等于步数 L */
  trace: StepRecord[];
  /** 总代价 = trace 末项累计代价 */
  totalCost: number;
}

/** 完整译码输出 */
export interface DecodeResult {
  memory: number;
  generators: number[];
  /** 输出符号个数 = 2^G（G 为生成多项式个数） */
  symbolCount: number;
  stepCount: number;
  /** 主结果：全部闭合路径中代价最小；并列时取输入位串字典序最小 */
  primary: DecodeWitness;
  /** 每个起始状态 s 对应的闭合最小代价（L ≥ memory 时全部有限） */
  closedCosts: number[];
  /**
   * 若存在另一条与主结果总代价相同的完整路径（允许首尾状态不同），
   * 这里给出其中输入位串字典序最小的一条；否则为 null（唯一最优）。
   */
  alternate: DecodeWitness | null;
  /** 最优总代价是否唯一（alternate === null） */
  unique: boolean;
}
