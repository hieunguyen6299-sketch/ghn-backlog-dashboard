/**
 * Frontend API Client - Calls our proxy server which fetches live data from GHN
 */
const API_BASE = window.location.origin;

const API = {
    async getDashboardSummary() {
        const res = await fetch(`${API_BASE}/api/dashboard/summary`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    },

    async getDashboardHeatmap(type = 'orders') {
        const res = await fetch(`${API_BASE}/api/dashboard/heatmap?type=${type}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    },

    async getProvinceDetail(category) {
        const res = await fetch(`${API_BASE}/api/dashboard/provinces/${category}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    },

    async getOrderDetail(category, aging, type = 'order') {
        const res = await fetch(`${API_BASE}/api/dashboard/orders/${encodeURIComponent(category)}/${encodeURIComponent(aging)}?type=${type}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    },

    async refreshData() {
        const res = await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    }
};
