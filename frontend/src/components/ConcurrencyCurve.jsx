import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmtAxis, fmtTooltip } from '../utils/format';

export default function ConcurrencyCurve({ data, title = 'Latency Over Time (10s buckets)', subtitle }) {
  if (!data || data.length < 2) return null;

  const chartData = data.map(d => ({
    bucket: `${d.time_bucket_sec}s`,
    avg: Number(d.avg_latency_ms) || 0,
    p50: Number(d.p50_ms) || 0,
    p90: Number(d.p90_ms) || 0,
    requests: d.requests,
  }));

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mb-3">{subtitle}</p>}
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="bucket" tick={{ fill: '#9ca3af', fontSize: 10 }} />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtAxis} />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
            itemStyle={{ color: '#d1d5db' }}
            labelStyle={{ color: '#e5e7eb' }}
            formatter={fmtTooltip}
          />
          <Legend wrapperStyle={{ color: '#9ca3af' }} />
          <Area type="monotone" dataKey="p90" name="P90" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
          <Area type="monotone" dataKey="avg" name="Avg" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
          <Area type="monotone" dataKey="p50" name="P50" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 4" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
