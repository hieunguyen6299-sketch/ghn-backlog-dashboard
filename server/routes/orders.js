const express = require('express');
const router = express.Router();
const { db } = require('../database');

// GET /api/orders
router.get('/', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    let whereClause = "1=1";
    let params = [];

    // Filter by latest snapshot
    const latestSnapshot = db.prepare(`SELECT id FROM backlog_snapshots ORDER BY snapshot_time DESC LIMIT 1`).get();
    if (latestSnapshot) {
        whereClause += " AND o.snapshot_id = ?";
        params.push(latestSnapshot.id);
    }

    if (req.query.category) {
      whereClause += " AND o.category = ?";
      params.push(req.query.category);
    }

    if (req.query.aging) {
      whereClause += " AND o.aging_bucket = ?";
      params.push(req.query.aging);
    }

    if (req.query.search) {
      whereClause += " AND o.order_code LIKE ?";
      params.push(`%${req.query.search}%`);
    }

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM backlog_orders o WHERE ${whereClause}`);
    const total = countStmt.get(...params).total;

    // Join with order_details if needed for status
    const query = `
      SELECT o.order_code, o.category_label, o.aging_bucket, o.last_seen, d.current_status
      FROM backlog_orders o
      LEFT JOIN order_details d ON o.order_code = d.order_code
      WHERE ${whereClause}
      ORDER BY o.aging_bucket DESC, o.last_seen DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);
    
    const orders = db.prepare(query).all(...params);

    res.json({
      orders,
      total,
      page,
      pages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/:code/timeline
router.get('/:code/timeline', (req, res) => {
    try {
        const events = db.prepare(`
            SELECT status_label as status, location, timestamp, note
            FROM order_status_history
            WHERE order_code = ?
            ORDER BY timestamp ASC
        `).all(req.params.code);
        res.json(events);
    } catch (error) {
        console.error('Error fetching timeline:', error);
        res.status(500).json({ error: 'Failed to fetch timeline' });
    }
});

module.exports = router;
