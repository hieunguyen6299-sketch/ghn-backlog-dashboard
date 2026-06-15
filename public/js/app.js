// Application Controller - LIVE DATA MODE

document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const els = {
        atWarehouse: document.getElementById('kpi-at-warehouse'),
        transporting: document.getElementById('kpi-transporting'),
        trend: document.getElementById('kpi-trend'),
        h24: document.getElementById('kpi-24h'),
        h48: document.getElementById('kpi-48h'),
        h72: document.getElementById('kpi-72h'),
        lastUpdate: document.getElementById('last-update-time'),
        btnRefresh: document.getElementById('btn-crawl-now'),
        
        // Timeline overlay (if exists)
        timelineOverlay: document.getElementById('timeline-overlay'),
        timelineContent: document.getElementById('timeline-content'),
        timelineOrderCode: document.getElementById('timeline-order-code'),
        btnCloseTimeline: document.getElementById('btn-close-timeline'),
    };

    // --- Formatters ---
    const fmt = num => Number(num || 0).toLocaleString('vi-VN');
    
    // --- Init Data Load ---
    async function loadDashboard() {
        try {
            if (els.lastUpdate) els.lastUpdate.textContent = `Đang đồng bộ...`;
            
            const [summary, heatmap] = await Promise.all([
                API.getDashboardSummary(),
                API.getDashboardHeatmap()
            ]);

            // Calculate split totals
            const transportingCount = summary.categories?.find(c => c.category === 'transporting')?.count || 0;
            const atWarehouseCount = summary.total_orders - transportingCount;

            // Update KPIs
            if (els.atWarehouse) els.atWarehouse.textContent = fmt(atWarehouseCount);
            if (els.transporting) els.transporting.textContent = fmt(transportingCount);
            if (els.h24) els.h24.textContent = fmt(summary.aging_counts.h24plus);
            if (els.h48) els.h48.textContent = fmt(summary.aging_counts.h48plus);
            if (els.h72) els.h72.textContent = fmt(summary.aging_counts.h72plus);
            
            // Trend - compare with previous load (based on transporting)
            if (els.trend) {
                if (window._prevTransporting && window._prevTransporting > 0) {
                    const pct = ((transportingCount - window._prevTransporting) / window._prevTransporting * 100).toFixed(1);
                    const isPos = pct > 0;
                    els.trend.textContent = `${isPos ? '▲ +' : '▼ '}${pct}%`;
                    els.trend.className = `kpi-trend ${isPos ? 'positive' : 'negative'}`;
                } else {
                    els.trend.textContent = `LIVE`;
                    els.trend.className = `kpi-trend live-badge`;
                }
                window._prevTransporting = transportingCount;
            }

            // Charts
            if (summary.categories && summary.categories.length > 0) {
                renderCategoryChart('categoryChart', summary.categories);
            }
            if (heatmap && heatmap.length > 0) {
                renderHeatmap('heatmapCanvas', heatmap);
                // Store for tracking calculations
                window._heatmapData = heatmap;
                updateTracking(heatmap);
            }

            // Update timestamp
            const ts = summary.timestamp ? new Date(summary.timestamp) : new Date();
            if (els.lastUpdate) {
                els.lastUpdate.textContent = `Live: ${ts.toLocaleTimeString('vi-VN')}`;
            }

            // Update summary table
            updateSummaryTable(summary.categories);

        } catch (e) {
            console.error('Failed to load dashboard', e);
            if (els.lastUpdate) els.lastUpdate.textContent = `Lỗi kết nối`;
        }
    }

    // --- Summary Table ---
    function updateSummaryTable(categories) {
        const tbody = document.getElementById('orders-tbody');
        if (!tbody) return;

        tbody.innerHTML = categories.map((c, idx) => {
            const pctOfTotal = categories.reduce((s, x) => s + x.count, 0);
            const pct = pctOfTotal > 0 ? (c.count / pctOfTotal * 100).toFixed(1) : 0;
            
            // Color based on urgency
            let colorClass = '';
            if (c.category === 'transporting') colorClass = 'cat-transport';
            else if (c.category === 'waitingToSort') colorClass = 'cat-wait-sort';
            else if (c.category === 'sorting') colorClass = 'cat-sorting';
            else if (c.category === 'waitingToExport') colorClass = 'cat-wait-export';
            else if (c.category === 'waitingToExportFw') colorClass = 'cat-wait-export-fw';

            return `
            <tr class="summary-row ${colorClass}" data-category="${c.category}">
                <td class="font-medium">${c.category_label}</td>
                <td class="text-right font-bold">${fmt(c.count)}</td>
                <td class="text-right">${fmt(c.package_count)}</td>
                <td class="text-right text-muted">${pct}%</td>
            </tr>`;
        }).join('');

        // Add total row (excluding 'Đang luân chuyển' because they are not AT KTC)
        const atKtc = categories.filter(c => c.category !== 'transporting');
        const totalOrders = atKtc.reduce((s, c) => s + c.count, 0);
        const totalPkg = atKtc.reduce((s, c) => s + c.package_count, 0);
        tbody.innerHTML += `
        <tr class="summary-total-row">
            <td class="font-bold">Tổng đơn/kiện đang ở KTC</td>
            <td class="text-right font-bold">${fmt(totalOrders)}</td>
            <td class="text-right font-bold">${fmt(totalPkg)}</td>
            <td class="text-right font-bold">100%</td>
        </tr>`;

        // Click to show province details
        tbody.querySelectorAll('.summary-row').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                showProvinceDetail(row.dataset.category, categories.find(c => c.category === row.dataset.category));
            });
        });
    }

    // --- Tracking Panel: Chờ xuất 24h+ ---
    function updateTracking(heatmap) {
        const pendingBuckets = ['24-36', '36-48', '48-72'];
        const doneBuckets = ['72-96', '96-120', '120+'];
        const trackCategories = ['waitingToExport', 'waitingToExportFw'];

        let pendingCX = 0, pendingKCT = 0, doneCX = 0, doneKCT = 0;

        heatmap.forEach(item => {
            if (item.category === 'waitingToExport') {
                if (pendingBuckets.includes(item.bucket)) pendingCX += item.count;
                if (doneBuckets.includes(item.bucket)) doneCX += item.count;
            }
            if (item.category === 'waitingToExportFw') {
                if (pendingBuckets.includes(item.bucket)) pendingKCT += item.count;
                if (doneBuckets.includes(item.bucket)) doneKCT += item.count;
            }
        });

        const pendingTotal = pendingCX + pendingKCT;
        const doneTotal = doneCX + doneKCT;

        const el = id => document.getElementById(id);
        if (el('tracking-pending-count')) el('tracking-pending-count').textContent = fmt(pendingTotal);
        if (el('tracking-pending-cx')) el('tracking-pending-cx').textContent = `Chờ xuất: ${fmt(pendingCX)}`;
        if (el('tracking-pending-kct')) el('tracking-pending-kct').textContent = `Chờ xuất KCT: ${fmt(pendingKCT)}`;

        if (el('tracking-done-count')) el('tracking-done-count').textContent = fmt(doneTotal);
        if (el('tracking-done-cx')) el('tracking-done-cx').textContent = `Chờ xuất: ${fmt(doneCX)}`;
        if (el('tracking-done-kct')) el('tracking-done-kct').textContent = `Chờ xuất KCT: ${fmt(doneKCT)}`;
    }

    // --- Province Detail Modal ---
    async function showProvinceDetail(categoryKey, categoryInfo) {
        if (!els.timelineOverlay || !els.timelineContent) return;
        
        if (els.timelineOrderCode) {
            els.timelineOrderCode.textContent = categoryInfo?.category_label || categoryKey;
        }
        els.timelineContent.innerHTML = '<p class="text-muted">Đang tải chi tiết tỉnh/thành...</p>';
        els.timelineOverlay.classList.remove('hidden');

        try {
            const provinces = await API.getProvinceDetail(categoryKey);
            
            if (!provinces || provinces.length === 0) {
                els.timelineContent.innerHTML = '<p class="text-muted">Không có dữ liệu chi tiết.</p>';
                return;
            }

            const buckets = ['0-6', '6-12', '12-24', '24-36', '36-48', '48-72', '72-96', '96-120', '120+'];
            
            let html = `<div class="province-table-wrap">
            <table class="province-table">
                <thead>
                    <tr>
                        <th>Tỉnh/Thành</th>
                        ${buckets.map(b => `<th class="text-center">${b}</th>`).join('')}
                        <th class="text-right">Tổng</th>
                    </tr>
                </thead>
                <tbody>`;
            
            provinces.slice(0, 30).forEach(p => {
                html += `<tr>
                    <td class="font-medium">${p.provinceName}</td>
                    ${p.aging.map(a => {
                        let cls = '';
                        if (a.orders >= 100) cls = 'cell-severe';
                        else if (a.orders >= 50) cls = 'cell-danger';
                        else if (a.orders >= 10) cls = 'cell-warning';
                        else if (a.orders > 0) cls = 'cell-ok';
                        return `<td class="text-center ${cls}">${a.orders || ''}</td>`;
                    }).join('')}
                    <td class="text-right font-bold">${fmt(p.total)}</td>
                </tr>`;
            });
            
            html += `</tbody></table></div>`;
            els.timelineContent.innerHTML = html;

        } catch (e) {
            els.timelineContent.innerHTML = '<p class="text-danger">Lỗi khi tải chi tiết.</p>';
        }
    }

    // --- Event Listeners ---
    
    if (els.btnRefresh) {
        els.btnRefresh.addEventListener('click', async () => {
            const btn = els.btnRefresh;
            const ogText = btn.innerHTML;
            btn.innerHTML = '⟳ Đang tải...';
            btn.disabled = true;
            try {
                await API.refreshData();
                await loadDashboard();
            } catch(e) {
                alert('Lỗi khi refresh dữ liệu');
            } finally {
                btn.innerHTML = ogText;
                btn.disabled = false;
            }
        });
    }

    if (els.btnCloseTimeline) {
        els.btnCloseTimeline.addEventListener('click', () => {
            els.timelineOverlay.classList.add('hidden');
        });
    }

    // Resize heatmap on window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            API.getDashboardHeatmap().then(data => {
                renderHeatmap('heatmapCanvas', data);
            }).catch(()=>{});
        }, 300);
    });

    // Initialize
    loadDashboard();
    
    // Auto refresh every 2 mins
    setInterval(loadDashboard, 2 * 60 * 1000);
});

// Global function: Show tracking detail for pending/done
async function showTrackingDetail(type) {
    const overlay = document.getElementById('timeline-overlay');
    const content = document.getElementById('timeline-content');
    const title = document.getElementById('timeline-order-code');
    if (!overlay || !content) return;

    const isPending = type === 'pending';
    const label = isPending ? 'CHƯA XỬ LÝ (24h → 72h)' : 'ĐÃ XỬ LÝ (72h+)';
    const buckets = isPending ? ['24-36', '36-48', '48-72'] : ['72-96', '96-120', '120+'];
    const categories = [
        { key: 'waitingToExport', label: 'Chờ xuất' },
        { key: 'waitingToExportFw', label: 'Chờ xuất KCT' }
    ];

    title.textContent = label;
    content.innerHTML = '<div style="text-align:center; padding:20px; color: var(--text-secondary);">⏳ Đang tải mã đơn cho tất cả buckets...</div>';
    overlay.classList.remove('hidden');

    // Fetch order codes for each category + bucket combination
    const allResults = [];
    const fetchPromises = [];

    for (const cat of categories) {
        for (const bucket of buckets) {
            fetchPromises.push(
                API.getOrderDetail(cat.key, bucket)
                    .then(r => ({ category: cat.label, bucket, orderCodes: r.orderCodes || [], count: r.count || 0 }))
                    .catch(() => ({ category: cat.label, bucket, orderCodes: [], count: 0 }))
            );
        }
    }

    const results = await Promise.all(fetchPromises);

    // Group by category
    let html = '';
    for (const cat of categories) {
        const catResults = results.filter(r => r.category === cat.label && r.count > 0);
        if (catResults.length === 0) continue;

        const totalForCat = catResults.reduce((s, r) => s + r.count, 0);
        html += `<div style="margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="font-bold" style="color:var(--primary);">${cat.label}</span>
                <span class="text-muted">${totalForCat} đơn</span>
            </div>`;

        catResults.forEach(r => {
            const color = isPending ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)';
            const borderColor = isPending ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)';
            html += `<div style="margin-bottom:10px;">
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:4px;">
                    Aging ${r.bucket}h — ${r.count} đơn
                    <button class="btn btn-small" style="padding:2px 8px; font-size:0.7rem; margin-left:8px;" 
                        onclick="copyOrderCodes(this)" data-codes="${r.orderCodes.join(',')}">📋 Copy</button>
                </div>
                <div class="order-codes-grid">
                    ${r.orderCodes.map(code => 
                        `<span class="order-code-chip" style="background:${color}; border-color:${borderColor};" 
                            onclick="navigator.clipboard.writeText('${code}');this.style.background='rgba(34,197,94,0.3)';setTimeout(()=>this.style.background='${color}',800)" 
                            title="Click để copy">${code}</span>`
                    ).join('')}
                </div>
            </div>`;
        });

        html += '</div>';
    }

    if (!html) {
        html = '<p class="text-muted" style="text-align:center; padding:16px;">Không có đơn hàng nào trong khoảng này.</p>';
    }

    // Add "Copy All" button at top if there are orders
    const allCodes = results.flatMap(r => r.orderCodes);
    if (allCodes.length > 0) {
        const totalOrders = allCodes.length;
        html = `<div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <span style="font-size:1.5rem; font-weight:700; color:${isPending ? '#f59e0b' : '#22c55e'};">${totalOrders}</span>
                <span class="text-muted"> đơn hàng tổng</span>
            </div>
            <button class="btn btn-small" onclick="copyOrderCodes(this)" data-codes="${allCodes.join(',')}">📋 Copy tất cả ${totalOrders} mã</button>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:12px;"></div>` + html;
    }

    content.innerHTML = html;
}
