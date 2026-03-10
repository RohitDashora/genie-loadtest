import React from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmtAxis } from '../utils/format';

export default function LatencyScatter({ requests, title }) {
  if (!requests || requests.length === 0) return null;

  const baseTime = requests[0]?.started_at ? new Date(requests[0].started_at).getTime() : 0;

  const success = requests
    .filter(r => r.status === 'completed' && r.latency_ms)
    .map(r => ({
      time: Math.round((new Date(r.started_at).getTime() - baseTime) / 1000),
      latency: Math.round(r.latency_ms),
      question: r.question?.slice(0, 60),
      user: r.virtual_user_id,
    }));

  const failed = requests
    .filter(r => r.status !== 'completed' && r.latency_ms)
    .map(r => ({
      time: Math.round((new Date(r.started_at).getTime() - baseTime) / 1000),
      latency: Math.round(r.latency_ms),
      question: r.question?.slice(0, 60),
      user: r.virtual_user_id,
    }));

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="time"
            name="Time"
            unit="s"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            label={{ value: 'Time (s)', position: 'insideBottom', offset: -2, fill: '#6b7280' }}
          />
          <YAxis
            dataKey="latency"
            name="Latency"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            tickFormatter={fmtAxis}
            label={{ value: 'Latency', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
            itemStyle={{ color: '#d1d5db' }}
            labelStyle={{ color: '#e5e7eb' }}
            formatter={(v, name) => {
              if (name === 'latency') {
                const ms = Number(v);
                return [ms >= 100 ? `${(ms/1000).toFixed(1)}s (${ms.toLocaleString()}ms)` : `${ms}ms`, 'Latency'];
              }
              return [`${v}s`, 'Time'];
            }}
            labelFormatter={() => ''}
          />
          <Legend wrapperStyle={{ color: '#9ca3af' }} />
          {success.length > 0 && (
            <Scatter name="Success" data={success} fill="#10b981" opacity={0.7} />
          )}
          {failed.length > 0 && (
            <Scatter name="Failed" data={failed} fill="#ef4444" opacity={0.7} />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
