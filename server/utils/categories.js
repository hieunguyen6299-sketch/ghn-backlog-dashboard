/**
 * GHN KTC Category definitions and mapping utilities
 */

const CATEGORIES = [
  { key: 'dang_luan_chuyen', label: 'Đang luân chuyển đến KTC', short: 'Luân chuyển' },
  { key: 'cho_phan_loai', label: 'Chờ phân loại', short: 'Chờ PL' },
  { key: 'dang_phan_loai', label: 'Đang phân loại', short: 'Đang PL' },
  { key: 'cho_xuat', label: 'Chờ xuất', short: 'Chờ xuất' },
  { key: 'cho_xuat_kien_ct', label: 'Chờ xuất kiện chuyển tiếp', short: 'Chờ xuất KCT' },
];

const AGING_BUCKETS = ['0-6', '6-12', '12-24', '24-36', '36-48', '48-72', '72-96', '96-120', '120+'];

/**
 * Convert Vietnamese label from GHN page to internal key
 */
function labelToKey(label) {
  const trimmed = (label || '').trim();
  const found = CATEGORIES.find(c => c.label === trimmed);
  if (found) return found.key;
  // Fuzzy match: lowercase comparison
  const lower = trimmed.toLowerCase();
  const fuzzy = CATEGORIES.find(c => c.label.toLowerCase() === lower);
  return fuzzy ? fuzzy.key : trimmed.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Convert internal key to Vietnamese label
 */
function keyToLabel(key) {
  const found = CATEGORIES.find(c => c.key === key);
  return found ? found.label : key;
}

/**
 * Get short label for charts
 */
function keyToShort(key) {
  const found = CATEGORIES.find(c => c.key === key);
  return found ? found.short : key;
}

module.exports = {
  CATEGORIES,
  AGING_BUCKETS,
  labelToKey,
  keyToLabel,
  keyToShort,
};
