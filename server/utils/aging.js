/**
 * Aging bucket definitions and utilities
 */

const AGING_BUCKETS = ['0-6', '6-12', '12-24', '24-36', '36-48', '48-72', '72-96', '96-120', '120+'];

/**
 * Color scheme for aging buckets (for frontend reference)
 */
const AGING_COLORS = {
  '0-6':    '#22c55e', // green
  '6-12':   '#84cc16', // lime
  '12-24':  '#eab308', // yellow
  '24-36':  '#f97316', // orange
  '36-48':  '#ef4444', // red
  '48-72':  '#dc2626', // darker red
  '72-96':  '#b91c1c', // dark red
  '96-120': '#991b1b', // very dark red
  '120+':   '#7f1d1d', // darkest red
};

/**
 * SLA levels: normal, warning, critical, severe
 */
function getSLALevel(bucket) {
  const idx = AGING_BUCKETS.indexOf(bucket);
  if (idx <= 2) return 'normal';    // 0-24h
  if (idx <= 4) return 'warning';   // 24-48h
  if (idx <= 6) return 'critical';  // 48-96h
  return 'severe';                  // 96h+
}

/**
 * Check if aging bucket is overdue (>= 24h)
 */
function isOverdue(bucket) {
  const idx = AGING_BUCKETS.indexOf(bucket);
  return idx >= 3; // 24-36 and above
}

/**
 * Get the color for an aging bucket
 */
function getAgingColor(bucket) {
  return AGING_COLORS[bucket] || '#6b7280';
}

/**
 * Parse aging bucket string to get min hours
 */
function getMinHours(bucket) {
  if (bucket === '120+') return 120;
  const parts = bucket.split('-');
  return parseInt(parts[0], 10);
}

/**
 * Calculate aging counts from aging data
 * Returns: { total, h24plus, h48plus, h72plus, h120plus }
 */
function calculateAgingCounts(agingData) {
  let total = 0, h24plus = 0, h48plus = 0, h72plus = 0, h120plus = 0;

  if (!Array.isArray(agingData)) return { total, h24plus, h48plus, h72plus, h120plus };

  for (const item of agingData) {
    const count = item.order_count || item.count || 0;
    total += count;

    const minH = getMinHours(item.bucket || item.aging_bucket);
    if (minH >= 24) h24plus += count;
    if (minH >= 48) h48plus += count;
    if (minH >= 72) h72plus += count;
    if (minH >= 120) h120plus += count;
  }

  return { total, h24plus, h48plus, h72plus, h120plus };
}

module.exports = {
  AGING_BUCKETS,
  AGING_COLORS,
  getSLALevel,
  isOverdue,
  getAgingColor,
  getMinHours,
  calculateAgingCounts,
};
