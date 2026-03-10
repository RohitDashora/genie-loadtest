import React, { useState, useEffect } from 'react';
import { listRuns, compareRuns, getRunResults } from '../utils/api';
import CompareChart from './CompareChart';
import PercentileChart from './PercentileChart';
import LatencyScatter from './LatencyScatter';
import LatencyBreakdown from './LatencyBreakdown';
import ThroughputPanel from './ThroughputPanel';
import ErrorAnalysis from './ErrorAnalysis';
import PerUserTable from './PerUserTable';
import PerQuestionTable from './PerQuestionTable';
import MetricCard from './MetricCard';
import { GitCompare, RotateCcw, Clock, Users, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function StatusIcon({ status }) {
  if (status === 'completed') return <CheckCircle size={12} className="text-emerald-400" />;
  if (status === 'running') return <RotateCcw size={12} className="text-blue-400 animate-spin" />;
  if (status === 'cancelled') return <AlertCircle size={12} className="text-yellow-400" />;
  return <XCircle size={12} className="text-red-400" />;
}

export default function RunHistory() {
  const [runs, setRuns] = useState([]);
  const [checked, setChecked] = useState(new Set());
  const [compareData, setCompareData] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [viewTab, setViewTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('detail'); // 'detail' or 'compare'

  useEffect(() => {
    loadRuns();
  }, []);

  async function loadRuns() {
    const data = await listRuns();
    setRuns(data);
  }

  function toggleCheck(e, runId) {
    e.stopPropagation();
    const next = new Set(checked);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    setChecked(next);
    // Exit compare mode if fewer than 2 checked
    if (next.size < 2 && mode === 'compare') {
      setMode('detail');
      setCompareData(null);
    }
  }

  async function handleCompare() {
    if (checked.size < 2) return;
    setMode('compare');
    setCompareData(null);
    const data = await compareRuns([...checked]);
    setCompareData(data);
  }

  async function handleSelectRun(runId) {
    if (activeRunId === runId && mode === 'detail') return;
    setMode('detail');
    setActiveRunId(runId);
    setViewData(null);
    setViewTab('overview');
    setLoading(true);
    const data = await getRunResults(runId);
    setViewData(data);
    setLoading(false);
  }

  const detailTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'breakdown', label: 'Latency Breakdown' },
    { id: 'errors', label: 'Errors & Retries' },
    { id: 'users', label: 'Per User' },
    { id: 'questions', label: 'Per Question' },
  ];

  return (
    <div className="flex gap-4 h-[calc(100vh-12rem)]">
      {/* Left panel — run list */}
      <div className="w-72 flex-shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">
            Runs ({runs.length})
          </h3>
          <button
            onClick={loadRuns}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        {/* Run list */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0">
          {runs.length === 0 ? (
            <div className="text-gray-500 text-sm py-8 text-center">No test runs yet.</div>
          ) : (
            runs.map(run => {
              const isActive = activeRunId === run.run_id && mode === 'detail';
              const isChecked = checked.has(run.run_id);
              return (
                <div
                  key={run.run_id}
                  onClick={() => handleSelectRun(run.run_id)}
                  className={`rounded-lg p-2.5 cursor-pointer transition-all border ${
                    isActive
                      ? 'bg-blue-500/10 border-blue-500/40'
                      : isChecked
                        ? 'bg-purple-500/5 border-purple-500/30'
                        : 'bg-gray-900/40 border-gray-800/50 hover:border-gray-700 hover:bg-gray-900/70'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => toggleCheck(e, run.run_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={run.status} />
                        <span className="text-xs font-mono text-gray-400 truncate">
                          {run.run_id.slice(0, 8)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                        <span className="flex items-center gap-0.5">
                          <Users size={9} />
                          {run.num_users}u x {run.questions_per_user}q
                        </span>
                        <span>
                          {run.successful_requests}/{run.total_requests}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-500">
                        <Clock size={9} />
                        {timeAgo(run.started_at)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Compare button */}
        {checked.size >= 2 && (
          <button
            onClick={handleCompare}
            className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              mode === 'compare'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600 hover:text-white border border-purple-500/30'
            }`}
          >
            <GitCompare size={14} />
            Compare {checked.size} Runs
          </button>
        )}
      </div>

      {/* Right panel — detail or compare */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {mode === 'compare' && compareData && (
          <CompareChart compareData={compareData} />
        )}

        {mode === 'compare' && !compareData && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading comparison...
          </div>
        )}

        {mode === 'detail' && !activeRunId && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a run to view details
          </div>
        )}

        {mode === 'detail' && activeRunId && loading && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading run details...
          </div>
        )}

        {mode === 'detail' && activeRunId && viewData && !loading && (
          <div className="space-y-4">
            {/* Run header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-300">
                  Run {activeRunId.slice(0, 8)}
                </h3>
                <div className="text-xs text-gray-500 mt-0.5">
                  {viewData.run?.started_at ? new Date(viewData.run.started_at).toLocaleString() : ''}
                  {' — '}
                  {viewData.run?.num_users} users x {viewData.run?.questions_per_user} q/user
                </div>
              </div>
            </div>

            {/* Detail tabs */}
            <div className="flex gap-1 overflow-x-auto pb-1 border-b border-gray-800">
              {detailTabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setViewTab(t.id)}
                  className={`px-3 py-1.5 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    viewTab === t.id
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 border-b-0'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {viewTab === 'overview' && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <MetricCard label="Avg Latency" value={viewData.overall?.avg_ms} dualTime color="blue" />
                  <MetricCard label="P50" value={viewData.overall?.p50} dualTime color="purple" />
                  <MetricCard label="P90" value={viewData.overall?.p90} dualTime color="yellow" />
                  <MetricCard label="P99" value={viewData.overall?.p99} dualTime color="red" />
                </div>
                <ThroughputPanel throughput={viewData.throughput} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <PercentileChart data={viewData.overall} title="Overall Percentiles" />
                  {viewData.by_type?.map(bt => (
                    <PercentileChart key={bt.request_type} data={bt} title={`${bt.request_type}`} />
                  ))}
                </div>
                <LatencyScatter requests={viewData.requests} title="Latency Over Time" />
              </>
            )}

            {viewTab === 'breakdown' && (
              <LatencyBreakdown data={viewData.latency_breakdown} />
            )}

            {viewTab === 'errors' && (
              <ErrorAnalysis errorBreakdown={viewData.error_breakdown} />
            )}

            {viewTab === 'users' && (
              <PerUserTable perUser={viewData.per_user} />
            )}

            {viewTab === 'questions' && (
              <PerQuestionTable perQuestion={viewData.per_question} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
