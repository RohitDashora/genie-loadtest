import React from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { fmt } from '../utils/format';

const STATUS_COLORS = {
  completed: '#10b981',
  error: '#ef4444',
  failed: '#f59e0b',
  timeout: '#f97316',
  cancelled: '#6b7280',
  expired: '#8b5cf6',
};

export default function ErrorAnalysis({ errorBreakdown }) {
  if (!errorBreakdown || errorBreakdown.length === 0) return null;

  const pieData = errorBreakdown.map(e => ({
    name: e.status,
    value: Number(e.count),
  }));

  const totalRetries = errorBreakdown.reduce((s, e) => s + Number(e.total_retries || 0), 0);
  const totalBackoff = errorBreakdown.reduce((s, e) => s + Number(e.total_backoff_ms || 0), 0);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">Error Analysis</h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie chart */}
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={STATUS_COLORS[entry.name] || '#6b7280'} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
              itemStyle={{ color: '#d1d5db' }}
              labelStyle={{ color: '#e5e7eb' }}
            />
            <Legend wrapperStyle={{ color: '#9ca3af' }} />
          </PieChart>
        </ResponsiveContainer>

        {/* Status table */}
        <div>
          <table className="w-full text-xs">
            <thead className="text-gray-500 uppercase">
              <tr>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Count</th>
                <th className="text-right p-2">Avg Retries</th>
                <th className="text-right p-2">Total Retries</th>
                <th className="text-right p-2">Backoff</th>
                <th className="text-right p-2">Avg Latency</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {errorBreakdown.map(e => (
                <tr key={e.status} className="border-t border-gray-800/50">
                  <td className="p-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: STATUS_COLORS[e.status] || '#6b7280' }}
                      />
                      {e.status}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">{e.count}</td>
                  <td className="p-2 text-right font-mono">{e.avg_retries}</td>
                  <td className="p-2 text-right font-mono">{e.total_retries}</td>
                  <td className="p-2 text-right font-mono">{fmt(e.total_backoff_ms)}</td>
                  <td className="p-2 text-right font-mono">{fmt(e.avg_latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-xs text-gray-500">
            Total: {totalRetries} retries, {fmt(totalBackoff)} backoff time
          </div>
        </div>
      </div>
    </div>
  );
}
