const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { calculateAgingCounts } = require('../utils/aging');

// GET /api/dashboard/summary
router.get('/summary', (req, res) => {
  try {
    // Get latest snapshot
    const snapshot = db.prepare(`SELECT * FROM backlog_snapshots ORDER BY snapshot_time DESC LIMIT 1`).get();
    
    if (!snapshot) {
      return res.json({
        total_orders: 0,
        total_packages: 0,
        aging_counts: { total: 0, h24plus: 0, h48plus: 0, h72plus: 0, h120plus: 0 },
        trend_pct: 0,
        categories: []
      });
    }

    const agingData = JSON.parse(snapshot.aging_data || '[]');
    const summaryData = JSON.parse(snapshot.summary_data || '[]');
    const counts = calculateAgingCounts(agingData);

    // Get previous snapshot to calculate trend
    const prevSnapshot = db.prepare(`SELECT * FROM backlog_snapshots WHERE id < ? ORDER BY snapshot_time DESC LIMIT 1`).get(snapshot.id);
    let trendPct = 0;
    if (prevSnapshot && prevSnapshot.total_orders > 0) {
      trendPct = ((snapshot.total_orders - prevSnapshot.total_orders) / prevSnapshot.total_orders) * 100;
    }

    res.json({
      total_orders: snapshot.total_orders,
      total_packages: snapshot.total_packages,
      aging_counts: counts,
      trend_pct: parseFloat(trendPct.toFixed(2)),
      categories: summaryData
    });

  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// GET /api/dashboard/trend
router.get('/trend', (req, res) => {
  try {
    // Get snapshots for the last 24 hours
    const snapshots = db.prepare(`
      SELECT * FROM backlog_snapshots 
      WHERE snapshot_time >= datetime('now', '-24 hours')
      ORDER BY snapshot_time ASC
    `).all();

    const trendData = snapshots.map(s => {
      const agingData = JSON.parse(s.aging_data || '[]');
      const counts = calculateAgingCounts(agingData);
      return {
        snapshot_time: s.snapshot_time,
        total_orders: s.total_orders,
        backlog_24h: counts.h24plus,
        backlog_48h: counts.h48plus,
        backlog_72h: counts.h72plus
      };
    });

    res.json(trendData);
  } catch (error) {
    console.error('Error fetching dashboard trend:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard trend' });
  }
});

// GET /api/dashboard/heatmap
router.get('/heatmap', (req, res) => {
  try {
     const snapshot = db.prepare(`SELECT * FROM backlog_snapshots ORDER BY snapshot_time DESC LIMIT 1`).get();
     if(!snapshot) return res.json([]);
     
     const agingData = JSON.parse(snapshot.aging_data || '[]');
     // Convert to format expected by heatmap: {category, bucket, count}
     const heatmapData = agingData.map(item => ({
        category: item.category,
        bucket: item.aging_bucket || item.bucket,
        count: item.order_count || item.count || 0
     }));
     res.json(heatmapData);
  } catch (error) {
    console.error('Error fetching dashboard heatmap:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard heatmap' });
  }
});

module.exports = router;
