let chartCtx = null;
let chartDpr = 1;

function getChartColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        bg: dark ? '#1e293b' : '#ffffff',
        grid: dark ? '#2c3a4f' : '#e6e8ec',
        text: dark ? '#98a2b3' : '#656d77',
        axis: dark ? '#64748b' : '#94a3b8',
        bars: ['#206bc4', '#4299e1', '#48bb78', '#ed8936', '#9f7aea', '#f56565'],
    };
}

function drawChart(stats) {
    const canvas = document.getElementById('chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    chartCtx = ctx;

    const colors = getChartColors();
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    const values = [
        { label: 'Min', v: stats.min || 0 },
        { label: 'Avg', v: stats.avg || 0 },
        { label: 'P50', v: stats.p50 || 0 },
        { label: 'P99', v: stats.p99 || 0 },
        { label: 'Max', v: stats.max || 0 },
        { label: 'StdDev', v: stats.stddev || 0 },
    ];

    const maxVal = Math.max(...values.map(v => v.v), 1);
    const pad = { top: 24, right: 16, bottom: 32, left: 52 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const barGap = 12;
    const barCount = values.length;
    const barW = (chartW - barGap * (barCount + 1)) / barCount;

    // Y-axis grid + labels
    ctx.fillStyle = colors.text;
    ctx.font = '11px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
        const y = pad.top + (chartH / steps) * (steps - i);
        const val = (maxVal / steps) * i;
        ctx.beginPath();
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.fillText(Number(val).toFixed(1), pad.left - 6, y + 4);
    }

    // Bars
    for (let i = 0; i < values.length; i++) {
        const x = pad.left + barGap + i * (barW + barGap);
        const barH = values[i].v > 0 ? Math.max((values[i].v / maxVal) * chartH, 2) : 0;
        const y = pad.top + chartH - barH;

        ctx.fillStyle = colors.bars[i];
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
        ctx.fill();

        // Light fill for the rest
        if (barH > 0) {
            ctx.globalAlpha = 0.12;
            ctx.beginPath();
            ctx.roundRect(x, pad.top, barW, chartH - barH, 0);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // Label
        ctx.fillStyle = colors.text;
        ctx.font = '10px Inter, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(values[i].label, x + barW / 2, h - 4);
    }

    // Y-axis title
    ctx.save();
    ctx.translate(10, pad.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('ms', 0, 0);
    ctx.restore();
}

function updateCards(stats) {
    const cards = [
        { id: 'card-count', value: stats.count || 0, unit: 'spans', color: '#206bc4', label: 'Count' },
        { id: 'card-avg', value: (stats.avg || 0).toFixed(2), unit: 'ms', color: '#4299e1', label: 'Average' },
        { id: 'card-p50', value: (stats.p50 || 0).toFixed(2), unit: 'ms', color: '#48bb78', label: 'P50' },
        { id: 'card-p99', value: (stats.p99 || 0).toFixed(2), unit: 'ms', color: '#ed8936', label: 'P99' },
        { id: 'card-min', value: (stats.min || 0).toFixed(2), unit: 'ms', color: '#9f7aea', label: 'Min' },
        { id: 'card-max', value: (stats.max || 0).toFixed(2), unit: 'ms', color: '#f56565', label: 'Max' },
    ];
    for (const c of cards) {
        const el = document.getElementById(c.id);
        if (!el) continue;
        el.querySelector('.stat-value').textContent = c.value;
        el.querySelector('.stat-unit').textContent = c.unit;
    }
}

function setLoading(state) {
    const ids = ['card-count', 'card-avg', 'card-p50', 'card-p99', 'card-min', 'card-max'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (state) {
            el.querySelector('.stat-value').textContent = '...';
            el.querySelector('.stat-unit').textContent = '';
        }
    }
}

async function refresh() {
    const sel = document.getElementById('stageSelect').value;
    const [service, stage] = sel.split('|');
    setLoading(true);

    const stats = await fetchStats(service, stage);
    if (!stats || stats.error) {
        for (const id of ['card-count', 'card-avg', 'card-p50', 'card-p99', 'card-min', 'card-max']) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.querySelector('.stat-value').textContent = 'N/A';
            el.querySelector('.stat-unit').textContent = stats ? stats.error : 'no data';
        }
        return;
    }

    updateCards(stats);
    drawChart(stats);
}

function onStageChange() {
    refresh();
}

refresh();
setInterval(refresh, 3000);
