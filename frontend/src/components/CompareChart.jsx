import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmtTooltip, fmtAxis } from '../utils/format';

const RUN_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function runLabel(run) {
  return `${run.num_users}u/${run.questions_per_user}q (${run.run_id.slice(0, 6)})`;
}

export default function CompareChart({ compareData }) {
  if (!compareData || compareData.length < 2) return null;

  const percentiles = ['p30', 'p50', 'p60', 'p80', 'p90', 'p99'];
  const chartData = percentiles.map(p => {
    const row = { name: p.toUpperCase() };
    compareData.forEach((run) => {
      row[runLabel(run.run)] = run.stats?.[p];
    });
    return row;
  });

  const barKeys = compareData.map((run) => runLabel(run.run));

  const configRows = [
    { label: 'Space', fn: r => r.genie_space_id?.slice(0, 10) },
    { label: 'Users', fn: r => r.num_users },
    { label: 'Q/User', fn: r => r.questions_per_user },
    { label: 'Think Time', fn: r => `${r.think_time_min_sec ?? '?'}-${r.think_time_max_sec ?? '?'}s` },
    { label: 'Max Retries', fn: r => r.max_retries ?? '?' },
    { label: 'Base Delay', fn: r => r.retry_base_delay != null ? `${r.retry_base_delay}s` : '?' },
    { label: 'Success', fn: (r, stats) => stats?.total > 0 ? `${stats.successful}/${stats.total} (${Math.round(stats.successful / stats.total * 100)}%)` : '—' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Config Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500 uppercase">
              <tr>
                <th className="text-left p-1.5">Config</th>
                {compareData.map((d, i) => (
                  <th key={i} className="text-left p-1.5">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: RUN_COLORS[i % RUN_COLORS.length] }} />
                    {d.run.run_id.slice(0, 8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {configRows.map(row => (
                <tr key={row.label} className="border-t border-gray-800/50">
                  <td className="p-1.5 text-gray-500 font-medium">{row.label}</td>
                  {compareData.map((d, i) => (
                    <td key={i} className="p-1.5 font-mono">{row.fn(d.run, d.stats)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Latency Percentile Comparison</h3>
        <ResponsiveContainer width="100%" height={320}>
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
            {barKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={RUN_COLORS[i % RUN_COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
