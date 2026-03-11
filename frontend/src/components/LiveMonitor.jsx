import React, { useState, useEffect, useRef } from 'react';
import { streamTest, cancelTest, getRunResults } from '../utils/api';
import MetricCard from './MetricCard';
import PercentileChart from './PercentileChart';
import LatencyScatter from './LatencyScatter';
import LatencyBreakdown from './LatencyBreakdown';
import ThroughputPanel from './ThroughputPanel';
import ErrorAnalysis from './ErrorAnalysis';
import PerUserTable from './PerUserTable';
import PerQuestionTable from './PerQuestionTable';
import ConcurrencyCurve from './ConcurrencyCurve';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fmt, fmtTooltip, fmtAxis } from '../utils/format';

export default function LiveMonitor({ runId, spaceId, onComplete }) {
  const [progress, setProgress] = useState(null);
  const [liveLatencies, setLiveLatencies] = useState([]);
  const [finalResults, setFinalResults] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [activeTab, setActiveTab] = useState('overview');
  const esRef = useRef(null);

  useEffect(() => {
    if (!runId) return;

    const es = streamTest(
      runId,
      (data) => {
        setStatus('running');
        setProgress(data);
        if (data.new_results) {
          setLiveLatencies(prev => [
            ...prev,
            ...data.new_results.map(r => ({
              index: prev.length + data.new_results.indexOf(r),
              latency: r.latency_ms,
              status: r.status,
              type: r.request_type,
              user: r.user_id,
            })),
          ]);
        }
      },
      async (data) => {
        setStatus(data.status);
        try {
          const results = await getRunResults(runId);
          setFinalResults(results);
          onComplete?.(results);
        } catch (e) {
          console.error('Failed to load final results', e);
        }
      },
      (err) => {
        setStatus('error');
      }
    );
    esRef.current = es;

    return () => es?.close();
  }, [runId]);

  async function handleCancel() {
    await cancelTest(runId);
    esRef.current?.close();
    setStatus('cancelled');
  }

  const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0;
  const isRunning = status === 'running';
  const isDone = ['completed', 'failed', 'cancelled'].includes(status);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'breakdown', label: 'Latency Breakdown' },
    { id: 'errors', label: 'Errors & Retries' },
    { id: 'users', label: 'Per User' },
    { id: 'questions', label: 'Per Question' },
    { id: 'log', label: 'Request Log' },
  ];

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${
              isRunning ? 'bg-green-500 animate-pulse' :
              status === 'completed' ? 'bg-blue-500' :
              'bg-red-500'
            }`} />
            <span className="text-sm font-medium text-gray-300 uppercase tracking-wider">
              {status}
            </span>
            <span className="text-xs text-gray-500 font-mono">{runId?.slice(0, 8)}</span>
            {spaceId && (
              <span className="text-xs text-gray-500">
                Space <span className="font-mono">{spaceId.slice(0, 12)}</span>
              </span>
            )}
          </div>
          {isRunning && (
            <button
              onClick={handleCancel}
              className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{progress?.completed ?? 0} / {progress?.total ?? 0} requests</span>
          <span>{pct}%</span>
        </div>
      </div>

      {/* Live metrics */}
      {progress && (
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Completed" value={progress.completed} unit="" color="blue" />
          <MetricCard label="Successful" value={progress.successful} unit="" color="green" />
          <MetricCard label="Failed" value={progress.failed} unit="" color="red" />
        </div>
      )}

      {/* Live latency stream */}
      {liveLatencies.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Live Latency</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={liveLatencies.slice(-100)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="index" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={fmtAxis} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                itemStyle={{ color: '#d1d5db' }}
                labelStyle={{ color: '#e5e7eb' }}
                formatter={fmtTooltip}
              />
              <Line type="monotone" dataKey="latency" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Final results with tabs */}
      {isDone && finalResults && (
        <>
          {/* Tab navigation */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === t.id
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <MetricCard label="Avg Latency" value={finalResults.overall?.avg_ms} dualTime color="blue" subtitle="Mean end-to-end response time" />
                <MetricCard label="Stddev" value={finalResults.overall?.stddev_ms} dualTime color="gray" subtitle="Lower = more consistent performance" />
                <MetricCard label="P50" value={finalResults.overall?.p50} dualTime color="purple" subtitle="Half of requests faster than this" />
                <MetricCard label="P90" value={finalResults.overall?.p90} dualTime color="yellow" subtitle="90% of requests faster than this" />
                <MetricCard label="P99" value={finalResults.overall?.p99} dualTime color="red" subtitle="Worst-case excluding outliers" />
              </div>

              <ThroughputPanel throughput={finalResults.throughput} />

              <ConcurrencyCurve data={finalResults.concurrency_curve} title="Latency Over Time (10s buckets)" subtitle="How latency changes as the test progresses" />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <PercentileChart data={finalResults.overall} title="Overall Latency Percentiles" />
                {finalResults.by_type?.map(bt => (
                  <PercentileChart
                    key={bt.request_type}
                    data={bt}
                    title={`${bt.request_type} Percentiles`}
                  />
                ))}
              </div>

              <LatencyScatter requests={finalResults.requests} title="Latency Over Time" />
            </>
          )}

          {/* Latency Breakdown tab */}
          {activeTab === 'breakdown' && (
            <LatencyBreakdown data={finalResults.latency_breakdown} />
          )}

          {/* Error Analysis tab */}
          {activeTab === 'errors' && (
            <ErrorAnalysis errorBreakdown={finalResults.error_breakdown} />
          )}

          {/* Per-User tab */}
          {activeTab === 'users' && (
            <PerUserTable perUser={finalResults.per_user} />
          )}

          {/* Per-Question tab */}
          {activeTab === 'questions' && (
            <PerQuestionTable perQuestion={finalResults.per_question} />
          )}

          {/* Request Log tab */}
          {activeTab === 'log' && (
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">
                Request Log ({finalResults.requests?.length})
              </h3>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase sticky top-0 bg-gray-900">
                    <tr>
                      <th className="text-left p-2">User</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Question</th>
                      <th className="text-right p-2">Total</th>
                      <th className="text-right p-2">TTFR</th>
                      <th className="text-right p-2">Polling</th>
                      <th className="text-right p-2">Retries</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-400">
                    {finalResults.requests?.map(r => (
                      <tr key={r.request_id} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                        <td className="p-2 font-mono">{r.virtual_user_id}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            r.request_type === 'start_conversation'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {r.request_type === 'start_conversation' ? 'START' : 'MSG'}
                          </span>
                        </td>
                        <td className="p-2 max-w-[250px] truncate">{r.question}</td>
                        <td className="p-2 text-right font-mono font-bold">
                          {r.latency_ms ? fmt(r.latency_ms) : '—'}
                        </td>
                        <td className="p-2 text-right font-mono text-cyan-400">
                          {r.ttfr_ms ? fmt(r.ttfr_ms) : '—'}
                        </td>
                        <td className="p-2 text-right font-mono text-amber-400">
                          {r.polling_ms ? fmt(r.polling_ms) : '—'}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {r.retry_count > 0 ? r.retry_count : ''}
                        </td>
                        <td className="p-2">
                          <span className={`${
                            r.status === 'completed' ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
