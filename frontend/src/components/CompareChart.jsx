import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmtTooltip, fmtAxis } from '../utils/format';

const RUN_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function CompareChart({ compareData }) {
  if (!compareData || compareData.length < 2) return null;

  const percentiles = ['p30', 'p50', 'p60', 'p80', 'p90', 'p99'];
  const chartData = percentiles.map(p => {
    const row = { name: p.toUpperCase() };
    compareData.forEach((run, i) => {
      const label = `${run.run.num_users}u (${run.run.run_id.slice(0, 6)})`;
      row[label] = run.stats?.[p];
    });
    return row;
  });

  const barKeys = compareData.map((run, i) =>
    `${run.run.num_users}u (${run.run.run_id.slice(0, 6)})`
  );

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">Run Comparison</h3>
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
  );
}
