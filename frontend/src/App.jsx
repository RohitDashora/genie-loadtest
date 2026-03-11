import React, { useState } from 'react';
import { startTest } from './utils/api';
import QuestionBank from './components/QuestionBank';
import LiveMonitor from './components/LiveMonitor';
import RunHistory from './components/RunHistory';
import { Zap, History, MessageSquare, Play, Settings } from 'lucide-react';
import HelpTip from './components/HelpTip';

const TABS = [
  { id: 'test', label: 'Load Test', icon: Zap },
  { id: 'history', label: 'History', icon: History },
];

export default function App() {
  const [tab, setTab] = useState('test');
  const [spaceId, setSpaceId] = useState('');
  const [numUsers, setNumUsers] = useState(10);
  const [questionsPerUser, setQuestionsPerUser] = useState(5);
  const [thinkTimeMin, setThinkTimeMin] = useState(2);
  const [thinkTimeMax, setThinkTimeMax] = useState(10);
  const [maxRetries, setMaxRetries] = useState(5);
  const [retryBaseDelay, setRetryBaseDelay] = useState(2);
  const [pollInterval, setPollInterval] = useState(2);
  const [maxPollTime, setMaxPollTime] = useState(300);
  const [activeRunId, setActiveRunId] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);

  async function handleStart() {
    if (!spaceId.trim()) {
      setError('Please enter a Genie Space ID');
      return;
    }
    setError(null);
    try {
      const { run_id } = await startTest({
        genie_space_id: spaceId.trim(),
        num_users: numUsers,
        questions_per_user: questionsPerUser,
        think_time_min_sec: thinkTimeMin,
        think_time_max_sec: thinkTimeMax,
        max_retries: maxRetries,
        retry_base_delay: retryBaseDelay,
        poll_interval_sec: pollInterval,
        max_poll_time_sec: maxPollTime,
      });
      setActiveRunId(run_id);
      setIsRunning(true);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🧞</div>
            <div>
              <h1 className="text-lg font-bold text-white">Genie Load Tester</h1>
              <p className="text-xs text-gray-500">Benchmark Genie API concurrency & latency</p>
            </div>
          </div>
          <div className="flex gap-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                <t.icon size={14} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'test' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left panel: Config */}
            <div className="space-y-6">
              {/* Space ID */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Settings size={14} /> Configuration
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Genie Space ID <HelpTip text="The ID from your Genie Space URL or settings page" /></label>
                    <input
                      type="text"
                      value={spaceId}
                      onChange={e => setSpaceId(e.target.value)}
                      placeholder="Paste your Genie Space ID..."
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      Virtual Users: <span className="text-blue-400 font-bold">{numUsers}</span> <HelpTip text="Number of concurrent simulated users sending questions in parallel" />
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={numUsers}
                      onChange={e => setNumUsers(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>1</span><span>25</span><span>50</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      Questions per User: <span className="text-blue-400 font-bold">{questionsPerUser}</span> <HelpTip text="How many questions each virtual user sends sequentially in one conversation" />
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={questionsPerUser}
                      onChange={e => setQuestionsPerUser(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Think Time Min (s) <HelpTip text="Minimum random pause between questions to simulate real user reading time" /></label>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        step={0.5}
                        value={thinkTimeMin}
                        onChange={e => setThinkTimeMin(Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Think Time Max (s) <HelpTip text="Maximum random pause between questions to simulate real user reading time" /></label>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        step={0.5}
                        value={thinkTimeMax}
                        onChange={e => setThinkTimeMax(Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">
                        Max Retries: <span className="text-blue-400 font-bold">{maxRetries}</span> <HelpTip text="How many times to retry on HTTP 429 rate limit errors before giving up" />
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        value={maxRetries}
                        onChange={e => setMaxRetries(Number(e.target.value))}
                        className="w-full accent-blue-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span>0</span><span>5</span><span>10</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Base Delay (s) <HelpTip text="Starting backoff delay for retries; doubles each attempt (exponential backoff)" /></label>
                      <input
                        type="number"
                        min={0.5}
                        max={30}
                        step={0.5}
                        value={retryBaseDelay}
                        onChange={e => setRetryBaseDelay(Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                      <div className="text-[10px] text-gray-500 mt-1">
                        Delays: {Array.from({length: maxRetries}, (_, i) => `${retryBaseDelay * (2 ** i)}s`).join(', ') || 'none'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Poll Interval (s) <HelpTip text="How often to check if Genie has finished answering (lower = more API calls)" /></label>
                      <input
                        type="number"
                        min={0.5}
                        max={10}
                        step={0.5}
                        value={pollInterval}
                        onChange={e => setPollInterval(Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Poll Timeout (s) <HelpTip text="Maximum time to wait for a single answer before marking it as timeout" /></label>
                      <input
                        type="number"
                        min={30}
                        max={600}
                        step={30}
                        value={maxPollTime}
                        onChange={e => setMaxPollTime(Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleStart}
                    disabled={isRunning}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      isRunning
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg shadow-blue-500/20'
                    }`}
                  >
                    <Play size={14} />
                    {isRunning ? 'Test Running...' : 'Start Load Test'}
                  </button>
                </div>
              </div>

              {/* Question Bank */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <MessageSquare size={14} /> Question Bank
                </h2>
                <QuestionBank spaceId={spaceId} />
              </div>
            </div>

            {/* Right panel: Live monitor */}
            <div className="lg:col-span-2">
              {activeRunId ? (
                <LiveMonitor
                  runId={activeRunId}
                  spaceId={spaceId}
                  onComplete={() => setIsRunning(false)}
                />
              ) : (
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-12 text-center">
                  <div className="text-4xl mb-3">🧞</div>
                  <p className="text-gray-500 text-sm">
                    Configure your test and add questions, then click Start Load Test.
                  </p>
                  <p className="text-gray-600 text-xs mt-2">
                    Results will appear here in real-time via SSE.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'history' && <RunHistory />}
      </main>
    </div>
  );
}
