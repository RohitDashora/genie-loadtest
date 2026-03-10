import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { fmtTooltip, fmtAxis } from '../utils/format';

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];

export default function PercentileChart({ data, title }) {
  if (!data) return null;

  const chartData = [
    { name: 'P30', value: data.p30 },
    { name: 'P50', value: data.p50 },
    { name: 'P60', value: data.p60 },
    { name: 'P80', value: data.p80 },
    { name: 'P90', value: data.p90 },
    { name: 'P99', value: data.p99 },
  ].filter(d => d.value != null);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
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
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
