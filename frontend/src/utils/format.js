/**
 * Format milliseconds for display. Always prefers seconds for readability.
 *
 * fmt(150)      → "0.2s"
 * fmt(1234)     → "1.2s"
 * fmt(45678)    → "45.7s"
 * fmt(null)     → "—"
 */
export function fmt(ms) {
  if (ms == null) return '—';
  const v = Number(ms);
  if (v < 100) return `${Math.round(v)}ms`;
  if (v < 10000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 1000).toFixed(0)}s`;
}

/**
 * Format with both seconds and ms for detail views.
 *
 * fmtDual(1234)  → "1.2s (1,234ms)"
 * fmtDual(45678) → "45.7s (45,678ms)"
 * fmtDual(85)    → "85ms"
 */
export function fmtDual(ms) {
  if (ms == null) return '—';
  const v = Number(ms);
  if (v < 100) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(1)}s (${Math.round(v).toLocaleString()}ms)`;
}

/**
 * Tooltip formatter for Recharts — shows seconds with ms detail.
 * Use as: formatter={fmtTooltip}
 */
export function fmtTooltip(v) {
  const ms = Number(v);
  if (ms < 100) return [`${Math.round(ms)}ms`, 'Latency'];
  return [`${(ms / 1000).toFixed(1)}s (${Math.round(ms).toLocaleString()}ms)`, 'Latency'];
}

/**
 * Y-axis tick formatter for Recharts — compact seconds.
 * Use as: tickFormatter={fmtAxis}
 */
export function fmtAxis(v) {
  const ms = Number(v);
  if (ms === 0) return '0';
  if (ms < 100) return `${Math.round(ms)}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 1000).toFixed(0)}s`;
}
