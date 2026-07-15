// Perf tab — tree view with live stats cards
let perfChart = null;
let selectedService = 'proxy';
let selectedStage = 'proxy_e2e';
let stageData = [];  // [{service, stage, count}, ...]

const CALL_TREE = [
    { service: 'proxy', stage: 'proxy_e2e',
        children: [
            { service: 'proxy', stage: 'recall_rpc',
                children: [
                    { service: 'recall', stage: 'recall_total',
                        children: [{ service: 'recall', stage: 'vllm_rpc' }]
                    }
                ]
            },
            { service: 'proxy', stage: 'feature_rpc',
                children: [
                    { service: 'feature', stage: 'feature_total',
                        children: [{ service: 'feature', stage: 'generate_user_logs' }]
                    }
                ]
            },
            { service: 'proxy', stage: 'precalc_rpc',
                children: [{ service: 'precalc', stage: 'precalc_total' }]
            },
            { service: 'proxy', stage: 'rank_rpc',
                children: [
                    { service: 'rank_master', stage: 'rank_master_total',
                        children: [{ service: 'rank_sub', stage: 'rank_sub_total' }]
                    }
                ]
            },
            { service: 'proxy', stage: 'recall_precalc_parallel_wait' }
        ]
    }
];

function nodeData(service, stage) {
    return stageData.find(d => d.service === service && d.stage === stage);
}

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
    perfChart = ctx;

    const colors = getChartColors();
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
    const barW = (chartW - barGap * (values.length + 1)) / values.length;

    ctx.fillStyle = colors.text;
    ctx.font = '11px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (chartH / 4) * (4 - i);
        const val = (maxVal / 4) * i;
        ctx.beginPath();
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.fillText(Number(val).toFixed(1), pad.left - 6, y + 4);
    }

    for (let i = 0; i < values.length; i++) {
        const x = pad.left + barGap + i * (barW + barGap);
        const barH = values[i].v > 0 ? Math.max((values[i].v / maxVal) * chartH, 2) : 0;
        const y = pad.top + chartH - barH;

        ctx.fillStyle = colors.bars[i];
        ctx.beginPath();
        ctx.rect(x, y, barW, barH);
        ctx.fill();

        ctx.globalAlpha = 0.12;
        ctx.fillStyle = colors.bars[i];
        ctx.beginPath();
        ctx.rect(x, pad.top, barW, chartH - barH);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = colors.text;
        ctx.font = '10px Inter, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(values[i].label, x + barW / 2, h - 4);
    }

    ctx.save();
    ctx.translate(10, pad.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('ms', 0, 0);
    ctx.restore();
}

function updateCards(stats) {
    const hasData = (stats.count || 0) > 0;
    const cards = [
        { id: 'card-count', value: stats.count || 0, unit: 'spans', label: 'Count' },
        { id: 'card-avg', value: hasData ? (stats.avg || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '', label: 'Average' },
        { id: 'card-p50', value: hasData ? (stats.p50 || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '', label: 'P50' },
        { id: 'card-p99', value: hasData ? (stats.p99 || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '', label: 'P99' },
        { id: 'card-min', value: hasData ? (stats.min || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '', label: 'Min' },
        { id: 'card-max', value: hasData ? (stats.max || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '', label: 'Max' },
    ];
    for (const c of cards) {
        const el = document.getElementById(c.id);
        if (!el) continue;
        el.querySelector('.stat-value').textContent = c.value;
        el.querySelector('.stat-unit').textContent = c.unit;
    }
    const infoEl = document.getElementById('perf-stage-info');
    if (infoEl) {
        const d = nodeData(selectedService, selectedStage);
        infoEl.textContent = d && d.count ? selectedService + ' / ' + selectedStage : selectedService + ' / ' + selectedStage + ' (no data)';
    }
}

function highlightTree() {
    document.querySelectorAll('.tree-node-name').forEach(el => {
        const svc = el.dataset.service;
        const stg = el.dataset.stage;
        el.classList.toggle('selected', svc === selectedService && stg === selectedStage);
    });
}

function buildTree(nodes, container, depth) {
    for (const n of nodes) {
        const d = nodeData(n.service, n.stage);
        const hasData = d && d.count > 0;
        const hasChildren = n.children && n.children.length > 0;
        const dur = hasData ? (d.avg ? d.avg.toFixed(1) + ' ms (' + d.count + ')' : '—') : '—';

        const div = document.createElement('div');
        div.className = 'tree-node';
        div.style.paddingLeft = (depth * 24) + 'px';

        let html = '<span class="tree-arrow' + (depth === 0 ? ' expanded' : '') + '" onclick="toggleTree(this)">▶</span>';
        html += '<span class="tree-node-name' + (depth === 0 ? ' selected' : '') + '" data-service="' + n.service + '" data-stage="' + n.stage + '" onclick="selectNode(\'' + n.service + '\', \'' + n.stage + '\')">' + n.stage + '</span>';
        html += '<span class="tree-dur ' + (hasData ? '' : 'no-data') + '">' + dur + '</span>';
        div.innerHTML = html;

        if (hasChildren) {
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children' + (depth === 0 ? '' : ' hidden');
            buildTree(n.children, childContainer, depth + 1);
            div.appendChild(childContainer);
        }
        container.appendChild(div);
    }
}

function toggleTree(arrow) {
    arrow.classList.toggle('expanded');
    const children = arrow.parentElement.querySelector('.tree-children');
    if (children) children.classList.toggle('hidden');
}

function selectNode(service, stage) {
    selectedService = service;
    selectedStage = stage;
    highlightTree();
    refreshPerf();
}

async function refreshPerf() {
    const stats = await fetchStats(selectedService, selectedStage);
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
    try { drawChart(stats); } catch (e) { console.error('[perf] drawChart error:', e); }
}

async function doInitPerf() {
    // Load stage data
    stageData = await fetchStages();
    console.log('[perf] init: loaded', stageData.length, 'stages');

    // Build tree
    const container = document.getElementById('perf-tree');
    if (!container) return;
    container.innerHTML = '<div class="tree-label">Call Tree</div>';
    buildTree(CALL_TREE, container, 0);

    // First refresh for proxy_e2e
    refreshPerf();
}

async function initPerf() {
    try {
        const resp = await fetch('/api/v1/health');
        const h = await resp.json();
        if (h.status === 'initializing') {
            const overlay = document.getElementById('init-overlay');
            const bar = document.getElementById('init-bar-fill');
            const text = document.getElementById('init-text');
            if (overlay) overlay.style.display = 'flex';
            const interval = setInterval(async () => {
                try {
                    const r = await fetch('/api/v1/health');
                    const s = await r.json();
                    if (s.status === 'ok') {
                        clearInterval(interval);
                        if (overlay) overlay.style.display = 'none';
                        doInitPerf();
                    } else {
                        const pct = s.total > 0 ? Math.round(s.progress / s.total * 100) : 0;
                        if (bar) bar.style.width = pct + '%';
                        if (text) text.textContent = s.progress + ' / ' + s.total;
                    }
                } catch (e) {}
            }, 2000);
            return;
        }
    } catch (e) {}
    doInitPerf();
}

initPerf();
setInterval(refreshPerf, 3000);

document.documentElement.addEventListener('themechange', () => {
    fetchStats(selectedService, selectedStage).then(stats => {
        if (stats && !stats.error) {
            try { drawChart(stats); } catch (e) { console.error(e); }
        }
    });
});
