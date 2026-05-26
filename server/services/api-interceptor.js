/**
 * API Interceptor - Discovers GHN API endpoints by intercepting browser network traffic
 * Run this once to find the exact API endpoints and response format
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const puppeteer = require('puppeteer');

async function interceptAPICalls() {
    const token = process.env.GHN_TOKEN;
    if (!token) throw new Error('GHN_TOKEN is not set in .env');

    console.log('[Interceptor] Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Capture all API requests and responses
        const apiCalls = [];

        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('baocao-api.ghn.vn') || url.includes('api.ghn')) {
                const req = response.request();
                let responseBody = null;
                try {
                    responseBody = await response.json();
                } catch (e) {
                    try { responseBody = await response.text(); } catch (e2) { responseBody = 'COULD NOT READ'; }
                }

                const entry = {
                    url: url,
                    method: req.method(),
                    requestHeaders: req.headers(),
                    postData: req.postData() || null,
                    status: response.status(),
                    responseBody: responseBody
                };
                apiCalls.push(entry);

                // Print immediately
                console.log(`\n${'='.repeat(80)}`);
                console.log(`[API CALL] ${req.method()} ${url}`);
                console.log(`[STATUS] ${response.status()}`);
                if (req.postData()) console.log(`[POST BODY] ${req.postData()}`);
                
                // Print response (truncated for readability)
                const bodyStr = JSON.stringify(responseBody, null, 2);
                if (bodyStr.length > 2000) {
                    console.log(`[RESPONSE] (truncated to 2000 chars)\n${bodyStr.substring(0, 2000)}...`);
                } else {
                    console.log(`[RESPONSE]\n${bodyStr}`);
                }
            }
        });

        // Set token header
        await page.setExtraHTTPHeaders({ 'token': token });

        // Navigate to root first to set localStorage
        console.log('[Interceptor] Navigating to baocao.ghn.vn...');
        await page.goto('https://baocao.ghn.vn/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.evaluate((t) => { localStorage.setItem('token', t); }, token);

        // Now navigate to backlog page
        const warehouseId = process.env.WAREHOUSE_ID || '20757000';
        const targetUrl = `https://baocao.ghn.vn/backlog-ktc?warehouse_id=${warehouseId}`;
        console.log(`[Interceptor] Navigating to ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait a bit more for lazy-loaded data
        await new Promise(r => setTimeout(r, 5000));

        console.log(`\n${'='.repeat(80)}`);
        console.log(`[SUMMARY] Captured ${apiCalls.length} API calls total.`);
        console.log(`[SUMMARY] Unique endpoints:`);
        const uniqueUrls = [...new Set(apiCalls.map(c => `${c.method} ${c.url}`))];
        uniqueUrls.forEach(u => console.log(`  - ${u}`));

        // Save full results to file
        const fs = require('fs');
        const outputPath = require('path').join(__dirname, '..', '..', 'api-discovery-results.json');
        fs.writeFileSync(outputPath, JSON.stringify(apiCalls, null, 2), 'utf8');
        console.log(`\n[Interceptor] Full results saved to: ${outputPath}`);

    } finally {
        await browser.close();
    }
}

interceptAPICalls().catch(err => {
    console.error('[Interceptor] FATAL:', err.message);
    process.exit(1);
});
