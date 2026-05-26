const { db, insertSnapshot, upsertOrder, upsertOrderDetail, insertStatusHistory } = require('./database');
const { CATEGORIES, AGING_BUCKETS } = require('./utils/categories');

// Helper to generate a random order code (like GYT4XQND)
function generateOrderCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'G';
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper for random int
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

console.log('Seeding demo data for GHN Backlog Dashboard...');

db.exec('BEGIN TRANSACTION;');

try {
  // Clear existing data
  db.exec('DELETE FROM backlog_snapshots');
  db.exec('DELETE FROM backlog_orders');
  db.exec('DELETE FROM order_details');
  db.exec('DELETE FROM order_status_history');
  db.exec('DELETE FROM crawl_logs');

  // Generate 5 snapshots for the trend (last 5 hours)
  const now = new Date();
  
  // Real numbers from screenshot roughly
  const categoryBaseCounts = {
    'dang_luan_chuyen': 5713,
    'cho_phan_loai': 45,
    'dang_phan_loai': 338,
    'cho_xuat': 1933,
    'cho_xuat_kien_ct': 11573
  };

  let lastSnapshotId = null;

  for (let i = 4; i >= 0; i--) {
    const snapshotTime = new Date(now.getTime() - (i * 60 * 60 * 1000)).toISOString();
    
    // Add some random variation (-5% to +5%)
    const variation = 1 + ((Math.random() * 0.1) - 0.05);
    
    let totalOrders = 0;
    const summaryData = [];
    const agingData = [];

    CATEGORIES.forEach(cat => {
      const baseCount = Math.floor(categoryBaseCounts[cat.key] * variation);
      totalOrders += baseCount;
      summaryData.push({ category: cat.key, category_label: cat.label, count: baseCount });

      // Distribute count across aging buckets (skewed towards 0-24)
      let remaining = baseCount;
      AGING_BUCKETS.forEach((bucket, idx) => {
          let bucketCount = 0;
          if (idx === AGING_BUCKETS.length -1) {
              bucketCount = remaining;
          } else {
              // rough distribution: drops off quickly
              const pct = [0.4, 0.3, 0.2, 0.05, 0.03, 0.01, 0.005, 0.003, 0.002][idx];
              bucketCount = Math.floor(baseCount * pct);
              if (bucketCount > remaining) bucketCount = remaining;
              remaining -= bucketCount;
          }
          if (bucketCount > 0) {
              agingData.push({ category: cat.key, bucket: bucket, count: bucketCount });
          }
      });
    });

    const snapshot = {
      snapshot_time: snapshotTime,
      total_orders: totalOrders,
      total_packages: Math.floor(totalOrders * 0.3), // Fake package count
      summary_data: summaryData,
      aging_data: agingData
    };

    lastSnapshotId = insertSnapshot(snapshot);
  }

  // Generate some actual orders for the table view (only for latest snapshot)
  const generatedOrders = [];
  CATEGORIES.forEach(cat => {
      // Just gen 10-20 orders per category for UI demo
      const numOrders = getRandomInt(10, 30);
      for (let i=0; i<numOrders; i++) {
          const code = generateOrderCode();
          // Pick a random bucket, slightly weighted to older for demo purposes
          const bucket = AGING_BUCKETS[getRandomInt(0, 5)]; 
          
          upsertOrder({
              snapshot_id: lastSnapshotId,
              order_code: code,
              category: cat.key,
              category_label: cat.label,
              aging_bucket: bucket,
              first_seen: new Date(now.getTime() - (getRandomInt(1, 48) * 3600000)).toISOString(),
              last_seen: now.toISOString()
          });
          generatedOrders.push(code);

          // Add status history
          const statuses = ['Tạo đơn hàng', 'Đã lấy hàng', 'Đang luân chuyển', cat.label];
          let eventTime = new Date(now.getTime() - (getRandomInt(12, 48) * 3600000));
          
          statuses.forEach(status => {
             insertStatusHistory({
                 order_code: code,
                 status: status,
                 status_label: status,
                 location: 'Kho trung tâm',
                 timestamp: eventTime.toISOString(),
                 note: ''
             });
             // Add 2-5 hours for next status
             eventTime = new Date(eventTime.getTime() + (getRandomInt(2, 5) * 3600000));
          });
      }
  });

  db.exec('COMMIT;');
  console.log('Seeding complete! Data ready for dashboard.');

} catch (e) {
  db.exec('ROLLBACK;');
  console.error('Seeding failed:', e);
}
