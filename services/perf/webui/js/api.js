const API_BASE = '';

async function fetchStats(service, stage) {
    const url = `${API_BASE}/api/v1/stats/current?service=${encodeURIComponent(service)}&stage=${encodeURIComponent(stage)}`;
    console.log('[api] fetchStats:', url);
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[api] fetchStats failed: HTTP', resp.status);
            return { error: `HTTP ${resp.status}` };
        }
        const data = await resp.json();
        console.log('[api] fetchStats ok: count=', data.count, 'avg=', data.avg);
        return data;
    } catch (e) {
        console.error('[api] fetchStats error:', e.message);
        return { error: e.message };
    }
}

async function fetchSeriesList() {
    console.log('[api] fetchSeriesList');
    try {
        const resp = await fetch(`${API_BASE}/api/v1/series`);
        if (!resp.ok) {
            console.warn('[api] fetchSeriesList failed: HTTP', resp.status);
            return [];
        }
        const data = await resp.json();
        const count = (data.series || []).length;
        console.log('[api] fetchSeriesList ok:', count, 'series');
        return data.series || [];
    } catch (e) {
        console.error('[api] fetchSeriesList error:', e.message);
        return [];
    }
}

async function startSeriesReq(name) {
    console.log('[api] startSeries:', name);
    try {
        const resp = await fetch(`${API_BASE}/api/v1/series/start?name=${encodeURIComponent(name)}`, { method: 'POST' });
        const data = await resp.json();
        console.log('[api] startSeries ok: id=', data.id);
        return data;
    } catch (e) {
        console.error('[api] startSeries error:', e.message);
        return { error: e.message };
    }
}

async function stopSeriesReq() {
    console.log('[api] stopSeries');
    try {
        const resp = await fetch(`${API_BASE}/api/v1/series/stop`, { method: 'POST' });
        const data = await resp.json();
        console.log('[api] stopSeries ok');
        return data;
    } catch (e) {
        console.error('[api] stopSeries error:', e.message);
        return { error: e.message };
    }
}

async function fetchTrace(traceId) {
    const url = `${API_BASE}/api/v1/trace/${encodeURIComponent(traceId)}`;
    console.log('[api] fetchTrace:', url);
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[api] fetchTrace failed: HTTP', resp.status);
            return null;
        }
        const data = await resp.json();
        console.log('[api] fetchTrace ok');
        return data;
    } catch (e) {
        console.error('[api] fetchTrace error:', e.message);
        return null;
    }
}

async function fetchOutliers(service, stage) {
    const url = `${API_BASE}/api/v1/outliers?service=${encodeURIComponent(service)}&stage=${encodeURIComponent(stage)}`;
    console.log('[api] fetchOutliers:', url);
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[api] fetchOutliers failed: HTTP', resp.status);
            return null;
        }
        const data = await resp.json();
        console.log('[api] fetchOutliers ok');
        return data;
    } catch (e) {
        console.error('[api] fetchOutliers error:', e.message);
        return null;
    }
}

async function fetchStages() {
    const url = `${API_BASE}/api/v1/stages`;
    console.log('[api] fetchStages:', url);
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[api] fetchStages failed: HTTP', resp.status);
            return [];
        }
        const data = await resp.json();
        console.log('[api] fetchStages ok:', data.length, 'stages');
        return data;
    } catch (e) {
        console.error('[api] fetchStages error:', e.message);
        return [];
    }
}

async function fetchTraces(limit, offset) {
    const url = `${API_BASE}/api/v1/traces?limit=${limit}&offset=${offset}`;
    console.log('[api] fetchTraces:', url);
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[api] fetchTraces failed: HTTP', resp.status);
            return [];
        }
        const data = await resp.json();
        console.log('[api] fetchTraces ok:', data.length, 'traces');
        return data;
    } catch (e) {
        console.error('[api] fetchTraces error:', e.message);
        return [];
    }
}

async function fetchTreeStructure() {
    const url = `${API_BASE}/api/v1/tree`;
    console.log('[api] fetchTreeStructure:', url);
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[api] fetchTreeStructure failed: HTTP', resp.status);
            return null;
        }
        const data = await resp.json();
        console.log('[api] fetchTreeStructure ok');
        return data;
    } catch (e) {
        console.error('[api] fetchTreeStructure error:', e.message);
        return null;
    }
}
