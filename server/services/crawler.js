const puppeteer = require('puppeteer');
const { db, insertSnapshot, upsertOrder } = require('../database');
const { labelToKey, AGING_BUCKETS } = require('../utils/categories');

/**
 * Main Crawler Function
 * This script uses Puppeteer to launch a headless browser, inject the GHN cookie,
 * scrape the summary table, and click on each cell to get the order codes.
 */
async function crawlBacklog() {
    const token = process.env.GHN_TOKEN;
    const warehouseId = process.env.WAREHOUSE_ID || '20757000';
    
    if (!token) {
        throw new Error('GHN_TOKEN is not set in .env file');
    }

    console.log(`[Crawler] Bắt đầu crawl dữ liệu cho kho ${warehouseId}...`);
    
    const browser = await puppeteer.launch({
        headless: 'new', // Use new headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        
        // 1. Setup Token via Extra HTTP Headers (and evaluate to set LocalStorage just in case)
        await page.setExtraHTTPHeaders({
            'token': token
        });
        
        // Go to root first to set LocalStorage if the SPA requires it
        await page.goto('https://baocao.ghn.vn/', { waitUntil: 'domcontentloaded' });
        await page.evaluate((t) => {
            localStorage.setItem('token', t);
        }, token);

        // 2. Navigate to Backlog Page
        const targetUrl = `https://baocao.ghn.vn/backlog-ktc?warehouse_id=${warehouseId}`;
        console.log(`[Crawler] Đang truy cập: ${targetUrl}`);
        
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for the tables to render
        await page.waitForSelector('table', { timeout: 10000 });

        // 3. Scrape the Summary Table
        console.log(`[Crawler] Đang lấy bảng tổng hợp...`);
        const snapshotData = await scrapeSummaryData(page);
        
        // Save snapshot to DB
        const snapshotId = insertSnapshot({
            snapshot_time: new Date().toISOString(),
            warehouse_id: warehouseId,
            total_orders: snapshotData.total_orders,
            total_packages: snapshotData.total_packages,
            summary_data: snapshotData.summary_data,
            aging_data: snapshotData.aging_data
        });
        console.log(`[Crawler] Đã lưu Snapshot #${snapshotId} với ${snapshotData.total_orders} đơn.`);

        // 4. Drill-down: Click cells to get order codes
        console.log(`[Crawler] Bắt đầu lấy chi tiết mã đơn từng ô...`);
        let totalOrdersFetched = 0;

        for (const agingItem of snapshotData.aging_data) {
            // Only click if there are actually orders in this cell
            if (agingItem.count > 0) {
                try {
                    const orderCodes = await clickCellAndGetOrders(page, agingItem);
                    
                    // Save orders to DB
                    orderCodes.forEach(code => {
                        upsertOrder({
                            snapshot_id: snapshotId,
                            order_code: code,
                            category: agingItem.category,
                            category_label: agingItem.category_label,
                            aging_bucket: agingItem.bucket,
                            last_seen: new Date().toISOString()
                        });
                    });
                    
                    totalOrdersFetched += orderCodes.length;
                    console.log(`[Crawler] Lấy được ${orderCodes.length} mã đơn cho ${agingItem.category_label} [${agingItem.bucket}h]`);
                    
                    // Throttle to avoid rate limiting or blocking
                    await new Promise(r => setTimeout(r, 1000));
                } catch (cellErr) {
                    console.error(`[Crawler] Lỗi khi lấy ô ${agingItem.category} [${agingItem.bucket}h]:`, cellErr.message);
                }
            }
        }

        console.log(`[Crawler] Crawl hoàn tất! Đã cập nhật ${totalOrdersFetched} mã đơn.`);
        return { success: true, snapshotId, totalOrdersFetched };

    } catch (error) {
        console.error('[Crawler] Crawl thất bại:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

/**
 * Scrapes the summary tables from the DOM
 */
async function scrapeSummaryData(page) {
    return page.evaluate((agingBucketsDef) => {
        const tables = document.querySelectorAll('table');
        const summaryData = [];
        const agingData = [];
        let totalOrders = 0;
        let totalPackages = 0;

        // Assuming Table 1 is Category Summary, Table 2 is Order Aging, Table 3 is Package Aging
        if (tables.length < 2) throw new Error('Không tìm thấy bảng dữ liệu trên trang');

        const orderAgingTable = tables[1]; // Phân loại (đơn hàng)
        const rows = orderAgingTable.querySelectorAll('tbody tr');

        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 2) return;

            // First cell is usually the category name (e.g. "+ Đang luân chuyển đến KTC")
            let categoryText = cells[0].innerText.replace('+', '').trim();
            if (categoryText.includes('Tổng')) return; // Skip total row if exists in tbody

            // Determine category key (must match our categories.js logic closely)
            const categoryKey = categoryText.toLowerCase().replace(/\s+/g, '_');
            
            let rowTotal = 0;
            // Next cells correspond to aging buckets: 0-6, 6-12, 12-24, ...
            cells.slice(1).forEach((cell, idx) => {
                if (idx >= agingBucketsDef.length) return;
                
                const count = parseInt(cell.innerText.replace(/\./g, '').replace(/,/g, '')) || 0;
                rowTotal += count;
                
                if (count > 0) {
                    agingData.push({
                        category: categoryKey,
                        category_label: categoryText,
                        bucket: agingBucketsDef[idx],
                        count: count,
                        // Save DOM coordinates to click later
                        _colIndex: idx + 1,
                        _rowIndex: row.rowIndex
                    });
                }
            });

            summaryData.push({ category: categoryKey, category_label: categoryText, count: rowTotal });
            totalOrders += rowTotal;
        });

        return { total_orders: totalOrders, total_packages: 0 /* Skip pkg parse for now */, summary_data: summaryData, aging_data: agingData };
    }, AGING_BUCKETS);
}

/**
 * Clicks a specific cell and extracts order codes from the resulting popup
 */
async function clickCellAndGetOrders(page, agingItem) {
    // 1. Click the specific table cell based on coordinates saved during scrape
    await page.evaluate((rowIdx, colIdx) => {
        const tables = document.querySelectorAll('table');
        if (tables.length >= 2) {
            const row = tables[1].rows[rowIdx];
            if (row && row.cells[colIdx]) {
                const link = row.cells[colIdx].querySelector('a, div, span'); // Find clickable element
                if (link) link.click();
                else row.cells[colIdx].click(); // Click cell directly if no link
            }
        }
    }, agingItem._rowIndex, agingItem._colIndex);

    // 2. Wait for popup/modal to appear (usually contains "Download CSV" button)
    // Adjust selector based on actual GHN popup class
    const popupSelector = '.modal-content, .ant-modal-content, .popup-container'; 
    try {
        await page.waitForSelector(popupSelector, { timeout: 5000, visible: true });
        
        // 3. Extract order codes (assuming they are rendered as text pills or table rows)
        const orderCodes = await page.evaluate((selector) => {
            const popup = document.querySelector(selector);
            if (!popup) return [];
            
            // This is a generic regex to find GHN order codes (e.g. 8-10 uppercase alphanumeric chars)
            const text = popup.innerText;
            const regex = /[A-Z0-9]{8,12}/g; 
            const matches = text.match(regex) || [];
            
            // Deduplicate and filter obvious false positives
            return [...new Set(matches)].filter(m => m.length >= 8);
        }, popupSelector);

        // 4. Close the popup
        await page.keyboard.press('Escape'); // Try ESC to close
        await new Promise(r => setTimeout(r, 500)); // wait for animation
        
        return orderCodes;

    } catch (e) {
        // If popup doesn't appear, close just in case
        await page.keyboard.press('Escape');
        throw new Error('Popup not found after click');
    }
}

// Removed parseCookieString as it's no longer needed for tokens

module.exports = { crawlBacklog };
