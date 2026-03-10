import React from 'react';
import MetricCard from './MetricCard';
import { fmt } from '../utils/format';

export default function ThroughputPanel({ throughput }) {
  if (!throughput) return null;

  const successRate = throughput.total_requests > 0
    ? ((throughput.successful / throughput.total_requests) * 100).toFixed(1)
    : 0;

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">Throughput</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Duration"
          value={throughput.duration_sec}
          unit="sec"
          color="blue"
          subtitle={throughput.duration_sec >= 60 ? `${(throughput.duration_sec / 60).toFixed(1)} min` : null}
        />
        <MetricCard
          label="Requests/Min"
          value={throughput.requests_per_min}
          unit="rpm"
          color="cyan"
        />
        <MetricCard
          label="Success/Min"
          value={throughput.successful_per_min}
          unit="rpm"
          color="green"
          subtitle={`${successRate}% success rate`}
        />
        <MetricCard
          label="Total Backoff"
          value={throughput.total_backoff_ms}
          dualTime
          color="orange"
          subtitle={`Avg ${fmt(throughput.avg_backoff_ms)}/req`}
        />
      </div>
    </div>
  );
}
