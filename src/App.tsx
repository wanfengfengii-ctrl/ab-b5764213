import { useCallback, useMemo, useRef, useState } from 'react';
import { InputEditor } from './components/InputEditor';
import { ResultViewer } from './components/ResultViewer';
import { decode } from './lib/decoder';
import { validateInput, type ValidationError } from './lib/validate';
import type { DecodeResult, DecoderInput } from './lib/types';
import {
  buildSample,
  costsToText,
  exportJson,
  importJson,
  parseCostText,
  parseOctal,
  randomCosts,
} from './lib/io';

interface StoredResult {
  result: DecodeResult;
  /** 产生该结果时输入的签名；输入改变后签名不匹配则撤下 */
  sig: string;
  elapsedMs: number;
}

/** 输入签名：参数与代价表完整参与，任何改动都会使旧结果失效 */
function signature(memory: number, gens: number[], costs: number[][]): string {
  return JSON.stringify({ m: memory, g: gens, c: costs });
}

/** 把代价表列数规整为 syms 列（多出的列截掉，不足补 0） */
function resizeColumns(prev: number[][], syms: number): number[][] {
  return prev.map((r) => {
    if (r.length === syms) return [...r];
    if (r.length > syms) return r.slice(0, syms);
    return [...r, ...new Array(syms - r.length).fill(0)];
  });
}

export function App() {
  const [memory, setMemory] = useState<number>(2);
  const [genCount, setGenCount] = useState<number>(2);
  const [genTexts, setGenTexts] = useState<string[]>(['7', '5', '']);
  const [editMode, setEditMode] = useState<'grid' | 'text'>('grid');

  const sample = useMemo(() => buildSample(2, 24), []);
  const [rows, setRows] = useState<number[][]>(() => sample.input.costs.map((r) => [...r]));
  const [costText, setCostText] = useState<string>(() => costsToText(sample.input.costs));
  const [stepCountWanted, setStepCountWanted] = useState<number>(24);

  const [resultBox, setResultBox] = useState<StoredResult | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{ step?: number; index?: number; nonce: number } | null>(null);
  const seedRef = useRef<number>(1);

  // 已解析的多项式（无效为 NaN）
  const genParsed = useMemo(
    () => genTexts.slice(0, genCount).map((t) => parseOctal(t) ?? NaN),
    [genTexts, genCount]
  );

  /** 当前用于校验/译码的结构化输入（尽量构造，具体合法性由 validate 判定） */
  const currentInput: DecoderInput = useMemo(
    () => ({
      memory,
      generators: genParsed.map((v) => (Number.isFinite(v) ? v : 0)),
      costs: rows,
    }),
    [memory, genParsed, rows]
  );

  const errors: ValidationError[] = useMemo(
    () => validateInput(currentInput),
    [currentInput]
  );

  const currentSig = useMemo(
    () => (errors.length === 0 ? signature(memory, genParsed, rows) : null),
    [errors.length, memory, genParsed, rows]
  );

  // 输入改变或校验失败：立即撤下旧结果
  const shownResult = resultBox && currentSig !== null && resultBox.sig === currentSig ? resultBox : null;

  // ---- 编辑处理 ----
  const setGenTextAt = (i: number, text: string) => {
    setGenTexts((prev) => prev.map((g, j) => (j === i ? text : g)));
  };

  const changeGenCount = (n: number) => {
    setGenCount(n);
    setGenTexts((prev) => {
      const next = [...prev];
      if (n === 3 && !next[2]) next[2] = '3';
      return next;
    });
    // 规整代价表列数到 2^n
    setRows((prev) => resizeColumns(prev, 1 << n));
    setCostText((prev) =>
      resizeColumns(parseCostText(prev).rows, 1 << n)
        .map((r) => r.map((v) => (Number.isFinite(v) ? String(v) : '')).join(' '))
        .join('\n')
    );
  };

  const changeMemory = (v: number) => {
    setMemory(v);
  };

  const applyCostText = (text: string) => {
    setCostText(text);
    const parsed = parseCostText(text);
    const next = parsed.rows;
    // 规整为 genCount 列：不足补 NaN，多余保留（校验会报行宽错误并定位）
    setRows(next);
    setStepCountWanted(next.length);
  };

  const editCell = (row: number, col: number, raw: string) => {
    setRows((prev) => {
      if (!prev[row]) return prev;
      const next = prev.map((r) => [...r]);
      if (raw.trim() === '' || !/^[+-]?\d+$/.test(raw.trim())) {
        next[row][col] = NaN;
      } else {
        next[row][col] = Number(raw.trim());
      }
      // 同步文本视图（NaN 渲染为空，待用户补全；校验会定位该格）
      setCostText(
        next
          .map((r) => r.map((v) => (Number.isFinite(v) ? String(v) : '')).join(' '))
          .join('\n')
      );
      return next;
    });
  };

  const applyStepCount = (n: number) => {
    setStepCountWanted(n);
    if (!Number.isInteger(n) || n < 0) return;
    const syms = 1 << genCount;
    setRows((prev) => {
      if (n === prev.length) return prev;
      if (n < prev.length) return prev.slice(0, n);
      const add = Array.from({ length: n - prev.length }, () => new Array(syms).fill(0));
      return [...prev, ...add];
    });
    setCostText((prev) => {
      const lines = prev.split(/\r?\n/).filter((l) => l.trim());
      if (n < lines.length) return lines.slice(0, n).join('\n');
      const add = Array.from({ length: n - lines.length }, () => new Array(syms).fill(0).join(' '));
      return [...lines, ...add].join('\n');
    });
  };

  const loadInput = useCallback((input: DecoderInput) => {
    setMemory(input.memory);
    setGenCount(input.generators.length);
    setGenTexts([
      ...input.generators.map((g) => g.toString(8)),
      '',
    ].slice(0, 3));
    setRows(input.costs.map((r) => [...r]));
    setCostText(costsToText(input.costs));
    setStepCountWanted(input.costs.length);
    setResultBox(null);
    setImportError(null);
  }, []);

  const loadSample = () => loadInput(buildSample(2, 24, (seedRef.current = 20260923 + Math.floor(Math.random() * 1000))).input);

  const loadRandom = () => {
    seedRef.current = (seedRef.current * 1103515245 + 12345) >>> 0;
    const L = Math.min(512, Math.max(8, stepCountWanted));
    const costs = randomCosts(
      genCount,
      L,
      1_000_000,
      seedRef.current
    );
    setRows(costs);
    setCostText(costsToText(costs));
    setStepCountWanted(L);
    setResultBox(null);
  };

  const onImportFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const input = importJson(String(reader.result));
        loadInput(input);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    };
    reader.onerror = () => setImportError('文件读取失败。');
    reader.readAsText(f);
  };

  const onExport = () => {
    if (errors.length > 0) return;
    const blob = new Blob([exportJson(currentInput)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tailbiting-input.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runDecode = () => {
    if (errors.length > 0) return;
    setDecoding(true);
    // 让 UI 先进入译码态
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const result = decode(currentInput);
        const elapsedMs = performance.now() - t0;
        setResultBox({ result, sig: signature(memory, genParsed, rows), elapsedMs });
      } catch (e) {
        setImportError(`译码失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setDecoding(false);
      }
    }, 20);
  };

  const locateError = (e: ValidationError) => {
    setFocusNonce((n) => n + 1);
    if (typeof e.step === 'number') {
      setEditMode('grid');
      setFocusTarget({ step: e.step, index: e.index ?? 0, nonce: focusNonce + 1 });
      // 切到网格后元素才挂载
      setTimeout(() => {
        document.getElementById(`cell-${e.step}-${e.index ?? 0}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (document.getElementById(`cell-${e.step}-${e.index ?? 0}`)?.querySelector('input') as HTMLInputElement | null)?.focus();
      }, 50);
    } else if (typeof e.index === 'number' && (e.code.startsWith('GEN_'))) {
      document.getElementById(`gen-input-${e.index}`)?.focus();
      document.getElementById(`gen-input-${e.index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (e.code === 'MEMORY_RANGE' || e.code === 'MEMORY_INTEGER') {
      document.getElementById('memory-input')?.focus();
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>尾咬合卷积码 · 本地译码复核台</h1>
        <p>
          状态转移 <span className="mono">next = ((state &lt;&lt; 1) | bit) &amp; mask</span>，
          输出位为各生成多项式与未截断寄存器字的奇偶校验；强制初态 = 末态，精确最小化总代价，
          并列时以输入位串字典序确定主结果并报告唯一性。全部译码在本地浏览器完成。
        </p>
      </header>

      {importError && (
        <div className="error-list">
          <div className="title">导入失败</div>
          <div>{importError}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="ghost" onClick={() => setImportError(null)}>知道了</button>
          </div>
        </div>
      )}

      {errors.length > 0 ? (
        <div className="error-list">
          <div className="title">输入校验：发现 {errors.length} 个问题（旧结果已撤下，修复后可重新译码）</div>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                <button className="link" onClick={() => locateError(e)}>
                  {e.message}
                  {typeof e.step === 'number' ? ` ［点击定位到第 ${e.step + 1} 步${typeof e.index === 'number' ? ` / 符号 ${e.index}` : ''}］` : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="badge ok">输入校验通过</span>
          <span className="hint">
            {rows.length} 步 × {1 << genCount} 符号；可以启动译码。
          </span>
        </div>
      )}

      <InputEditor
        memory={memory}
        onMemory={changeMemory}
        genCount={genCount}
        onGenCount={changeGenCount}
        genTexts={genTexts.slice(0, genCount)}
        onGenText={setGenTextAt}
        genParsed={genParsed}
        editMode={editMode}
        onEditMode={setEditMode}
        costText={costText}
        onCostText={applyCostText}
        rows={rows}
        onCellEdit={editCell}
        stepCountWanted={stepCountWanted}
        onApplyStepCount={applyStepCount}
        errors={errors}
        focus={focusTarget}
        onImportFile={onImportFile}
        onExport={onExport}
        onSample={loadSample}
        onRandom={loadRandom}
        onDecode={runDecode}
        decoding={decoding}
      />

      {shownResult ? (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="badge ok">译码完成（耗时 {shownResult.elapsedMs.toFixed(1)} ms）</span>
            <span className="hint">结果与当前输入严格对应；一旦编辑输入，结果立即撤下。</span>
          </div>
          <ResultViewer result={shownResult.result} />
        </>
      ) : (
        <section className="panel">
          <h2>② 结果区</h2>
          <p className="hint">
            {resultBox && !shownResult
              ? '输入已改变或校验未通过，旧译码结果已撤下。修正输入并重新启动译码。'
              : '填写合法参数与代价表后点击「启动译码」，这里将展示最优解、唯一性与逐步时间轴。'}
          </p>
        </section>
      )}
    </div>
  );
}
