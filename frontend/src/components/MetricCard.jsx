import React from 'react';

function formatDual(ms) {
  if (ms == null) return { primary: '—', secondary: null };
  const val = Number(ms);
  if (val < 100) return { primary: `${Math.round(val)}ms`, secondary: null };
  return {
    primary: `${(val / 1000).toFixed(1)}s`,
    secondary: `${Math.round(val).toLocaleString()}ms`,
  };
}

export default function MetricCard({ label, value, unit = 'ms', color = 'blue', subtitle, dualTime = false }) {
  const colors = {
    blue: 'from-blue-500/20 to-blue-600/5 border-blue-500/30',
    green: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30',
    red: 'from-red-500/20 to-red-600/5 border-red-500/30',
    yellow: 'from-amber-500/20 to-amber-600/5 border-amber-500/30',
    purple: 'from-purple-500/20 to-purple-600/5 border-purple-500/30',
    cyan: 'from-cyan-500/20 to-cyan-600/5 border-cyan-500/30',
    orange: 'from-orange-500/20 to-orange-600/5 border-orange-500/30',
  };

  const textColors = {
    blue: 'text-blue-400',
    green: 'text-emerald-400',
    red: 'text-red-400',
    yellow: 'text-amber-400',
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
    orange: 'text-orange-400',
  };

  if (dualTime) {
    const { primary, secondary } = formatDual(value);
    return (
      <div className={`bg-gradient-to-br ${colors[color] || colors.blue} border rounded-xl p-4 backdrop-blur-sm`}>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${textColors[color] || textColors.blue}`}>{primary}</p>
        {secondary && <p className="text-xs text-gray-500 mt-0.5">{secondary}</p>}
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br ${colors[color] || colors.blue} border rounded-xl p-4 backdrop-blur-sm`}>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColors[color] || textColors.blue}`}>
        {value != null ? `${Number(value).toLocaleString()}` : '—'}
        {value != null && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
      </p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}
