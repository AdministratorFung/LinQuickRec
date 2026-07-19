// Shared Metrics + Graph component
// Used by Perf (top + detail), Test (results), Series (detail)

function getChartColors() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        bg: dark ? '#1e293b' : '#ffffff',
        grid: dark ? '#2c3a4f' : '#e6e8ec',
        text: dark ? '#98a2b3' : '#656d77',
        axis: dark ? '#64748b' : '#94a3b8',
        bars: ['#206bc4', '#4299e1', '#48bb78', '#ed8936', '#9f7aea', '#f56565'],
    };
}

function drawBarChart(canvasId, chartRef, stats, height) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) return;

    var ctx = canvas.getContext('2d');
    if (chartRef) chartRef.value = ctx;
    var colors = getChartColors();
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.offsetWidth;
    var ch = height || 240;

    // Fix: explicit CSS dimensions prevent DPR double-scaling blur
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, cw, ch);

    var values = [
        { label: 'Min', v: stats.min || 0 },
        { label: 'Avg', v: stats.avg || 0 },
        { label: 'P50', v: stats.p50 || 0 },
        { label: 'P99', v: stats.p99 || 0 },
        { label: 'Max', v: stats.max || 0 },
        { label: 'StdDev', v: stats.stddev || 0 },
    ];
    var maxVal = Math.max.apply(null, values.map(function(v) { return v.v; }));
    if (maxVal < 1) maxVal = 1;

    var pad = { top: 24, right: 16, bottom: 34, left: 48 };
    var chartW = cw - pad.left - pad.right;
    var chartH = ch - pad.top - pad.bottom;
    var barGap = 8;
    var barW = (chartW - barGap * (values.length + 1)) / values.length;

    // Y-axis grid
    ctx.font = '11px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.text;
    for (var i = 0; i <= 4; i++) {
        var y = pad.top + (chartH / 4) * (4 - i);
        var val = (maxVal / 4) * i;
        ctx.beginPath();
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.moveTo(pad.left, y);
        ctx.lineTo(cw - pad.right, y);
        ctx.stroke();
        ctx.fillText(Number(val).toFixed(1), pad.left - 6, y + 4);
    }

    // Bars + value labels
    for (var i = 0; i < values.length; i++) {
        var x = pad.left + barGap + i * (barW + barGap);
        var barH = values[i].v > 0 ? Math.max((values[i].v / maxVal) * chartH, 2) : 0;
        var y = pad.top + chartH - barH;

        // Subtle background band
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = colors.bars[i];
        ctx.fillRect(x, pad.top, barW, chartH);
        ctx.globalAlpha = 1;

        // Solid bar
        ctx.fillStyle = colors.bars[i];
        ctx.fillRect(x, y, barW, barH);

        // Value label on top of bar
        ctx.fillStyle = colors.text;
        ctx.textAlign = 'center';
        ctx.font = '10px Inter, -apple-system, sans-serif';
        ctx.fillText(Number(values[i].v).toFixed(1), x + barW / 2, y - 3);

        // Label below
        ctx.font = '11px Inter, -apple-system, sans-serif';
        ctx.fillText(values[i].label, x + barW / 2, ch - 8);
    }
}

function statCard(label, value, unit, color, metric) {
    var u = unit ? '<div class="stat-unit">' + unit + '</div>' : '';
    return '<div class="stat-card" style="border-left-color:' + color + '"><div class="stat-body"><div class="stat-label">' + label + '</div><div class="stat-value" data-metric="' + (metric || '') + '">' + value + '</div>' + u + '</div></div>';
}

function buildMetricsHTML(stats, opts) {
    var html = '';

    // Line 1: count, success, fail (left-aligned)
    html += '<div class="stats-summary">';
    if (opts.showStatus && stats.status) {
        var badgeClass = stats.status === 'active' ? 'badge badge-green' : 'badge badge-gray';
        html += '<div class="stat-card" style="border-left-color:#206bc4"><div class="stat-body"><div class="stat-label">Status</div><div class="stat-value"><span class="' + badgeClass + '">' + stats.status + '</span></div></div></div>';
    }
    html += statCard(opts.countLabel || 'Count', stats.count, 'spans', '#206bc4', 'count');
    html += statCard('Success', stats.success !== undefined ? stats.success : 'N/A', '', '#48bb78', 'success');
    html += statCard('Fail', stats.fail !== undefined ? stats.fail : 'N/A', '', '#f56565', 'fail');
    html += '</div>';

    // Line 2: avg, p50, p99, min, max
    html += '<div class="stats-summary">';
    html += statCard('Avg', stats.avg.toFixed(1), 'ms', '#4299e1', 'avg');
    html += statCard('P50', stats.p50.toFixed(1), 'ms', '#9f7aea', 'p50');
    html += statCard('P99', stats.p99.toFixed(1), 'ms', '#ed8936', 'p99');
    html += statCard('Min', stats.min.toFixed(1), 'ms', '#48bb78', 'min');
    html += statCard('Max', stats.max.toFixed(1), 'ms', '#f56565', 'max');
    html += '</div>';

    // Line 3: chart
    if (opts.chartId) {
        html += '<div class="chart-container" style="margin-top:16px;margin-bottom:16px;max-width:800px"><h3>' + (opts.title || 'Latency Distribution') + '</h3><canvas id="' + opts.chartId + '" style="width:100%;height:' + (opts.chartHeight || 240) + 'px"></canvas></div>';
    }

    return html;
}

var _metricCards = {};

function setMetric(container, metric, value) {
    var el = container.querySelector('[data-metric="' + metric + '"]');
    if (el) el.textContent = value;
}

function renderMetricsGraph(containerId, stats, opts) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = buildMetricsHTML(stats, opts);
    if (opts.chartId) {
        var chartStats = { min: stats.min, avg: stats.avg, p50: stats.p50, p99: stats.p99, max: stats.max, stddev: stats.stddev || 0 };
        setTimeout(function() { drawBarChart(opts.chartId, {}, chartStats, opts.chartHeight || 240); }, 50);
    }
}

function updateMetricsGraph(containerId, stats, opts) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!container.querySelector('.stat-card')) {
        container.innerHTML = buildMetricsHTML(stats, opts);
    } else {
        setMetric(container, 'count', stats.count);
        setMetric(container, 'success', stats.success !== undefined ? stats.success : 'N/A');
        setMetric(container, 'fail', stats.fail !== undefined ? stats.fail : 'N/A');
        setMetric(container, 'avg', stats.avg.toFixed(1));
        setMetric(container, 'p50', stats.p50.toFixed(1));
        setMetric(container, 'p99', stats.p99.toFixed(1));
        setMetric(container, 'min', stats.min.toFixed(1));
        setMetric(container, 'max', stats.max.toFixed(1));
    }

    if (opts.chartId) {
        var chartStats = { min: stats.min, avg: stats.avg, p50: stats.p50, p99: stats.p99, max: stats.max, stddev: stats.stddev || 0 };
        drawBarChart(opts.chartId, {}, chartStats, opts.chartHeight || 240);
    }
}
