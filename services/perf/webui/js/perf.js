// Perf tab — fixed proxy_e2e header + call tree with proportion bars + detail panel
let topChart = null;
let detailChart = null;
let selectedSvc = null;
let selectedStg = null;
let treeStats = {}; // "service|stage" → {avg, p50, p99, min, max, count, stddev}

let callTree = null;

function treeKey(svc, stg) { return svc + '|' + stg; }
function treeStat(svc, stg) { return treeStats[treeKey(svc, stg)]; }

function pctColor(pct) {
    // Blue (#206bc4) → Red (#f56565) gradient by percentage
    const t = Math.min(Math.max(pct, 0), 100) / 100;
    const r = Math.round(32 + (245 - 32) * t);
    const g = Math.round(107 + (101 - 107) * t);
    const b = Math.round(196 + (101 - 196) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
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

function drawBarChart(canvasId, chartRef, stats, height) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.height = height || 220;
    const ctx = canvas.getContext('2d');
    if (chartRef) chartRef.value = ctx;
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
    const pad = { top: 24, right: 16, bottom: 28, left: 44 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const barGap = 8;
    const barW = (chartW - barGap * (values.length + 1)) / values.length;

    ctx.fillStyle = colors.text;
    ctx.font = '10px Inter, -apple-system, sans-serif';
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
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = colors.bars[i];
        ctx.fillRect(x, pad.top, barW, chartH);
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.bars[i];
        ctx.fillRect(x, y, barW, barH);
        ctx.fillStyle = colors.text;
        ctx.font = '10px Inter, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(values[i].label, x + barW / 2, h - 4);
    }
}

function updateTopCards(stats) {
    const hasData = (stats.count || 0) > 0;
    const cards = [
        { id: 'card-count', value: stats.count || 0, unit: 'spans' },
        { id: 'card-avg', value: hasData ? (stats.avg || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '' },
        { id: 'card-p50', value: hasData ? (stats.p50 || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '' },
        { id: 'card-p99', value: hasData ? (stats.p99 || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '' },
        { id: 'card-min', value: hasData ? (stats.min || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '' },
        { id: 'card-max', value: hasData ? (stats.max || 0).toFixed(1) : 'N/A', unit: hasData ? 'ms' : '' },
    ];
    for (const c of cards) {
        const el = document.getElementById(c.id);
        if (!el) continue;
        el.querySelector('.stat-value').textContent = c.value;
        el.querySelector('.stat-unit').textContent = c.unit;
    }
}

function updateDetailCards(stats) {
    const hasData = (stats.count || 0) > 0;
    const info = [
        { label: 'Avg', value: hasData ? (stats.avg || 0).toFixed(1) + ' ms' : 'N/A' },
        { label: 'P50', value: hasData ? (stats.p50 || 0).toFixed(1) + ' ms' : 'N/A' },
        { label: 'P99', value: hasData ? (stats.p99 || 0).toFixed(1) + ' ms' : 'N/A' },
        { label: 'Count', value: stats.count || 0 },
        { label: 'Min', value: hasData ? (stats.min || 0).toFixed(1) + ' ms' : 'N/A' },
        { label: 'Max', value: hasData ? (stats.max || 0).toFixed(1) + ' ms' : 'N/A' },
    ];
    let html = '';
    for (const i of info) {
        html += '<div class="detail-stat"><span class="detail-stat-label">' + i.label + '</span><span class="detail-stat-value">' + i.value + '</span></div>';
    }
    document.getElementById('detail-metrics').innerHTML = html;
}

async function refreshTop() {
    const stats = await fetchStats('proxy', 'proxy_e2e');
    if (!stats || stats.error) {
        for (const id of ['card-count', 'card-avg', 'card-p50', 'card-p99', 'card-min', 'card-max']) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.querySelector('.stat-value').textContent = 'N/A';
            el.querySelector('.stat-unit').textContent = stats ? stats.error : 'no data';
        }
        return;
    }
    updateTopCards(stats);
    try { drawBarChart('chart', { value: topChart }, stats, 240); } catch (e) { console.error(e); }
}

async function refreshDetail() {
    if (!selectedSvc || !selectedStg) return;
    const stats = await fetchStats(selectedSvc, selectedStg);
    if (!stats || stats.error) return;
    updateDetailCards(stats);
    try { drawBarChart('detail-chart', { value: detailChart }, stats, 160); } catch (e) { console.error(e); }
    updateTreeValues();
    highlightTree();
}

async function fetchAllTreeStats() {
    if (!callTree) return;
    function collect(nodes, list) {
        for (const n of nodes) {
            list.push({ service: n.service, stage: n.stage });
            if (n.children) collect(n.children, list);
        }
    }
    const all = [];
    collect(callTree, all);
    for (const n of all) {
        const stats = await fetchStats(n.service, n.stage);
        if (stats && !stats.error) treeStats[treeKey(n.service, n.stage)] = stats;
    }
}

function selectDetailNode(svc, stg) {
    selectedSvc = svc;
    selectedStg = stg;
    document.getElementById('perf-detail').style.display = 'block';
    document.getElementById('detail-stage-name').textContent = svc + ' / ' + stg;
    highlightTree();
    refreshDetail();
}

function highlightTree() {
    document.querySelectorAll('.tree-node-name').forEach(el => {
        el.classList.toggle('selected', el.dataset.service === selectedSvc && el.dataset.stage === selectedStg);
    });
}

function renderTree() {
    const container = document.getElementById('perf-tree');
    if (!container) return;
    if (!callTree || !callTree.length) {
        container.innerHTML = '<div class="empty-state">Failed to load tree structure. <button class="btn btn-ghost" onclick="refreshTreeStructure()">Retry</button></div>';
        return;
    }
    const rootStat = treeStat('proxy', 'proxy_e2e');
    const rootAvg = rootStat && rootStat.count > 0 ? rootStat.avg : 0;

    function buildHTML(nodes, depth, parentAvg) {
        let html = '';
        for (const n of nodes) {
            const stat = treeStat(n.service, n.stage);
            const hasData = stat && stat.count > 0;
            const count = stat ? stat.count : 0;
            const avg = hasData ? stat.avg : 0;
            const pct = parentAvg > 0 && avg > 0 ? Math.round(avg / parentAvg * 100) : 0;
            const color = pctColor(pct);
            const hasChildren = n.children && n.children.length > 0;
            const isSelected = selectedSvc && n.service === selectedSvc && n.stage === selectedStg;
            const isDefault = !selectedSvc && depth === 0;

            html += '<div class="tree-node" style="padding-left:' + (depth * 22) + 'px">';
            html += '<span class="tree-arrow' + (hasChildren ? (depth < 2 ? ' expanded' : '') : ' leaf') + '"' + (hasChildren ? ' onclick="toggleTree(this)"' : '') + '>' + (hasChildren ? '▶' : '') + '</span>';
            html += '<span class="tree-node-name' + ((isSelected || isDefault) ? ' selected' : '') + '" data-service="' + n.service + '" data-stage="' + n.stage + '" onclick="selectDetailNode(\'' + n.service + '\',\'' + n.stage + '\')">' + n.stage + '</span>';

            html += '<span class="tree-bar-wrap"><span class="tree-bar-fill" style="width:' + (hasData ? Math.min(pct, 100) : 0) + '%;background:' + (hasData ? color : 'transparent') + '"></span></span>';
            html += '<span class="tree-pct">' + (hasData ? pct + '%' : '') + '</span>';
            html += '<span class="tree-val' + (hasData ? '' : ' no-data') + '">' + (hasData ? avg.toFixed(1) + ' ms (' + count + ')' : '—') + '</span>';

            html += '</div>';

            if (hasChildren) {
                html += '<div class="tree-children' + (depth < 2 ? '' : ' hidden') + '">';
                html += buildHTML(n.children, depth + 1, hasData ? avg : parentAvg);
                html += '</div>';
            }
        }
        return html;
    }
    var btnHtml = ' <button class="btn btn-ghost" onclick="refreshTreeStructure()" style="font-size:11px;padding:1px 8px;margin-left:8px">Refresh Tree</button>';
    container.innerHTML = '<div class="tree-label">Call Tree' + btnHtml + '</div>' + buildHTML(callTree, 0, rootAvg);
}

function toggleTree(arrow) {
    arrow.classList.toggle('expanded');
    const sibling = arrow.parentElement.nextElementSibling;
    if (sibling && sibling.classList.contains('tree-children')) sibling.classList.toggle('hidden');
}

function updateTreeValues() {
    if (!callTree) return;
    const rootStat = treeStat('proxy', 'proxy_e2e');
    const rootAvg = rootStat && rootStat.count > 0 ? rootStat.avg : 0;

    function update(nodes, depth, parentAvg) {
        for (const n of nodes) {
            const nameEl = document.querySelector('.tree-node-name[data-service="' + n.service + '"][data-stage="' + n.stage + '"]');
            if (!nameEl) continue;
            const nodeDiv = nameEl.parentElement;
            const stat = treeStat(n.service, n.stage);
            const hasData = stat && stat.count > 0;
            const avg = hasData ? stat.avg : 0;
            const pct = parentAvg > 0 && avg > 0 ? Math.round(avg / parentAvg * 100) : 0;
            const color = pctColor(pct);

            const barFill = nodeDiv.querySelector('.tree-bar-fill');
            const pctEl = nodeDiv.querySelector('.tree-pct');
            const valEl = nodeDiv.querySelector('.tree-val');

            if (hasData) {
                if (barFill) { barFill.style.width = Math.min(pct, 100) + '%'; barFill.style.background = color; }
                if (pctEl) pctEl.textContent = pct + '%';
                if (valEl) { valEl.textContent = avg.toFixed(1) + ' ms (' + stat.count + ')'; valEl.classList.remove('no-data'); }
            } else {
                if (barFill) { barFill.style.width = '0%'; barFill.style.background = 'transparent'; }
                if (pctEl) pctEl.textContent = '';
                if (valEl) { valEl.textContent = '\u2014'; valEl.classList.add('no-data'); }
            }

            if (n.children) update(n.children, depth + 1, hasData ? avg : parentAvg);
        }
    }
    update(callTree, 0, rootAvg);
}

async function refreshData() {
    await fetchAllTreeStats();
    updateTreeValues();
    refreshTop();
    if (selectedSvc && selectedStg) {
        const st = treeStat(selectedSvc, selectedStg);
        if (st) {
            updateDetailCards(st);
            try { drawBarChart('detail-chart', { value: detailChart }, st, 160); } catch (e) { console.error(e); }
        }
    }
}

async function refreshTreeStructure() {
    const fresh = await fetchTreeStructure();
    if (fresh && fresh.length) {
        callTree = fresh;
        await fetchAllTreeStats();
        renderTree();
    }
}

async function initPerf() {
    callTree = await fetchTreeStructure();
    if (!callTree || !callTree.length) {
        renderTree();
        return;
    }
    refreshTop();
    await fetchAllTreeStats();
    renderTree();
}

initPerf();
setInterval(refreshData, 1000);

document.documentElement.addEventListener('themechange', async () => {
    const stats = await fetchStats('proxy', 'proxy_e2e');
    if (stats && !stats.error) try { drawBarChart('chart', { value: topChart }, stats, 240); } catch (e) {}
    if (selectedSvc && selectedStg) {
        const dStats = await fetchStats(selectedSvc, selectedStg);
        if (dStats && !dStats.error) try { drawBarChart('detail-chart', { value: detailChart }, dStats, 160); } catch (e) {}
    }
});
