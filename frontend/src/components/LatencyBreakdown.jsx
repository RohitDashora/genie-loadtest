import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmt, fmtTooltip, fmtAxis } from '../utils/format';

export default function LatencyBreakdown({ data }) {
  if (!data || data.length === 0) return null;

  const chartData = data.map(d => ({
    name: d.request_type === 'start_conversation' ? 'Start Conv' : 'Message',
    'TTFR (Avg)': d.avg_ttfr_ms,
    'Polling (Avg)': d.avg_polling_ms,
    'TTFR (P50)': d.p50_ttfr_ms,
    'TTFR (P90)': d.p90_ttfr_ms,
    'Polling (P50)': d.p50_polling_ms,
    'Polling (P90)': d.p90_polling_ms,
  }));

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-2">Latency Breakdown</h3>
      <p className="text-xs text-gray-500 mb-4">Time to First Response vs Polling Duration</p>

      {/* Summary table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-xs">
          <thead className="text-gray-500 uppercase">
            <tr>
              <th className="text-left p-2">Type</th>
              <th className="text-right p-2">Avg TTFR</th>
              <th className="text-right p-2">P50 TTFR</th>
              <th className="text-right p-2">P90 TTFR</th>
              <th className="text-right p-2">Avg Polling</th>
              <th className="text-right p-2">P50 Poll</th>
              <th className="text-right p-2">P90 Poll</th>
              <th className="text-right p-2">Avg Total</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {data.map(d => (
              <tr key={d.request_type} className="border-t border-gray-800/50">
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    d.request_type === 'start_conversation'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-purple-500/20 text-purple-400'
                  }`}>
                    {d.request_type === 'start_conversation' ? 'START' : 'MSG'}
                  </span>
                </td>
                <td className="p-2 text-right font-mono text-cyan-400">{fmt(d.avg_ttfr_ms)}</td>
                <td className="p-2 text-right font-mono">{fmt(d.p50_ttfr_ms)}</td>
                <td className="p-2 text-right font-mono">{fmt(d.p90_ttfr_ms)}</td>
                <td className="p-2 text-right font-mono text-amber-400">{fmt(d.avg_polling_ms)}</td>
                <td className="p-2 text-right font-mono">{fmt(d.p50_polling_ms)}</td>
                <td className="p-2 text-right font-mono">{fmt(d.p90_polling_ms)}</td>
                <td className="p-2 text-right font-mono text-white font-bold">{fmt(d.avg_total_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={fmtAxis} />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
            itemStyle={{ color: '#d1d5db' }}
            labelStyle={{ color: '#e5e7eb' }}
            formatter={fmtTooltip}
          />
          <Legend wrapperStyle={{ color: '#9ca3af' }} />
          <Bar dataKey="TTFR (Avg)" fill="#06b6d4" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Polling (Avg)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
