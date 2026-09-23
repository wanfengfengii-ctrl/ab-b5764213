import { useMemo, useState } from 'react';
import {
  validateRaw,
  parseImportedJson,
  configToText,
  type RawConfig,
  type ConfigIssue,
} from './lib/validation';
import { solveTailBiting, type SolveResult } from './lib/codec';
import { buildSample } from './lib/sample';
import { ResultView } from './components/ResultView';

const DEFAULT_SAMPLE = buildSample();

function initialRaw(): RawConfig {
  return configToText(DEFAULT_SAMPLE);
}

type DecodedRecord = {
  result: SolveResult;
  sig: string; // 产生该结果时的输入签名，输入改变即失效
};

export default function App() {
  const [raw, setRaw] = useState<RawConfig>(initialRaw);
  const [decoded, setDecoded] = useState<DecodedRecord | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [fileIssues, setFileIssues] = useState<ConfigIssue[]>([]);

  const validation = useMemo(() => validateRaw(raw), [raw]);
  const sig = useMemo(
    () => JSON.stringify(raw),
    [raw],
  );
  // 输入改变或校验失败时立即撤下旧结果
  const visibleDecoded = decoded && decoded.sig === sig && validation.issues.length === 0
    ? decoded
    : null;
  const stale = decoded !== null && visibleDecoded === null;

  const touch = (next: RawConfig) => {
    setRaw(next);
    setFileIssues([]);
    setDecoded(null);
  };

  const runDecode = () => {
    if (!validation.config) return;
    setDecoding(true);
    // 让 UI 先进入“译码中”状态，再执行可能数百毫秒的本地精确求解
    setTimeout(() => {
      try {
        const result = solveTailBiting(validation.config!);
        setDecoded({ result, sig: JSON.stringify(raw) });
      } finally {
        setDecoding(false);
      }
    }, 20);
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseImportedJson(text);
    if (parsed.issues.length || !parsed.raw) {
      setFileIssues(parsed.issues);
      setDecoded(null);
      return;
    }
    setFileIssues([]);
    setRaw(parsed.raw);
    setDecoded(null);
  };

  const exportConfig = () => {
    if (!validation.config) return;
    const blob = new Blob(
      [JSON.stringify(
        {
          memory: validation.config.memory,
          polynomials: validation.config.polynomials,
          costs: validation.config.costs,
        },
        null,
        2,
      )],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tailbiting-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadExample = () => {
    touch(configToText(buildSample()));
  };

  const allIssues = [...fileIssues, ...validation.issues];

  return (
    <div className="app">
      <header className="app-header">
        <h1>深空尾咬合卷积码 · 本地译码复核台</h1>
        <p>
          全部计算在浏览器本地完成。约束：状态转移 <code>next=((state&lt;&lt;1)|bit)&amp;mask</code>，
          输出位为生成多项式与未截断寄存器字的奇偶校验；初态必须等于末态，精确最小化总符号代价。
        </p>
      </header>

      <div className="layout">
        <div>
          <section className="panel">
            <h2>① 参数与代价表</h2>
            <div className="row">
              <div className="field">
                <label htmlFor="memory">
                  记忆阶数 m <span className="hint">（1–6，状态数 2^m）</span>
                </label>
                <input
                  id="memory"
                  type="number"
                  min={1}
                  max={6}
                  value={raw.memoryText}
                  onChange={(e) => touch({ ...raw, memoryText: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="polys">
                  生成多项式 <span className="hint">（2–3 个；空格/逗号分隔，默认八进制，如 133 171）</span>
                </label>
                <input
                  id="polys"
                  type="text"
                  spellCheck={false}
                  value={raw.polynomialsText}
                  onChange={(e) => touch({ ...raw, polynomialsText: e.target.value })}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="costs">
                符号代价表 <span className="hint">
                  （每步一行、2 个多项式→4 列，3 个→8 列；逗号或空白分隔；整数 0–1,000,000；步数 8–512）
                </span>
              </label>
              <textarea
                id="costs"
                spellCheck={false}
                value={raw.costsText}
                onChange={(e) => touch({ ...raw, costsText: e.target.value })}
              />
            </div>

            <div className="btn-row">
              <button
                className="primary"
                disabled={validation.issues.length > 0 || decoding}
                onClick={runDecode}
              >
                {decoding ? '译码中…' : '② 启动译码'}
              </button>
              <label className="file-label" style={{ margin: 0 }}>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportFile(f);
                    e.target.value = '';
                  }}
                />
                导入 JSON
              </label>
              <button onClick={exportConfig} disabled={validation.issues.length > 0}>
                导出 JSON
              </button>
              <button onClick={loadExample}>载入示例</button>
            </div>

            {allIssues.length > 0 && (
              <div className="issues">
                <h3>校验失败 · 共 {allIssues.length} 处（旧结果已撤下）</h3>
                {allIssues.map((iss, i) => (
                  <div className="issue" key={i}>
                    {iss.line !== undefined && (
                      <span className="loc">
                        [代价表第 {iss.line} 行{iss.column !== undefined ? ` 第 ${iss.column + 1} 列` : ''}]
                      </span>
                    )}
                    {iss.scope === 'polynomial' && iss.index !== undefined && (
                      <span className="loc">[多项式 {iss.index + 1}]</span>
                    )}
                    {iss.scope === 'memory' && <span className="loc">[记忆阶数]</span>}
                    {iss.scope === 'file' && <span className="loc">[导入文件]</span>}
                    {iss.message}
                  </div>
                ))}
              </div>
            )}
            {allIssues.length === 0 && (
              <div className="ok-box">
                ✓ 输入合法：{validation.config?.costs.length} 步 ×{' '}
                {1 << (validation.config?.polynomials.length ?? 0)} 个符号 ·{' '}
                {1 << (validation.config?.memory ?? 0)} 个状态，可启动译码。
              </div>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <h2>③ 译码结果与时间轴复核</h2>
            {stale && (
              <div className="stale-note">
                输入已被修改或校验未通过，旧的译码结果已撤下。修正输入后重新启动译码。
              </div>
            )}
            {!visibleDecoded && !stale && (
              <div className="ok-box" style={{ color: 'var(--muted)' }}>
                尚无译码结果。配置合法后点击“启动译码”。
              </div>
            )}
            {visibleDecoded && <ResultView result={visibleDecoded.result} />}
          </section>
        </div>
      </div>

      <div className="footer-note">
        尾咬合（tail-biting）译码 · 初态=末态闭合约束 · 精确最优（枚举初态的 Viterbi，BigInt 字典序微扰）· 纯前端离线运行
      </div>
    </div>
  );
}
