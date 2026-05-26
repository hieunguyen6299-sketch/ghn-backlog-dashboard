// Heatmap as HTML Table - shows exact numbers like the GHN original
// Rows = Categories, Cols = Aging Buckets

const HEATMAP_CATEGORIES = [
    { key: 'transporting', label: 'Đang luân chuyển đến KTC', short: 'Đang luân chuyển' },
    { key: 'waitingToSort', label: 'Chờ phân loại', short: 'Chờ phân loại' },
    { key: 'sorting', label: 'Đang phân loại', short: 'Đang phân loại' },
    { key: 'waitingToExport', label: 'Chờ xuất', short: 'Chờ xuất' },
    { key: 'waitingToExportFw', label: 'Chờ xuất kiện chuyển tiếp', short: 'Chờ xuất KCT' }
];

const HEATMAP_BUCKETS = ['0-6', '6-12', '12-24', '24-36', '36-48', '48-72', '72-96', '96-120', '120+'];

function getCellClass(count, maxCount) {
    if (!count || count === 0) return '';
    const ratio = count / maxCount;
    if (ratio >= 0.3 || count >= 1000) return 'hm-severe';
    if (ratio >= 0.1 || count >= 100) return 'hm-high';
    if (ratio >= 0.03 || count >= 30) return 'hm-medium';
    if (count > 0) return 'hm-low';
    return '';
}

function renderHeatmap(canvasId, rawData) {
    // Replace canvas with HTML table
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const container = canvas.parentElement;
    
    // Build matrix
    let maxCount = 0;
    const matrix = {};
    const rowTotals = {};
    
    HEATMAP_CATEGORIES.forEach(c => { matrix[c.key] = {}; rowTotals[c.key] = 0; });
    
    rawData.forEach(item => {
        if (!matrix[item.category]) return;
        matrix[item.category][item.bucket] = item.count;
        rowTotals[item.category] = (rowTotals[item.category] || 0) + item.count;
        if (item.count > maxCount) maxCount = item.count;
    });

    // Build HTML table
    let html = `<table class="heatmap-table">
        <thead>
            <tr>
                <th class="hm-label-col">PHÂN LOẠI (ĐƠN HÀNG)</th>
                ${HEATMAP_BUCKETS.map(b => `<th class="hm-bucket-col">${b}</th>`).join('')}
                <th class="hm-total-col">Tổng</th>
            </tr>
        </thead>
        <tbody>`;
    
    HEATMAP_CATEGORIES.forEach(cat => {
        html += `<tr class="hm-row" data-category="${cat.key}">`;
        html += `<td class="hm-label">${cat.short}</td>`;
        
        HEATMAP_BUCKETS.forEach(bucket => {
            const count = matrix[cat.key][bucket] || 0;
            const cls = getCellClass(count, maxCount);
            const displayValue = count > 0 ? count.toLocaleString('vi-VN') : '';
            html += `<td class="hm-cell ${cls}" data-category="${cat.key}" data-bucket="${bucket}" data-count="${count}">${displayValue}</td>`;
        });
        
        const total = rowTotals[cat.key] || 0;
        html += `<td class="hm-total">${total.toLocaleString('vi-VN')}</td>`;
        html += `</tr>`;
    });

    // Total row
    html += `<tr class="hm-total-row"><td class="hm-label font-bold">Tổng</td>`;
    HEATMAP_BUCKETS.forEach(bucket => {
        const colTotal = HEATMAP_CATEGORIES.reduce((sum, cat) => sum + (matrix[cat.key][bucket] || 0), 0);
        html += `<td class="hm-cell hm-col-total">${colTotal > 0 ? colTotal.toLocaleString('vi-VN') : ''}</td>`;
    });
    const grandTotal = Object.values(rowTotals).reduce((s, v) => s + v, 0);
    html += `<td class="hm-total font-bold">${grandTotal.toLocaleString('vi-VN')}</td>`;
    html += `</tr></tbody></table>`;

    // Replace canvas with table
    container.innerHTML = html;
    
    // Add click handler for cells - show province detail modal
    container.querySelectorAll('.hm-cell[data-count]').forEach(cell => {
        const count = parseInt(cell.dataset.count);
        if (count > 0) {
            cell.style.cursor = 'pointer';
            cell.addEventListener('click', async () => {
                const cat = HEATMAP_CATEGORIES.find(c => c.key === cell.dataset.category);
                const bucket = cell.dataset.bucket;
                const categoryKey = cell.dataset.category;
                
                showHeatmapDetail(cat, bucket, count, categoryKey);
            });
        }
    });
}

// Show detail modal for a specific category + aging bucket
async function showHeatmapDetail(cat, bucket, count, categoryKey) {
    const overlay = document.getElementById('timeline-overlay');
    const content = document.getElementById('timeline-content');
    const title = document.getElementById('timeline-order-code');
    
    if (!overlay || !content) return;
    
    title.textContent = `${cat?.label || categoryKey} — ${bucket}h`;
    content.innerHTML = `<div style="text-align:center; padding: 20px;">
        <div style="font-size:2rem; font-weight:700; color: var(--primary);">${count.toLocaleString('vi-VN')}</div>
        <div style="color: var(--text-secondary); margin-top: 4px;">đơn hàng</div>
        <div style="margin-top:16px; color: var(--text-secondary);">⏳ Đang tải mã đơn...</div>
    </div>`;
    overlay.classList.remove('hidden');

    // Fetch order codes and province detail in parallel
    const [orderResult, provinces] = await Promise.allSettled([
        API.getOrderDetail(categoryKey, bucket),
        API.getProvinceDetail(categoryKey)
    ]);

    const orderCodes = orderResult.status === 'fulfilled' ? (orderResult.value.orderCodes || []) : [];
    const provinceData = provinces.status === 'fulfilled' ? (provinces.value || []) : [];

    let html = '';

    // ======== ORDER CODES SECTION ========
    html += `<div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div>
                <span style="font-size:1.5rem; font-weight:700; color:var(--primary);">${count.toLocaleString('vi-VN')}</span>
                <span style="color:var(--text-secondary);"> đơn hàng</span>
            </div>`;
    
    if (orderCodes.length > 0) {
        html += `<button class="btn btn-small" onclick="copyOrderCodes(this)" data-codes="${orderCodes.join(',')}">📋 Copy tất cả</button>`;
    }
    html += `</div>`;

    if (orderCodes.length > 0) {
        html += `<div class="order-codes-grid">`;
        orderCodes.forEach(code => {
            html += `<span class="order-code-chip" onclick="navigator.clipboard.writeText('${code}');this.style.background='rgba(34,197,94,0.3)';setTimeout(()=>this.style.background='',800)" title="Click để copy">${code}</span>`;
        });
        html += `</div>`;
    } else if (orderResult.status === 'rejected') {
        html += `<div style="color: var(--warning); font-size:0.85rem; padding:8px;">⚠ Không thể tải mã đơn</div>`;
    }
    html += `</div>`;

    // ======== PROVINCE BREAKDOWN ========
    if (provinceData.length > 0) {
        const buckets = ['0-6', '6-12', '12-24', '24-36', '36-48', '48-72', '72-96', '96-120', '120+'];
        const bucketIdx = buckets.indexOf(bucket);

        const relevantProvinces = provinceData.filter(p => {
            const agingData = p.aging[bucketIdx];
            return agingData && agingData.orders > 0;
        }).sort((a, b) => (b.aging[bucketIdx]?.orders || 0) - (a.aging[bucketIdx]?.orders || 0));

        if (relevantProvinces.length > 0) {
            html += `<div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top:12px; margin-top:8px;">
                <div style="color:var(--text-secondary); font-size:0.8rem; margin-bottom:8px;">📍 Chi tiết ${relevantProvinces.length} tỉnh/thành</div>
                <div class="province-table-wrap">
                <table class="province-table">
                    <thead>
                        <tr>
                            <th style="text-align:left;">Tỉnh/Thành</th>
                            <th class="text-center">Đơn</th>
                            <th class="text-center">Kiện</th>
                            <th class="text-center">Tổng</th>
                        </tr>
                    </thead>
                    <tbody>`;
            
            relevantProvinces.forEach(p => {
                const agingData = p.aging[bucketIdx];
                const orderCount = agingData?.orders || 0;
                const pkgCount = agingData?.packages || 0;
                
                let cls = '';
                if (orderCount >= 100) cls = 'cell-severe';
                else if (orderCount >= 50) cls = 'cell-danger';
                else if (orderCount >= 10) cls = 'cell-warning';
                else cls = 'cell-ok';
                
                html += `<tr>
                    <td class="font-medium">${p.provinceName}</td>
                    <td class="text-center ${cls}" style="font-weight:700;">${orderCount.toLocaleString('vi-VN')}</td>
                    <td class="text-center">${pkgCount > 0 ? pkgCount.toLocaleString('vi-VN') : '-'}</td>
                    <td class="text-center text-muted">${p.total.toLocaleString('vi-VN')}</td>
                </tr>`;
            });
            
            html += `</tbody></table></div></div>`;
        }
    }

    content.innerHTML = html;
}

// Helper: Copy all order codes
function copyOrderCodes(btn) {
    const codes = btn.dataset.codes;
    navigator.clipboard.writeText(codes.replace(/,/g, '\n')).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '✅ Đã copy!';
        btn.style.background = 'rgba(34,197,94,0.3)';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 1500);
    });
}

