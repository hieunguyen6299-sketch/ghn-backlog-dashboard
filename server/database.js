const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'backlog.db');
const db = new Database(dbPath, { verbose: null }); // Set to console.log for debugging

// Initialize Database Schema
function initDb() {
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS backlog_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time DATETIME NOT NULL,
      warehouse_id TEXT DEFAULT '20757000',
      total_orders INTEGER,
      total_packages INTEGER,
      summary_data TEXT,
      aging_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backlog_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER REFERENCES backlog_snapshots(id),
      order_code TEXT NOT NULL,
      category TEXT NOT NULL,
      category_label TEXT,
      aging_bucket TEXT NOT NULL,
      first_seen DATETIME,
      last_seen DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE NOT NULL,
      sender_name TEXT,
      receiver_name TEXT,
      receiver_province TEXT,
      receiver_district TEXT,
      service_type TEXT,
      weight REAL,
      cod_amount REAL,
      current_status TEXT,
      last_status_time DATETIME,
      error_code TEXT,
      error_description TEXT,
      note TEXT,
      raw_tracking TEXT,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT NOT NULL,
      status TEXT NOT NULL,
      status_label TEXT,
      location TEXT,
      timestamp DATETIME,
      note TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crawl_time DATETIME NOT NULL,
      source TEXT DEFAULT 'crawler',
      duration_seconds REAL,
      total_categories INTEGER,
      total_orders_found INTEGER,
      total_details_fetched INTEGER,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_time ON backlog_snapshots(snapshot_time);
    CREATE INDEX IF NOT EXISTS idx_orders_code ON backlog_orders(order_code);
    CREATE INDEX IF NOT EXISTS idx_orders_snapshot ON backlog_orders(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_orders_category ON backlog_orders(category);
    CREATE INDEX IF NOT EXISTS idx_orders_aging ON backlog_orders(aging_bucket);
    CREATE INDEX IF NOT EXISTS idx_details_code ON order_details(order_code);
    CREATE INDEX IF NOT EXISTS idx_history_code ON order_status_history(order_code);
    CREATE INDEX IF NOT EXISTS idx_history_time ON order_status_history(timestamp);
  `);
}

initDb();

// --- Database Helpers ---

function insertSnapshot(snapshot) {
  const stmt = db.prepare(`
    INSERT INTO backlog_snapshots (snapshot_time, warehouse_id, total_orders, total_packages, summary_data, aging_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    snapshot.snapshot_time,
    snapshot.warehouse_id || '20757000',
    snapshot.total_orders,
    snapshot.total_packages,
    JSON.stringify(snapshot.summary_data || []),
    JSON.stringify(snapshot.aging_data || [])
  );
  return info.lastInsertRowid;
}

function upsertOrder(order) {
  // Try to find if order already exists to update first_seen/last_seen
  const existingStmt = db.prepare(`SELECT first_seen FROM backlog_orders WHERE order_code = ? ORDER BY id DESC LIMIT 1`);
  const existing = existingStmt.get(order.order_code);

  const firstSeen = existing ? existing.first_seen : order.last_seen;

  const stmt = db.prepare(`
    INSERT INTO backlog_orders (snapshot_id, order_code, category, category_label, aging_bucket, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    order.snapshot_id,
    order.order_code,
    order.category,
    order.category_label,
    order.aging_bucket,
    firstSeen,
    order.last_seen
  );
}

function upsertOrderDetail(detail) {
  const stmt = db.prepare(`
    INSERT INTO order_details (order_code, sender_name, receiver_name, receiver_province, receiver_district, service_type, weight, cod_amount, current_status, last_status_time, error_code, error_description, note, raw_tracking, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(order_code) DO UPDATE SET
      sender_name=excluded.sender_name,
      receiver_name=excluded.receiver_name,
      receiver_province=excluded.receiver_province,
      receiver_district=excluded.receiver_district,
      service_type=excluded.service_type,
      weight=excluded.weight,
      cod_amount=excluded.cod_amount,
      current_status=excluded.current_status,
      last_status_time=excluded.last_status_time,
      error_code=excluded.error_code,
      error_description=excluded.error_description,
      note=excluded.note,
      raw_tracking=excluded.raw_tracking,
      fetched_at=CURRENT_TIMESTAMP
  `);
  stmt.run(
    detail.order_code, detail.sender_name, detail.receiver_name, detail.receiver_province,
    detail.receiver_district, detail.service_type, detail.weight, detail.cod_amount,
    detail.current_status, detail.last_status_time, detail.error_code, detail.error_description,
    detail.note, detail.raw_tracking ? JSON.stringify(detail.raw_tracking) : null
  );
}

function insertStatusHistory(history) {
  const stmt = db.prepare(`
    INSERT INTO order_status_history (order_code, status, status_label, location, timestamp, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    history.order_code,
    history.status,
    history.status_label,
    history.location,
    history.timestamp,
    history.note
  );
}

function insertCrawlLog(log) {
  const stmt = db.prepare(`
    INSERT INTO crawl_logs (crawl_time, source, duration_seconds, total_categories, total_orders_found, total_details_fetched, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    log.crawl_time,
    log.source || 'crawler',
    log.duration_seconds,
    log.total_categories,
    log.total_orders_found,
    log.total_details_fetched,
    log.status,
    log.error_message
  );
  return info.lastInsertRowid;
}

module.exports = {
  db,
  insertSnapshot,
  upsertOrder,
  upsertOrderDetail,
  insertStatusHistory,
  insertCrawlLog
};
