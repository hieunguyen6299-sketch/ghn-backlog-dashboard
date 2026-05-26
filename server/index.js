const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { fetchBacklogData, transformBacklogData, fetchOrderDetail } = require('./services/ghn-api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const GHN_TOKEN = process.env.GHN_TOKEN;
const LOCATION_IDS = (process.env.LOCATION_IDS || process.env.WAREHOUSE_ID || '20757000').split(',');

// Cache to avoid hammering GHN API
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

async function getBacklogData() {
    const now = Date.now();
    if (cachedData && (now - cacheTime) < CACHE_TTL) {
        return cachedData;
    }
    console.log(`[API] Fetching live data from GHN (locations: ${LOCATION_IDS.join(',')})...`);
    const raw = await fetchBacklogData(GHN_TOKEN, LOCATION_IDS);
    cachedData = transformBacklogData(raw);
    cacheTime = now;
    console.log(`[API] Got ${cachedData.total_orders} orders, ${cachedData.total_packages} packages`);
    return cachedData;
}

// ============================================================
// API ENDPOINTS
// ============================================================

// GET /api/dashboard/summary - Main dashboard data
app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const data = await getBacklogData();
        res.json({
            total_orders: data.total_orders,
            total_packages: data.total_packages,
            aging_counts: data.aging_counts,
            categories: data.categories,
            timestamp: data.timestamp
        });
    } catch (error) {
        console.error('[API] Summary error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/dashboard/heatmap - Aging heatmap data
app.get('/api/dashboard/heatmap', async (req, res) => {
    try {
        const data = await getBacklogData();
        const type = req.query.type || 'orders';
        res.json(type === 'packages' ? data.package_heatmap : data.heatmap);
    } catch (error) {
        console.error('[API] Heatmap error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/dashboard/provinces/:category - Province breakdown
app.get('/api/dashboard/provinces/:category', async (req, res) => {
    try {
        const data = await getBacklogData();
        const provinces = data.province_details[req.params.category] || [];
        res.json(provinces);
    } catch (error) {
        console.error('[API] Province error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/dashboard/orders/:category/:aging - Individual order codes for a cell
app.get('/api/dashboard/orders/:category/:aging', async (req, res) => {
    try {
        const { category, aging } = req.params;
        const type = req.query.type || 'order';
        console.log(`[API] Fetching order detail: ${category} / ${aging} / ${type}`);
        const orderCodes = await fetchOrderDetail(GHN_TOKEN, LOCATION_IDS, category, aging, type);
        res.json({ orderCodes, count: orderCodes.length, category, aging });
    } catch (error) {
        console.error('[API] Order detail error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/refresh - Force refresh cache
app.post('/api/refresh', async (req, res) => {
    try {
        cachedData = null;
        cacheTime = 0;
        const data = await getBacklogData();
        res.json({ success: true, timestamp: data.timestamp, total_orders: data.total_orders });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  GHN Backlog Dashboard - LIVE MODE                      ║
║  Server: http://localhost:${PORT}                          ║
║  Token: ${GHN_TOKEN ? GHN_TOKEN.substring(0,8) + '...' : 'NOT SET'}                                 ║
║  Locations: ${LOCATION_IDS.join(', ')}                          ║
╚══════════════════════════════════════════════════════════╝
    `);
});
