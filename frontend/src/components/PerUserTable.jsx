import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmt, fmtTooltip, fmtAxis } from '../utils/format';

export default function PerUserTable({ perUser }) {
  if (!perUser || perUser.length === 0) return null;

  const chartData = perUser.map(u => ({
    name: `User ${u.virtual_user_id}`,
    'Avg Latency': Number(u.avg_latency_ms) || 0,
    'Avg TTFR': Number(u.avg_ttfr_ms) || 0,
    'Avg Polling': Number(u.avg_polling_ms) || 0,
  }));

  const slowest = [...perUser].sort((a, b) => (b.avg_latency_ms || 0) - (a.avg_latency_ms || 0))[0];
  const fastest = [...perUser].sort((a, b) => (a.avg_latency_ms || 0) - (b.avg_latency_ms || 0))[0];

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">Per-User Metrics</h3>
      <p className="text-xs text-gray-500 mb-2">Check for outlier users hitting rate limits</p>
      <div className="flex gap-4 text-xs text-gray-500 mb-4">
        <span>Fastest: <span className="text-emerald-400 font-mono">User {fastest?.virtual_user_id}</span> ({fmt(fastest?.avg_latency_ms)})</span>
        <span>Slowest: <span className="text-red-400 font-mono">User {slowest?.virtual_user_id}</span> ({fmt(slowest?.avg_latency_ms)})</span>
      </div>

      {perUser.length <= 20 && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtAxis} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
              itemStyle={{ color: '#d1d5db' }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={fmtTooltip}
            />
            <Legend wrapperStyle={{ color: '#9ca3af' }} />
            <Bar dataKey="Avg TTFR" stackId="a" fill="#06b6d4" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Avg Polling" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      <div className="overflow-x-auto mt-4 max-h-[300px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500 uppercase sticky top-0 bg-gray-900">
            <tr>
              <th className="text-left p-2">User</th>
              <th className="text-right p-2">Total</th>
              <th className="text-right p-2">Ok</th>
              <th className="text-right p-2">Fail</th>
              <th className="text-right p-2">Avg Latency</th>
              <th className="text-right p-2">TTFR</th>
              <th className="text-right p-2">Polling</th>
              <th className="text-right p-2">Min</th>
              <th className="text-right p-2">Max</th>
              <th className="text-right p-2">Retries</th>
              <th className="text-right p-2">Backoff</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {perUser.map(u => {
              const sr = u.total_requests > 0
                ? ((u.successful / u.total_requests) * 100).toFixed(0) : 0;
              return (
                <tr key={u.virtual_user_id} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                  <td className="p-2 font-mono font-medium">User {u.virtual_user_id}</td>
                  <td className="p-2 text-right font-mono">{u.total_requests}</td>
                  <td className="p-2 text-right font-mono text-emerald-400">{u.successful}</td>
                  <td className="p-2 text-right font-mono text-red-400">{u.failed > 0 ? u.failed : ''}</td>
                  <td className="p-2 text-right font-mono font-bold">{fmt(u.avg_latency_ms)}</td>
                  <td className="p-2 text-right font-mono text-cyan-400">{fmt(u.avg_ttfr_ms)}</td>
                  <td className="p-2 text-right font-mono text-amber-400">{fmt(u.avg_polling_ms)}</td>
                  <td className="p-2 text-right font-mono text-gray-500">{fmt(u.min_latency_ms)}</td>
                  <td className="p-2 text-right font-mono text-gray-500">{fmt(u.max_latency_ms)}</td>
                  <td className="p-2 text-right font-mono">{u.total_retries > 0 ? u.total_retries : ''}</td>
                  <td className="p-2 text-right font-mono">{u.total_backoff_ms > 0 ? fmt(u.total_backoff_ms) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
