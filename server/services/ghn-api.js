/**
 * GHN API Proxy Service
 * Calls GHN reporting API and transforms data for the dashboard
 */

const GHN_API_BASE = 'https://baocao-api.ghn.vn';

/**
 * Makes an authenticated request to GHN API
 */
async function ghnRequest(path, body, token) {
    const url = `${GHN_API_BASE}${path}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'token': token,
            'origin': 'https://baocao.ghn.vn',
            'referer': 'https://baocao.ghn.vn/',
            'remote-ip': process.env.REMOTE_IP || '',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
        },
        body: JSON.stringify(body)
    });
    return response.json();
}

/**
 * Fetch live backlog data from GHN
 */
async function fetchBacklogData(token, locationIds) {
    const data = await ghnRequest(
        '/baocao-service/report/backlog/ktc/location-id',
        { locationIds },
        token
    );

    if (data.code !== 200 || !data.data?.backlogKTC) {
        throw new Error(`GHN API error: ${data.message || 'No data'}`);
    }

    return data.data.backlogKTC;
}

/**
 * Transform raw GHN data into dashboard-friendly format
 */
function transformBacklogData(raw) {
    // Category mapping
    const categories = [
        { key: 'transporting', label: 'Đang luân chuyển đến KTC', short: 'Luân chuyển', totalField: 'totalTransporting', pkgField: 'packageTotalTransporting', detailField: 'detailProvinceTransporting' },
        { key: 'waitingToSort', label: 'Chờ phân loại', short: 'Chờ PL', totalField: 'totalWaitingToSort', pkgField: 'packageTotalWaitingToSort', detailField: 'detailProvinceWaitingToSort' },
        { key: 'sorting', label: 'Đang phân loại', short: 'Đang PL', totalField: 'totalSorting', pkgField: 'packageTotalSorting', detailField: 'detailProvinceSorting' },
        { key: 'waitingToExport', label: 'Chờ xuất', short: 'Chờ xuất', totalField: 'totalWaitingToExport', pkgField: 'packageTotalWaitingToExport', detailField: 'detailProvinceWaitingToExport' },
        { key: 'waitingToExportFw', label: 'Chờ xuất kiện chuyển tiếp', short: 'Chờ xuất KCT', totalField: 'totalWaitingToExportFw', pkgField: 'packageTotalWaitingToExportFw', detailField: 'detailProvinceWaitingToExportFw' }
    ];

    const bucketKeys = ['0006', '0612', '1224', '2436', '3648', '4872', '7296', '96120', '120Plus'];
    const bucketLabels = ['0-6', '6-12', '12-24', '24-36', '36-48', '48-72', '72-96', '96-120', '120+'];

    // Summary
    const totalOrders = categories.reduce((sum, c) => sum + (raw[c.totalField] || 0), 0);
    const totalPackages = categories.reduce((sum, c) => sum + (raw[c.pkgField] || 0), 0);

    const categorySummary = categories.map(c => ({
        category: c.key,
        category_label: c.label,
        short_label: c.short,
        count: raw[c.totalField] || 0,
        package_count: raw[c.pkgField] || 0
    }));

    // Heatmap (order aging by category and bucket)
    const heatmap = [];
    const packageHeatmap = [];

    categories.forEach(c => {
        const detail = raw[c.detailField];
        if (!detail) return;

        const orderTotals = detail.total || {};
        const pkgTotals = detail.packageTotal || {};

        bucketKeys.forEach((bk, idx) => {
            const orderCount = orderTotals[`total${bk}`] || 0;
            const pkgCount = pkgTotals[`total${bk}`] || 0;

            if (orderCount > 0) {
                heatmap.push({ category: c.key, category_label: c.label, bucket: bucketLabels[idx], count: orderCount });
            }
            if (pkgCount > 0) {
                packageHeatmap.push({ category: c.key, category_label: c.label, bucket: bucketLabels[idx], count: pkgCount });
            }
        });
    });

    // Calculate aging counts (24h+, 48h+, 72h+, 120h+) — CHỈ Chờ xuất + Chờ xuất KCT
    const exportCategories = ['waitingToExport', 'waitingToExportFw'];
    let h24plus = 0, h48plus = 0, h72plus = 0, h120plus = 0;
    heatmap.forEach(item => {
        if (!exportCategories.includes(item.category)) return;
        const b = item.bucket;
        if (['24-36', '36-48', '48-72', '72-96', '96-120', '120+'].includes(b)) h24plus += item.count;
        if (['48-72', '72-96', '96-120', '120+'].includes(b)) h48plus += item.count;
        if (['72-96', '96-120', '120+'].includes(b)) h72plus += item.count;
        if (b === '120+') h120plus += item.count;
    });

    // Province detail for each category
    const provinceDetails = {};
    categories.forEach(c => {
        const detail = raw[c.detailField];
        if (!detail || !detail.detailAging) return;

        provinceDetails[c.key] = detail.detailAging
            .filter(p => p.provinceName)
            .map(p => ({
                provinceId: p.provinceId,
                provinceName: p.provinceName,
                aging: bucketKeys.map((bk, idx) => ({
                    bucket: bucketLabels[idx],
                    orders: p.orderTotalAging?.[`totalAging${bk}`] || p[`totalAging${bk}`] || 0,
                    packages: p.packageTotalAging?.[`totalAging${bk}`] || 0
                })),
                total: bucketKeys.reduce((sum, bk) => sum + (p[`totalAging${bk}`] || 0), 0)
            }))
            .filter(p => p.total > 0)
            .sort((a, b) => b.total - a.total);
    });

    return {
        timestamp: new Date().toISOString(),
        total_orders: totalOrders,
        total_packages: totalPackages,
        aging_counts: { total: totalOrders, h24plus, h48plus, h72plus, h120plus },
        categories: categorySummary,
        heatmap,
        package_heatmap: packageHeatmap,
        province_details: provinceDetails
    };
}

/**
 * Map frontend category keys to API status values for the detail endpoint
 */
const STATUS_MAP = {
    'transporting': 'TRANSPORTING',
    'waitingToSort': 'WAITING_TO_SORT',
    'sorting': 'SORTING',
    'waitingToExport': 'WAITING_TO_EXPORT',
    'waitingToExportFw': 'WAITING_TO_EXPORT_FW'
};

/**
 * Map aging bucket labels to API aging format (with spaces)
 */
const AGING_MAP = {
    '0-6': '0 - 6',
    '6-12': '6 - 12',
    '12-24': '12 - 24',
    '24-36': '24 - 36',
    '36-48': '36 - 48',
    '48-72': '48 - 72',
    '72-96': '72 - 96',
    '96-120': '96 - 120',
    '120+': '120+'
};

/**
 * Fetch order detail (individual order codes) for a specific category + aging bucket
 */
async function fetchOrderDetail(token, locationIds, category, aging, type = 'order') {
    const status = STATUS_MAP[category];
    if (!status) throw new Error(`Unknown category: ${category}`);

    const agingFormatted = AGING_MAP[aging] || aging;

    const data = await ghnRequest(
        '/baocao-service/report/backlog/ktc/detail',
        {
            locationIds,
            status,
            provinceIds: [-1],
            aging: agingFormatted,
            type
        },
        token
    );

    if (data.code !== 200) {
        throw new Error(`GHN detail API error: ${data.message || 'Unknown'}`);
    }

    const orders = data.data?.backlogKTC || [];
    return orders.map(o => o.orderCode);
}

module.exports = { ghnRequest, fetchBacklogData, transformBacklogData, fetchOrderDetail };
