import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { fmt, fmtDual, fmtAxis } from '../utils/format';

// Color scale from green to red based on latency
function getBarColor(val, min, max) {
  if (max === min) return '#3b82f6';
  const ratio = (val - min) / (max - min);
  if (ratio < 0.33) return '#10b981';
  if (ratio < 0.66) return '#f59e0b';
  return '#ef4444';
}

export default function PerQuestionTable({ perQuestion }) {
  const [sortBy, setSortBy] = useState('avg_latency_ms');
  const [sortDir, setSortDir] = useState('desc');

  if (!perQuestion || perQuestion.length === 0) return null;

  const sorted = [...perQuestion].sort((a, b) => {
    const av = Number(a[sortBy]) || 0;
    const bv = Number(b[sortBy]) || 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const chartData = sorted.slice(0, 15).map((q, i) => ({
    name: `Q${i + 1}`,
    avg: Number(q.avg_latency_ms) || 0,
    question: q.question?.slice(0, 60),
  }));

  const latencies = sorted.map(q => Number(q.avg_latency_ms) || 0);
  const minLat = Math.min(...latencies);
  const maxLat = Math.max(...latencies);

  function handleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  const SortHeader = ({ col, children, align = 'right' }) => (
    <th
      className={`${align === 'left' ? 'text-left' : 'text-right'} p-2 cursor-pointer hover:text-gray-300 transition-colors select-none`}
      onClick={() => handleSort(col)}
    >
      {children}
      {sortBy === col && <span className="ml-1">{sortDir === 'desc' ? '\u2193' : '\u2191'}</span>}
    </th>
  );

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-2">Per-Question Metrics</h3>
      <p className="text-xs text-gray-500 mb-4">
        Identify slow questions that may need Genie instruction tuning
      </p>

      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtAxis} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
              itemStyle={{ color: '#d1d5db' }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(v, name, props) => [fmtDual(v), props.payload.question]}
            />
            <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={getBarColor(entry.avg, minLat, maxLat)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      <div className="overflow-x-auto mt-4 max-h-[400px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500 uppercase sticky top-0 bg-gray-900">
            <tr>
              <th className="text-left p-2 w-8">#</th>
              <th className="text-left p-2">Question</th>
              <SortHeader col="times_asked">Asked</SortHeader>
              <th className="text-right p-2">Ok/Fail</th>
              <SortHeader col="avg_latency_ms">Avg</SortHeader>
              <SortHeader col="p50_ms">P50</SortHeader>
              <SortHeader col="p90_ms">P90</SortHeader>
              <th className="text-right p-2">TTFR</th>
              <th className="text-right p-2">Polling</th>
              <th className="text-right p-2">Min</th>
              <th className="text-right p-2">Max</th>
              <th className="text-right p-2">Retries</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {sorted.map((q, i) => {
              const isHot = Number(q.avg_latency_ms) >= maxLat * 0.8;
              return (
                <tr key={i} className={`border-t border-gray-800/50 hover:bg-gray-800/30 ${isHot ? 'bg-red-500/5' : ''}`}>
                  <td className="p-2 text-gray-500 font-mono">{i + 1}</td>
                  <td className="p-2 max-w-[300px]">
                    <span className="block truncate" title={q.question}>{q.question}</span>
                  </td>
                  <td className="p-2 text-right font-mono">{q.times_asked}</td>
                  <td className="p-2 text-right font-mono">
                    <span className="text-emerald-400">{q.successful}</span>
                    {q.failed > 0 && <span className="text-red-400">/{q.failed}</span>}
                  </td>
                  <td className="p-2 text-right font-mono font-bold">
                    <span className={isHot ? 'text-red-400' : 'text-white'}>{fmtDual(q.avg_latency_ms)}</span>
                  </td>
                  <td className="p-2 text-right font-mono">{fmt(q.p50_ms)}</td>
                  <td className="p-2 text-right font-mono">{fmt(q.p90_ms)}</td>
                  <td className="p-2 text-right font-mono text-cyan-400">{fmt(q.avg_ttfr_ms)}</td>
                  <td className="p-2 text-right font-mono text-amber-400">{fmt(q.avg_polling_ms)}</td>
                  <td className="p-2 text-right font-mono text-gray-500">{fmt(q.min_ms)}</td>
                  <td className="p-2 text-right font-mono text-gray-500">{fmt(q.max_ms)}</td>
                  <td className="p-2 text-right font-mono">{q.total_retries > 0 ? q.total_retries : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
