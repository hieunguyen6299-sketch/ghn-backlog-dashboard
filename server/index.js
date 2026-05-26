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

// ============================================================
// HR / EMPLOYEE TURNOVER API
// ============================================================
const fs = require('fs');

function parseHRData() {
    const csvPath = path.join(__dirname, '..', 'data', 'hr-data.csv');
    const raw = fs.readFileSync(csvPath);
    const content = raw.toString('utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    
    const employees = [];
    for (let i = 1; i < lines.length; i++) {
        // Handle CSV with quoted fields containing commas
        const cols = [];
        let current = '';
        let inQuotes = false;
        for (const ch of lines[i]) {
            if (ch === '"') { inQuotes = !inQuotes; }
            else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
            else if (ch !== '\r') { current += ch; }
        }
        cols.push(current.trim());
        
        if (cols.length < 10) continue;
        
        employees.push({
            id: cols[1],
            name: cols[2],
            shift: cols[3],
            title: cols[5],
            department: cols[6],
            warehouse: cols[7],
            startDate: cols[8],
            tenure: parseInt(cols[9]) || 0,
            resignDate: cols[10] || '',
            resignTenure: parseInt(cols[11]) || 0,
            reason: cols[12] || '',
            resignMonth: cols[13] || '',
            shiftGroup: cols[14] || '',
            manager: cols[15] || ''
        });
    }
    return employees;
}

app.get('/api/hr-stats', (req, res) => {
    try {
        const employees = parseHRData();
        const total = employees.length;
        const resigned = employees.filter(e => e.resignDate);
        const active = total - resigned.length;
        const turnoverRate = ((resigned.length / total) * 100).toFixed(1);
        
        // Parse date helper: dd/mm/yyyy -> Date
        function parseDate(str) {
            if (!str) return null;
            const [d, m, y] = str.split('/');
            return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        }
        
        // Monthly turnover rate calculation
        // For each month: rate = (resignations in month / headcount at start of month) * 100
        const byMonth = {};
        resigned.forEach(e => {
            if (e.resignMonth) {
                byMonth[e.resignMonth] = (byMonth[e.resignMonth] || 0) + 1;
            }
        });
        
        const monthlyData = Object.entries(byMonth)
            .map(([month, count]) => {
                const [mm, yyyy] = month.split('/');
                const monthStart = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
                
                // Headcount at start of month = employees who started before this month
                // minus those who resigned before this month
                const headcount = employees.filter(e => {
                    const start = parseDate(e.startDate);
                    if (!start || start >= monthStart) return false;
                    if (!e.resignDate) return true;
                    const resign = parseDate(e.resignDate);
                    return resign >= monthStart;
                }).length;
                
                const rate = headcount > 0 ? ((count / headcount) * 100).toFixed(1) : '0.0';
                return { month, count, headcount, rate: parseFloat(rate) };
            })
            .sort((a, b) => {
                const [mA, yA] = a.month.split('/');
                const [mB, yB] = b.month.split('/');
                return (yA + mA).localeCompare(yB + mB);
            });
        
        // By reason
        const byReason = {};
        resigned.forEach(e => {
            const reason = e.reason || 'Không rõ';
            // Normalize common reasons
            let normalized = reason;
            if (reason.match(/cho.*th/i)) normalized = 'Cho thôi việc';
            else if (reason.match(/ngh.*ngang/i)) normalized = 'Nghỉ ngang';
            else if (reason.match(/ngh.*kh.*ng.*ph/i)) normalized = 'Nghỉ không phép';
            else if (reason.match(/vi.*c.*h/i) || reason.match(/b.*n.*h/i)) normalized = 'Bận việc học';
            else if (reason.match(/vi.*c.*m/i) || reason.match(/c.*ng.*vi/i)) normalized = 'Có việc mới';
            else if (reason.match(/gia.*d/i) || reason.match(/vi.*c.*ri/i)) normalized = 'Việc gia đình/cá nhân';
            else if (reason.match(/s.*c.*kh/i)) normalized = 'Sức khỏe';
            else if (reason.match(/l.*ng/i) || reason.match(/ch.*l/i)) normalized = 'Chê lương';
            else if (reason.match(/kho.*cho/i)) normalized = 'Kho cho nghỉ';
            byReason[normalized] = (byReason[normalized] || 0) + 1;
        });
        const reasonData = Object.entries(byReason)
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count);
        
        // By manager
        const byManager = {};
        resigned.forEach(e => {
            const mgr = e.manager || 'Không rõ';
            byManager[mgr] = (byManager[mgr] || 0) + 1;
        });
        const managerData = Object.entries(byManager)
            .map(([manager, count]) => ({ manager, count }))
            .sort((a, b) => b.count - a.count);
        
        // By shift
        const byShift = {};
        resigned.forEach(e => {
            const s = e.shiftGroup || 'Không rõ';
            byShift[s] = (byShift[s] || 0) + 1;
        });
        const shiftData = Object.entries(byShift)
            .map(([shift, count]) => ({ shift, count }))
            .sort((a, b) => b.count - a.count);
        
        // Recent resignations
        const recent = resigned
            .filter(e => e.resignDate)
            .sort((a, b) => {
                const [dA, mA, yA] = a.resignDate.split('/');
                const [dB, mB, yB] = b.resignDate.split('/');
                return (yB + mB + dB).localeCompare(yA + mA + dA);
            })
            .slice(0, 15)
            .map(e => ({
                name: e.name,
                resignDate: e.resignDate,
                reason: e.reason,
                tenure: e.tenure,
                manager: e.manager,
                shift: e.shiftGroup
            }));
        
        // Average tenure of resigned (column L - thâm niên nghỉ việc, tính bằng tháng)
        const resignedWithTenure = resigned.filter(e => e.resignTenure > 0);
        const avgTenure = resignedWithTenure.length > 0
            ? (resignedWithTenure.reduce((sum, e) => sum + e.resignTenure, 0) / resignedWithTenure.length).toFixed(1)
            : 0;
        
        // Average monthly turnover rate
        const avgMonthlyRate = monthlyData.length > 0
            ? (monthlyData.reduce((sum, d) => sum + d.rate, 0) / monthlyData.length).toFixed(1)
            : 0;
        
        res.json({
            total, active, resigned: resigned.length,
            turnoverRate, avgTenure, avgMonthlyRate: parseFloat(avgMonthlyRate),
            monthlyData, reasonData, managerData, shiftData, recent
        });
    } catch (error) {
        console.error('[API] HR stats error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/hr-month/:month - Detail for a specific month (e.g., 02/2026)
app.get('/api/hr-month/:month', (req, res) => {
    try {
        const month = decodeURIComponent(req.params.month);
        const employees = parseHRData();
        
        function parseDate(str) {
            if (!str) return null;
            const [d, m, y] = str.split('/');
            return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        }
        
        // Employees who resigned this month
        const resignedThisMonth = employees.filter(e => e.resignMonth === month);
        
        // Headcount at start of month
        const [mm, yyyy] = month.split('/');
        const monthStart = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
        const headcount = employees.filter(e => {
            const start = parseDate(e.startDate);
            if (!start || start >= monthStart) return false;
            if (!e.resignDate) return true;
            const resign = parseDate(e.resignDate);
            return resign >= monthStart;
        }).length;
        
        // New hires this month
        const newHires = employees.filter(e => {
            const start = parseDate(e.startDate);
            if (!start) return false;
            return start.getMonth() === parseInt(mm) - 1 && start.getFullYear() === parseInt(yyyy);
        });
        
        const rate = headcount > 0 ? ((resignedThisMonth.length / headcount) * 100).toFixed(1) : '0.0';
        
        // Reason breakdown for this month
        const byReason = {};
        resignedThisMonth.forEach(e => {
            const reason = e.reason || 'Không rõ';
            byReason[reason] = (byReason[reason] || 0) + 1;
        });
        const reasonData = Object.entries(byReason)
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count);
        
        // By manager for this month
        const byManager = {};
        resignedThisMonth.forEach(e => {
            const mgr = e.manager || 'Không rõ';
            byManager[mgr] = (byManager[mgr] || 0) + 1;
        });
        const managerData = Object.entries(byManager)
            .map(([manager, count]) => ({ manager, count }))
            .sort((a, b) => b.count - a.count);
        
        // Employee list
        const list = resignedThisMonth.map(e => ({
            id: e.id,
            name: e.name,
            title: e.title,
            startDate: e.startDate,
            resignDate: e.resignDate,
            resignTenure: e.resignTenure,
            reason: e.reason,
            manager: e.manager,
            shiftGroup: e.shiftGroup
        }));
        
        res.json({
            month,
            headcount,
            resigned: resignedThisMonth.length,
            newHires: newHires.length,
            rate: parseFloat(rate),
            reasonData,
            managerData,
            list
        });
    } catch (error) {
        console.error('[API] HR month detail error:', error.message);
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
