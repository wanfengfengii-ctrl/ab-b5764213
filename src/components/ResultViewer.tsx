import { useMemo, useState } from 'react';
import type { DecodeResult } from '../lib/types';

interface Props {
  result: DecodeResult;
}

function octal(n: number, width: number) {
  return n.toString(2).padStart(width, '0');
}

function BitString({ bits, diffAgainst, tone }: { bits: number[]; diffAgainst?: number[] | null; tone: 'primary' | 'alt' }) {
  return (
    <div className="bitstring">
      {bits.map((b, i) => {
        const diff = diffAgainst && diffAgainst[i] !== b;
        return (
          <span
            key={i}
            className={
              (b === 1 ? 'bit1' : 'bit0') + (diff ? ' diff' : '')
            }
            title={`t=${i}, bit=${b}${diff ? '（与主结果不同）' : ''}`}
            style={tone === 'alt' && b === 1 ? { color: 'var(--alt)' } : undefined}
          >
            {b}
          </span>
        );
      })}
    </div>
  );
}

export function ResultViewer({ result }: Props) {
  const [page, setPage] = useState(0);
  const [showAlt, setShowAlt] = useState(false);
  const pageSize = 64;
  const pages = Math.ceil(result.stepCount / pageSize);
  const p = result.primary;
  const a = result.alternate;

  const witness = showAlt && a ? a : p;
  const slice = useMemo(() => {
    const lo = page * pageSize;
    return witness.trace.slice(lo, lo + pageSize);
  }, [witness, page]);

  const regWidth = result.memory + 1;

  return (
    <section className="panel">
      <h2>③ 译码结果与时间轴复核</h2>

      <div className="summary-grid">
        <div className="stat">
          <div className="k">步数 L</div>
          <div className="v">{result.stepCount}</div>
        </div>
        <div className="stat">
          <div className="k">状态数 2^m</div>
          <div className="v">{1 << result.memory}</div>
        </div>
        <div className="stat">
          <div className="k">输出符号数 2^G</div>
          <div className="v">{result.symbolCount}</div>
        </div>
        <div className="stat">
          <div className="k">最优总代价</div>
          <div className="v" style={{ color: 'var(--ok)' }}>{p.totalCost}</div>
        </div>
        <div className="stat">
          <div className="k">最优解</div>
          <div className="v">
            {result.unique ? (
              <span className="badge ok">唯一</span>
            ) : (
              <span className="badge warn">存在并列</span>
            )}
          </div>
        </div>
        <div className="stat">
          <div className="k">主结果初态 = 末态</div>
          <div className="v">{p.startState}（{octal(p.startState, result.memory)}）</div>
        </div>
      </div>

      <div className="witness-box">
        <div className="flex-between">
          <strong>
            <span className="badge info">主结果</span> 字典序最小的最优路径
          </strong>
          <span className="hint">
            输入位串（共 {p.bits.length} 位）；紫色底纹标记与并列见证不同的位置
          </span>
        </div>
        <div style={{ height: 8 }} />
        <BitString bits={p.bits} diffAgainst={a?.bits} tone="primary" />
      </div>

      {a ? (
        <div className="witness-box alt">
          <div className="flex-between">
            <strong>
              <span className="badge alt">并列见证</span> 另一条总代价同为 {a.totalCost} 的完整路径
            </strong>
            <span className="hint">
              初态 = 末态 = {a.startState}（{octal(a.startState, result.memory)}）
            </span>
          </div>
          <div style={{ height: 8 }} />
          <BitString bits={a.bits} diffAgainst={p.bits} tone="alt" />
        </div>
      ) : (
        <p className="hint">不存在第二条总代价相同的闭合路径 —— 最优解唯一。</p>
      )}

      <h3>逐起始状态闭合最小代价</h3>
      <p className="hint">
        对每个候选起始状态 s 独立做 Viterbi 并要求末态回到 s；绿色行为达到全局最优的起始状态。
      </p>
      <div className="timeline-wrap" style={{ maxHeight: 220 }}>
        <table className="grid states-table">
          <thead>
            <tr>
              <th>起始状态 s</th>
              <th>二进制</th>
              <th>闭合最小代价</th>
              <th>达到全局最优</th>
            </tr>
          </thead>
          <tbody>
            {result.closedCosts.map((c, s) => (
              <tr key={s} className={c === p.totalCost ? 'optimal-state' : ''}>
                <td>{s}</td>
                <td>{octal(s, result.memory)}</td>
                <td className="num">{Number.isFinite(c) ? c : '∞'}</td>
                <td>{c === p.totalCost ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>时间轴逐步复核</h3>
      <div className="tabs">
        <button className={!showAlt ? 'active' : ''} onClick={() => { setShowAlt(false); setPage(0); }}>
          主结果轨迹
        </button>
        {a && (
          <button className={showAlt ? 'active' : ''} onClick={() => { setShowAlt(true); setPage(0); }}>
            并列见证轨迹
          </button>
        )}
      </div>

      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage((x) => Math.max(0, x - 1))}>← 上一页</button>
        <button disabled={page >= pages - 1} onClick={() => setPage((x) => Math.min(pages - 1, x + 1))}>下一页 →</button>
        <span className="hint">第 {page + 1}/{pages} 页（每页 {pageSize} 步）</span>
      </div>

      <div className="timeline-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>t</th>
              <th>输入位</th>
              <th>prev 状态</th>
              <th>寄存器字</th>
              <th>输出位 ({result.generators.map((g) => g.toString(8)).join(',')})</th>
              <th>编码符号</th>
              <th>next 状态</th>
              <th>单步代价</th>
              <th>累计代价</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const diffBit = showAlt && a && p.bits[r.t] !== a.bits[r.t];
              return (
                <tr key={r.t} className={diffBit ? 'diff-row' : ''}>
                  <td>{r.t}</td>
                  <td style={{ color: r.bit ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}>{r.bit}</td>
                  <td>{r.prevState} ({octal(r.prevState, result.memory)})</td>
                  <td>
                    {r.registerWord} ({octal(r.registerWord, regWidth)})
                  </td>
                  <td>{r.outputBits.join('')}</td>
                  <td>{r.symbol} ({octal(r.symbol, result.generators.length)})</td>
                  <td>{r.nextState} ({octal(r.nextState, result.memory)})</td>
                  <td className="num">{r.stepCost}</td>
                  <td className="num">{r.cumCost}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        校验：第 0 行 prev 状态 = 第 {result.stepCount - 1} 行 next 状态 = {witness.startState}；
        末行累计代价 = {witness.totalCost}。
      </p>
    </section>
  );
}
