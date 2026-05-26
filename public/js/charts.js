const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    color: '#94a3b8',
    plugins: {
        legend: { labels: { color: '#f8fafc' } }
    },
    scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
    }
};

let trendChartInstance = null;
let categoryChartInstance = null;

function renderTrendChart(canvasId, data) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    const labels = data.map(d => new Date(d.snapshot_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
    
    // Create gradient
    const gradientTotal = ctx.createLinearGradient(0, 0, 0, 400);
    gradientTotal.addColorStop(0, 'rgba(255, 107, 53, 0.5)'); // GHN orange
    gradientTotal.addColorStop(1, 'rgba(255, 107, 53, 0.0)');

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Total Backlog',
                    data: data.map(d => d.total_orders),
                    borderColor: '#ff6b35',
                    backgroundColor: gradientTotal,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: '24h+',
                    data: data.map(d => d.backlog_24h),
                    borderColor: '#eab308', // yellow
                    borderDash: [5, 5],
                    tension: 0.4
                },
                {
                    label: '48h+',
                    data: data.map(d => d.backlog_48h),
                    borderColor: '#ef4444', // red
                    borderDash: [2, 2],
                    tension: 0.4
                }
            ]
        },
        options: chartOptions
    });
}

function renderCategoryChart(canvasId, categories) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    categoryChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: categories.map(c => c.category_label || c.category),
            datasets: [{
                label: 'Số đơn',
                data: categories.map(c => c.count),
                backgroundColor: '#ff6b35',
                borderRadius: 4
            }]
        },
        options: {
            ...chartOptions,
            indexAxis: 'y', // Horizontal bar
            plugins: { legend: { display: false } }
        }
    });
}
