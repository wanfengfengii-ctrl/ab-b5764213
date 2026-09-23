import { useEffect, useRef } from 'react';
import type { ValidationError } from '../lib/validate';
import { LIMITS } from '../lib/validate';

interface Props {
  memory: number;
  onMemory: (v: number) => void;
  genCount: number;
  onGenCount: (n: number) => void;
  genTexts: string[];
  onGenText: (i: number, text: string) => void;
  genParsed: number[];
  editMode: 'grid' | 'text';
  onEditMode: (m: 'grid' | 'text') => void;
  costText: string;
  onCostText: (s: string) => void;
  rows: number[][];
  onCellEdit: (row: number, col: number, raw: string) => void;
  stepCountWanted: number;
  onApplyStepCount: (n: number) => void;
  errors: ValidationError[];
  focus: { step?: number; index?: number; nonce: number } | null;
  onImportFile: (f: File) => void;
  onExport: () => void;
  onSample: () => void;
  onRandom: () => void;
  onDecode: () => void;
  decoding: boolean;
}

export function InputEditor(p: Props) {
  const symbolCount = 1 << p.genCount;
  const badCells = new Set<string>();
  const badRows = new Set<number>();
  p.errors.forEach((e) => {
    if (typeof e.step === 'number' && typeof e.index === 'number') badCells.add(`${e.step}:${e.index}`);
    if (typeof e.step === 'number' && (e.code === 'STEP_ROW_LENGTH' || e.code === 'COST_ROW_NOT_ARRAY')) badRows.add(e.step);
  });
  const genBad = new Set<number>();
  p.errors.forEach((e) => {
    if ((e.code === 'GEN_NONZERO' || e.code === 'GEN_OUT_OF_RANGE' || e.code === 'GEN_INTEGER') && typeof e.index === 'number') {
      genBad.add(e.index);
    }
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const focusRef = useRef<HTMLTableCellElement | null>(null);

  useEffect(() => {
    if (p.focus && p.editMode === 'grid') {
      const el = document.getElementById(
        `cell-${p.focus.step ?? 0}-${p.focus.index ?? 0}`
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el?.querySelector('input') as HTMLInputElement | null)?.focus();
    }
  }, [p.focus, p.editMode]);

  const maxGen = (1 << (p.memory + 1)) - 1;

  return (
    <section className="panel">
      <h2>① 码参数与符号代价</h2>

      <div className="row">
        <div className="field">
          <label>记忆阶数 m（1–6）</label>
          <input
            id="memory-input"
            type="number"
            min={LIMITS.MIN_MEMORY}
            max={LIMITS.MAX_MEMORY}
            value={Number.isFinite(p.memory) ? p.memory : ''}
            className={p.errors.some((e) => e.code === 'MEMORY_RANGE' || e.code === 'MEMORY_INTEGER') ? 'invalid' : ''}
            onChange={(e) => p.onMemory(e.target.value === '' ? NaN : Number(e.target.value))}
            style={{ width: 80 }}
          />
        </div>
        <div className="field">
          <label>寄存器宽度 {Number.isFinite(p.memory) ? `${p.memory + 1} 位` : '—'}，状态数 {Number.isFinite(p.memory) ? 1 << p.memory : '—'}</label>
          <span className="hint">
            多项式最大值 = <span className="mono">{Number.isFinite(p.memory) ? maxGen.toString(8) : '?'}</span>（八进制）
          </span>
        </div>
        <div className="field">
          <label>生成多项式个数</label>
          <select value={p.genCount} onChange={(e) => p.onGenCount(Number(e.target.value))}>
            <option value={2}>2（码率 1/2，4 个符号）</option>
            <option value={3}>3（码率 1/3，8 个符号）</option>
          </select>
        </div>
      </div>

      <div className="row">
        {p.genTexts.map((txt, i) => {
          const v = p.genParsed[i];
          return (
            <div className="field" key={i}>
              <label>
                g<sub>{i + 1}</sub>（八进制，非零 ≤ {Number.isFinite(p.memory) ? maxGen.toString(8) : '?'}）
              </label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  id={`gen-input-${i}`}
                  type="text"
                  value={txt}
                  className={genBad.has(i) ? 'invalid' : ''}
                  onChange={(e) => p.onGenText(i, e.target.value)}
                  style={{ width: 110 }}
                  placeholder={i === 0 ? '171' : i === 1 ? '133' : '165'}
                />
                <span className="hint mono">
                  {Number.isFinite(v) ? `= ${v} = 0b${v.toString(2).padStart(Number.isFinite(p.memory) ? p.memory + 1 : 0, '0')}` : '无效'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <h3>符号代价表</h3>
      <div className="row">
        <div className="field">
          <label>步数 L（8–512，当前 {p.rows.length}）</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="number"
              min={LIMITS.MIN_STEPS}
              max={LIMITS.MAX_STEPS}
              defaultValue={p.stepCountWanted}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isInteger(v)) p.onApplyStepCount(v);
              }}
              style={{ width: 90 }}
            />
            <span className="hint">超出范围将在下方报错；自动补零或截断</span>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 10 }}>
        <button className={p.editMode === 'grid' ? 'active' : ''} onClick={() => p.onEditMode('grid')}>
          表格编辑
        </button>
        <button className={p.editMode === 'text' ? 'active' : ''} onClick={() => p.onEditMode('text')}>
          文本编辑（每行 {symbolCount} 个数，空格/逗号分隔）
        </button>
      </div>

      {p.editMode === 'text' ? (
        <textarea
          spellCheck={false}
          value={p.costText}
          onChange={(e) => p.onCostText(e.target.value)}
          placeholder={'0 5 2 0\n0 1 7 3\n…'}
        />
      ) : (
        <div className="cost-table-wrap">
          <table className="grid cost-table">
            <thead>
              <tr>
                <th>t</th>
                {Array.from({ length: symbolCount }, (_, s) => (
                  <th key={s}>
                    sym {s}
                    <br />
                    <span className="hint">({s.toString(2).padStart(p.genCount, '0')})</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((row, t) => (
                <tr key={t} className={badRows.has(t) ? 'row-marked' : ''}>
                  <td>{t}</td>
                  {Array.from({ length: symbolCount }, (_, s) => {
                    const val = row[s];
                    const isBad = badCells.has(`${t}:${s}`) || row.length !== symbolCount;
                    return (
                      <td
                        key={s}
                        id={`cell-${t}-${s}`}
                        ref={p.focus && p.focus.step === t && p.focus.index === s ? focusRef : undefined}
                        className={isBad ? 'cell-bad' : ''}
                      >
                        <input
                          type="text"
                          inputMode="numeric"
                          className={isBad ? 'bad' : ''}
                          value={Number.isFinite(val) ? String(val) : ''}
                          onChange={(e) => p.onCellEdit(t, s, e.target.value)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" onClick={p.onDecode} disabled={p.decoding || p.errors.length > 0}>
          {p.decoding ? '译码中…' : '▶ 启动译码'}
        </button>
        <button className="ghost" onClick={p.onSample}>载入内置样例</button>
        <button className="ghost" onClick={p.onRandom}>随机代价</button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>导入 JSON…</button>
        <button className="ghost" onClick={p.onExport}>导出 JSON</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImportFile(f);
            e.target.value = '';
          }}
        />
        <span className="hint">全部计算仅在本机浏览器内完成，不上传任何数据。</span>
      </div>
    </section>
  );
}
