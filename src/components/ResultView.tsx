import { useState } from 'react';
import { type DecodedPath, type SolveResult, toBin } from '../lib/codec';

function BitString({ bits }: { bits: number[] }) {
  return (
    <div className="bitstring" aria-label="输入位串">
      {bits.map((b, i) => (
        <span key={i} className={`bit ${b === 1 ? 'one' : ''}`}>
          {b}
        </span>
      ))}
    </div>
  );
}

function TimelineTable({ path, memory, k }: { path: DecodedPath; memory: number; k: number }) {
  return (
    <div className="table-wrap">
      <table className="timeline">
        <thead>
          <tr>
            <th>时刻 t</th>
            <th>输入位</th>
            <th>初态 s(t)</th>
            <th>未截断字</th>
            <th>校验输出</th>
            <th>符号(十进制)</th>
            <th>单步代价</th>
            <th>累计代价</th>
            <th>次态 s(t+1)</th>
          </tr>
        </thead>
        <tbody>
          {path.steps.map((d) => {
            const isLast = d.t === path.steps.length - 1;
            const closed = isLast && d.nextState === path.startState;
            return (
              <tr key={d.t} className={closed ? 'closure' : ''}>
                <td className="left">{d.t}</td>
                <td className={`bitcell-${d.bit}`}>{d.bit}</td>
                <td>{toBin(d.prevState, memory)} ({d.prevState})</td>
                <td>{toBin(d.word, memory + 1)}</td>
                <td>{d.parityBits}</td>
                <td>
                  {toBin(d.symbol, k)} ({d.symbol})
                </td>
                <td>{d.stepCost}</td>
                <td>{d.cumulative}</td>
                <td>
                  {toBin(d.nextState, memory)} ({d.nextState})
                  {closed ? ' ✓ 回到初态' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StepInspector({ path, memory, k }: { path: DecodedPath; memory: number; k: number }) {
  const [t, setT] = useState(0);
  const d = path.steps[t];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setT((v) => Math.max(0, v - 1))} disabled={t === 0}>
          ← 上一步
        </button>
        <input
          type="range"
          min={0}
          max={path.steps.length - 1}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
          style={{ flex: 1, minWidth: 200 }}
          aria-label="时间轴游标"
        />
        <button
          onClick={() => setT((v) => Math.min(path.steps.length - 1, v + 1))}
          disabled={t === path.steps.length - 1}
        >
          下一步 →
        </button>
        <span className="chip">t = <b>{d.t}</b></span>
      </div>
      <div className="stat-strip">
        <span className="chip">输入位 <b>{d.bit}</b></span>
        <span className="chip">初态 <b>{toBin(d.prevState, memory)} ({d.prevState})</b></span>
        <span className="chip">未截断字 <b>{toBin(d.word, memory + 1)}</b></span>
        <span className="chip">校验 <b>{d.parityBits}</b></span>
        <span className="chip">符号 <b>{toBin(d.symbol, k)} ({d.symbol})</b></span>
        <span className="chip">单步代价 <b>{d.stepCost}</b></span>
        <span className="chip">累计 <b>{d.cumulative}</b></span>
        <span className="chip">次态 <b>{toBin(d.nextState, memory)} ({d.nextState})</b></span>
      </div>
    </div>
  );
}

function PathPanel({
  result,
  path,
  title,
  tone,
}: {
  result: SolveResult;
  path: DecodedPath;
  title: string;
  tone: 'primary' | 'alt';
}) {
  const m = result.memory;
  const k = result.polynomials.length;
  const last = path.steps[path.steps.length - 1];
  return (
    <div>
      <div className="summary-grid">
        <div className="stat-card">
          <div className="k">{title}：初态（=末态）</div>
          <div className="v">
            {toBin(path.startState, m)} ({path.startState})
          </div>
        </div>
        <div className="stat-card">
          <div className="k">总代价</div>
          <div className="v">{path.totalCost}</div>
        </div>
        <div className="stat-card">
          <div className="k">步数</div>
          <div className="v">{path.steps.length}</div>
        </div>
        <div className="stat-card">
          <div className="k">末步次态</div>
          <div className="v">
            {toBin(last.nextState, m)} ({last.nextState})
          </div>
        </div>
        {tone === 'primary' && (
          <div className="stat-card">
            <div className="k">最优是否唯一</div>
            <div className={`v ${result.unique ? 'uniq-yes' : 'uniq-no'}`}>
              {result.unique ? '唯一' : '存在并列'}
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <label>输入位串 b{tone === 'alt' ? '（并列见证）' : ''}（共 {path.bits.length} 位）</label>
        <BitString bits={path.bits} />
      </div>

      <StepInspector path={path} memory={m} k={k} />
      <TimelineTable path={path} memory={m} k={k} />
    </div>
  );
}

export function ResultView({ result }: { result: SolveResult }) {
  const [tab, setTab] = useState<'primary' | 'alternate'>('primary');
  return (
    <div>
      <div className="stat-strip">
        <span className="chip">m = <b>{result.memory}</b></span>
        <span className="chip">
          多项式 <b>{result.polynomials.map((p) => '0o' + p.toString(8)).join(' ')}</b>
        </span>
        <span className="chip">状态数 <b>{result.numStates}</b></span>
        <span className="chip">符号数 <b>{result.numSymbols}</b></span>
        <span className="chip">时间步 <b>{result.length}</b></span>
      </div>

      {!result.unique && (
        <div className="tabs">
          <button className={tab === 'primary' ? 'active' : ''} onClick={() => setTab('primary')}>
            主结果（字典序最小）
          </button>
          <button className={tab === 'alternate' ? 'active' : ''} onClick={() => setTab('alternate')}>
            并列最优见证（另一条）
          </button>
        </div>
      )}

      {tab === 'primary' || result.unique ? (
        <PathPanel result={result} path={result.optimal} title="主结果" tone="primary" />
      ) : (
        <div className="alt-box">
          <h3>并列最优：字典序最小的另一条完整闭合见证</h3>
          <div className="meta">
            与主结果总代价相同（{result.alternate!.totalCost}），但输入位串不同；展示的是所有异于
            主结果的并列解中字典序最小者。
          </div>
          <PathPanel result={result} path={result.alternate!} title="并列见证" tone="alt" />
        </div>
      )}
    </div>
  );
}
