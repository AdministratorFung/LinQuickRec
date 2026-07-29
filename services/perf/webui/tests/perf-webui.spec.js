const { test, expect } = require('@playwright/test');

// =============================================================================
// Perf Tab
// =============================================================================

test.describe('Perf Tab', function() {

    test('P01: tree root expanded by default', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await expect(page.locator('.tree-arrow.expanded').first()).toBeVisible({ timeout: 8000 });
    });

    test('P02: tree nodes collapsed by default', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        var collapsed = page.locator('.tree-arrow:not(.expanded):not(.leaf)');
        var count = await collapsed.count();
        expect(count).toBeGreaterThan(0);
    });

    test('P03: tree leaf nodes no arrow', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        var leaves = page.locator('.tree-arrow.leaf');
        var count = await leaves.count();
        expect(count).toBeGreaterThan(0);
        // Leaf arrows have no ▶ character content
        var firstLeaf = leaves.first();
        var text = await firstLeaf.textContent();
        expect(text).toBe('');
    });

    test('P04: tree expand/collapse on click', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        var collapsed = page.locator('.tree-arrow:not(.expanded):not(.leaf)').first();
        await collapsed.click();
        await page.waitForTimeout(500);
        await expect(collapsed).toHaveClass(/expanded/);
    });

    test('P05: click node shows detail panel', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await page.click('.tree-node-name[data-stage="proxy_e2e"]');
        await page.waitForTimeout(500);
        await expect(page.locator('#perf-detail')).toBeVisible();
    });

    test('P06: top metrics cards', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        var container = page.locator('#perf-top-metrics');
        var labels = container.locator('.stat-label');
        var texts = await labels.allTextContents();
        expect(texts.some(function(t) { return t === 'Count'; })).toBe(true);
        expect(texts.some(function(t) { return t === 'Avg'; })).toBe(true);
        expect(texts.some(function(t) { return t === 'P50'; })).toBe(true);
        expect(texts.some(function(t) { return t === 'P99'; })).toBe(true);
        expect(texts.some(function(t) { return t === 'Min'; })).toBe(true);
        expect(texts.some(function(t) { return t === 'Max'; })).toBe(true);
    });

    test('P07: top chart canvas', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await expect(page.locator('#perf-top-chart')).toBeVisible({ timeout: 8000 });
    });

    test('P08: detail metrics on node select', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await page.click('.tree-node-name[data-stage="proxy_e2e"]');
        await page.waitForTimeout(1000);
        var detail = page.locator('#perf-detail-metrics');
        var labels = detail.locator('.stat-label');
        var texts = await labels.allTextContents();
        expect(texts.some(function(t) { return t === 'Count'; })).toBe(true);
        expect(texts.some(function(t) { return t === 'Avg'; })).toBe(true);
    });

    test('P09: detail chart canvas', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await page.click('.tree-node-name[data-stage="proxy_e2e"]');
        await page.waitForTimeout(1000);
        await expect(page.locator('#perf-detail-chart')).toBeVisible({ timeout: 5000 });
    });

    test('P10: Refresh Tree button', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await expect(page.locator('text=Refresh Tree')).toBeVisible({ timeout: 5000 });
    });
});

// =============================================================================
// Test Tab
// =============================================================================

test.describe('Test Tab', function() {

    test('T01: Mode is first field, Single default', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        var modeSelect = page.locator('#lt-mode');
        await expect(modeSelect).toHaveValue('single');
        // Mode should be the first element in the first control bar
        var firstBar = page.locator('#test-panel .control-bar').first();
        var firstSelect = firstBar.locator('select').first();
        await expect(firstSelect).toHaveAttribute('id', 'lt-mode');
    });

    test('T02: Count hidden in Single mode', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await expect(page.locator('#lt-count-group')).toBeHidden();
    });

    test('T03: Count shown in Sequential mode', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-mode', 'sequential');
        await expect(page.locator('#lt-count-group')).toBeVisible();
    });

    test('T04: Payload field present', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await expect(page.locator('#lt-payload-size')).toBeVisible();
        await expect(page.locator('#lt-payload-unit')).toBeVisible();
    });

    test('T05: User ID Random mode default, input hidden', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await expect(page.locator('#lt-id-mode')).toHaveValue('random');
        await expect(page.locator('#lt-user-id-group')).toBeHidden();
    });

    test('T06: User ID Input shows field', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-id-mode', 'input');
        await expect(page.locator('#lt-user-id-group')).toBeVisible();
    });

    test('T07: User ID number type in Single', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-id-mode', 'input');
        var input = page.locator('#lt-user-id');
        await expect(input).toHaveAttribute('type', 'number');
    });

    test('T08: User ID text type in Sequential', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-id-mode', 'input');
        await page.selectOption('#lt-mode', 'sequential');
        var input = page.locator('#lt-user-id');
        await expect(input).toHaveAttribute('type', 'text');
        await expect(input).toHaveAttribute('placeholder', /loops/);
    });

    test('T09: User ID comma list looping via API interception', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-mode', 'sequential');
        await page.fill('#lt-count', '5');
        await page.selectOption('#lt-id-mode', 'input');
        await page.waitForSelector('#lt-user-id');
        await page.fill('#lt-user-id', '100,200');
        // Disable series
        await page.locator('#lt-use-series').evaluate(function(el) { el.checked = false; el.dispatchEvent(new Event('change')); });

        var capturedIds = [];
        await page.route('**/Proxy/Recommend', async function(route) {
            var body = JSON.parse(route.request().postData());
            capturedIds.push(body.user_id);
            await route.fulfill({ json: { error_code: 0, candidates: [1,2,3] } });
        });

        await page.click('#lt-send-btn');
        await page.waitForTimeout(4000);

        expect(capturedIds).toEqual([100, 200, 100, 200, 100]);
    });

    test('T10: Series checkbox toggles name input', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.locator('#lt-use-series').evaluate(function(el) { el.checked = false; el.dispatchEvent(new Event('change')); });
        await expect(page.locator('#lt-series-name-group')).toBeHidden();
        await page.locator('#lt-use-series').evaluate(function(el) { el.checked = true; el.dispatchEvent(new Event('change')); });
        await expect(page.locator('#lt-series-name-group')).toBeVisible();
    });

    test('T11: Series name pre-filled', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        var nameInput = page.locator('#lt-series-name');
        var val = await nameInput.inputValue();
        expect(val).toContain('loadtest-');
        expect(val.length).toBeGreaterThan(10);
    });

    test('T12: Single request send', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-mode', 'single');
        await page.locator('#lt-use-series').evaluate(function(el) { el.checked = false; el.dispatchEvent(new Event('change')); });
        await page.click('#lt-send-btn');
        await page.waitForTimeout(3000);
        var results = page.locator('#lt-results');
        await expect(results.locator('.stat-label:text-is("Total")')).toBeVisible({ timeout: 8000 });
    });

    test('T13: Sequential request with progress', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-mode', 'sequential');
        await page.fill('#lt-count', '3');
        await page.locator('#lt-use-series').evaluate(function(el) { el.checked = false; el.dispatchEvent(new Event('change')); });
        await page.click('#lt-send-btn');
        await page.waitForTimeout(1000);
        // Progress text should update during execution
        await expect(page.locator('#lt-progress-text')).toBeVisible();
        await page.waitForTimeout(3000);
        await expect(page.locator('text=3 / 3')).toBeVisible();
    });

    test('T14: Concurrent request send', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-mode', 'concurrent');
        await page.fill('#lt-count', '5');
        await page.locator('#lt-use-series').evaluate(function(el) { el.checked = false; el.dispatchEvent(new Event('change')); });
        await page.click('#lt-send-btn');
        await page.waitForTimeout(4000);
        var results = page.locator('#lt-results');
        await expect(results.locator('.stat-label:text-is("Total")')).toBeVisible({ timeout: 8000 });
        // Should have 5 rows in table
        var rows = results.locator('table tbody tr');
        var count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(5);
    });

    test('T15: Results full display', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Test")');
        await page.waitForTimeout(500);
        await page.selectOption('#lt-mode', 'single');
        await page.locator('#lt-use-series').evaluate(function(el) { el.checked = false; el.dispatchEvent(new Event('change')); });
        await page.click('#lt-send-btn');
        await page.waitForTimeout(3000);
        var results = page.locator('#lt-results');
        await expect(results.locator('.stat-label:text-is("Total")')).toBeVisible({ timeout: 8000 });
        await expect(results.locator('.stat-label:text-is("Success")')).toBeVisible();
        await expect(results.locator('.stat-label:text-is("Fail")')).toBeVisible();
        await expect(results.locator('.stat-label:text-is("Avg")')).toBeVisible();
        await expect(results.locator('.stat-label:text-is("P50")')).toBeVisible();
        await expect(results.locator('.stat-label:text-is("P99")')).toBeVisible();
        await expect(results.locator('.stat-label:text-is("Min")')).toBeVisible();
        await expect(results.locator('.stat-label:text-is("Max")')).toBeVisible();
        await expect(results.locator('#lt-chart')).toBeVisible();
    });
});

// =============================================================================
// Series Tab
// =============================================================================

test.describe('Series Tab', function() {

    test('S01: series list table columns', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var thead = page.locator('#series-list thead');
        await expect(thead.locator('text=ID')).toBeVisible();
        await expect(thead.locator('text=Name')).toBeVisible();
        await expect(thead.locator('text=Status')).toBeVisible();
        await expect(thead.locator('text=Span Count')).toBeVisible();
    });

    test('S02: active series green badge', async function({ page, request }) {
        await request.post('/api/v1/series/stop');  // ensure no active
        await request.post('/api/v1/series/start?name=active-test');
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        await expect(page.locator('#series-tbody .badge-green')).toBeVisible({ timeout: 3000 });
    });

    test('S03: stopped series gray badge', async function({ page, request }) {
        await request.post('/api/v1/series/stop');
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var gray = page.locator('#series-tbody .badge-gray');
        var count = await gray.count();
        expect(count).toBeGreaterThan(0);
    });

    test('S04: + New Series creates series', async function({ page, request }) {
        // Ensure no active
        await request.post('/api/v1/series/stop');
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var beforeCount = await page.locator('#series-tbody tr').count();
        await page.click('text=+ New Series');
        var dialog = await page.waitForEvent('dialog', { timeout: 3000 });
        await dialog.accept('created-test');
        await page.waitForTimeout(1000);
        var afterCount = await page.locator('#series-tbody tr').count();
        expect(afterCount).toBe(beforeCount + 1);
    });

    test('S05: active exclusion toast', async function({ page, request }) {
        await request.post('/api/v1/series/stop');
        await request.post('/api/v1/series/start?name=active-hold');
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        await page.click('text=+ New Series');
        await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
        // Cleanup
        await request.post('/api/v1/series/stop');
    });

    test('S06: Stop Active stops series', async function({ page, request }) {
        await request.post('/api/v1/series/stop');
        await request.post('/api/v1/series/start?name=stop-test');
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var before = await page.locator('#series-tbody .badge-green').count();
        expect(before).toBeGreaterThan(0);
        await page.click('text=Stop Active');
        await page.waitForTimeout(800);
        var after = await page.locator('#series-tbody .badge-green').count();
        expect(after).toBe(0);
    });

    test('S07: Refresh reloads list', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        await page.click('text=Refresh');
        await page.waitForTimeout(800);
        await expect(page.locator('#series-tbody')).toBeVisible();
    });

    test('S08: series detail view with Back button', async function({ page, request }) {
        // Ensure at least one series exists
        var list = await request.get('/api/v1/series');
        var seriesList = await list.json();
        if (seriesList.series.length === 0) {
            await request.post('/api/v1/series/start?name=detail-test');
            await request.post('/api/v1/series/stop');
        }
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var row = page.locator('#series-tbody tr.clickable').first();
        if (await row.count() > 0) {
            await row.click();
            await page.waitForTimeout(800);
            await expect(page.locator('text=Back to List').first()).toBeVisible({ timeout: 3000 });
            await expect(page.locator('#series-detail')).toBeVisible();
        }
    });

    test('S09: series detail metrics', async function({ page, request }) {
        var list = await request.get('/api/v1/series');
        var seriesList = await list.json();
        if (seriesList.series.length === 0) {
            await request.post('/api/v1/series/start?name=metrics-test');
            await request.post('/api/v1/series/stop');
        }
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        await page.click('#series-tbody tr.clickable').first();
        await page.waitForTimeout(1000);
        var detail = page.locator('#series-stats');
        await expect(detail.locator('.stat-label:text-is("Avg")')).toBeVisible({ timeout: 5000 });
        await expect(detail.locator('.stat-label:text-is("P50")')).toBeVisible();
        await expect(detail.locator('.stat-label:text-is("P99")')).toBeVisible();
        await expect(detail.locator('.stat-label:text-is("Min")')).toBeVisible();
        await expect(detail.locator('.stat-label:text-is("Max")')).toBeVisible();
    });

    test('S10: series detail chart', async function({ page, request }) {
        var list = await request.get('/api/v1/series');
        var seriesList = await list.json();
        if (seriesList.series.length === 0) {
            await request.post('/api/v1/series/start?name=chart-test');
            await request.post('/api/v1/series/stop');
        }
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        await page.click('#series-tbody tr.clickable').first();
        await page.waitForTimeout(1000);
        await expect(page.locator('#series-chart')).toBeVisible({ timeout: 5000 });
    });

    test('S11: Back to List restores list', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var row = page.locator('#series-tbody tr.clickable').first();
        if (await row.count() > 0) {
            await row.click();
            await page.waitForTimeout(500);
            await page.click('text=Back to List');
            await page.waitForTimeout(500);
            await expect(page.locator('#series-list')).toBeVisible();
            await expect(page.locator('#series-detail')).toBeHidden();
        }
    });
});

// Series pagination tests require >10 items
test.describe.serial('Series Tab - Pagination', function() {

    test.beforeAll(async function({ request }) {
        // Create 15 stopped series
        for (var i = 0; i < 15; i++) {
            await request.post('/api/v1/series/start?name=p' + i);
            await request.post('/api/v1/series/stop');
        }
    });

    test('S12: pagination >10 shows Load More', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var loadMore = page.locator('#series-pagination button');
        if (await loadMore.count() === 0) {
            // Maybe items <= 10
            var rows = await page.locator('#series-tbody tr').count();
            expect(rows).toBeGreaterThan(10);
            return;
        }
        await expect(loadMore.first()).toContainText('Load More');
    });

    test('S13: Load More → pagination nav', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        var loadMore = page.locator('#series-pagination button');
        if (await loadMore.count() > 0) {
            await loadMore.click();
            await page.waitForTimeout(500);
            await expect(page.locator('text=Per page')).toBeVisible({ timeout: 3000 });
        }
    });

    test('S14: reactivate stopped series', async function({ page }) {
        // Ensure no active series
        var resp = await page.request.post('/api/v1/series/stop');
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(1000);
        await page.click('#series-tbody tr.clickable').first();
        await page.waitForTimeout(800);
        await expect(page.locator('#series-activate-btn')).toBeVisible({ timeout: 3000 });
        await page.click('#series-activate-btn');
        await page.waitForTimeout(500);
        var badge = page.locator('#series-tbody .badge-green');
        expect(await badge.count()).toBeGreaterThan(0);
    });
});

// =============================================================================
// Trace Tab
// =============================================================================

test.describe('Trace Tab', function() {

    test('R01: trace list table columns', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var thead = page.locator('#trace-table thead');
        await expect(thead.locator('text=#')).toBeVisible();
        await expect(thead.locator('text=Trace ID')).toBeVisible();
        await expect(thead.locator('text=Time')).toBeVisible();
        await expect(thead.locator('text=Spans')).toBeVisible();
        await expect(thead.locator('text=Duration')).toBeVisible();
    });

    test('R02: sequential numbering', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var firstRow = page.locator('#trace-list tr.clickable').first();
        if (await firstRow.count() > 0) {
            await expect(firstRow.locator('td').first()).toContainText('#1');
        }
    });

    test('R03: pagination >10 Load More', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var loadMore = page.locator('#trace-pagination button');
        var count = await loadMore.count();
        expect(count).toBeGreaterThan(0);
    });

    test('R04: pagination page nav + page size', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var loadMore = page.locator('#trace-pagination button');
        if (await loadMore.count() > 0) {
            await loadMore.click();
            await page.waitForTimeout(500);
            await expect(page.locator('text=Per page')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('text=of')).toBeVisible();
        }
    });

    test('R05: search by Enter key', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            await expect(page.locator('#trace-result')).toBeVisible({ timeout: 3000 });
        }
    });

    test('R06: search by Search button', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.click('text=Search');
            await page.waitForTimeout(800);
            await expect(page.locator('#trace-result')).toBeVisible({ timeout: 3000 });
        }
    });

    test('R07: empty search ignored', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        await page.fill('#traceIdInput', '');
        await page.press('#traceIdInput', 'Enter');
        await page.waitForTimeout(500);
        // Should stay on list view
        await expect(page.locator('#trace-table')).toBeVisible();
    });

    test('R08: detail card styling', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            // Check card background
            var card = page.locator('#trace-result > div').first();
            var bg = await card.evaluate(function(el) { return getComputedStyle(el).backgroundColor; });
            expect(bg).not.toBe('rgba(0, 0, 0, 0)');
        }
    });

    test('R09: detail header layout', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            await expect(page.locator('text=Trace ID:')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('#trace-result .btn-primary')).toBeVisible();
        }
    });

    test('R10: detail waterfall table columns', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            var thead = page.locator('#trace-result table thead');
            await expect(thead.locator('text=Service')).toBeVisible({ timeout: 3000 });
            await expect(thead.locator('text=Stage')).toBeVisible();
            await expect(thead.locator('text=Duration')).toBeVisible();
            await expect(thead.locator('text=Waterfall')).toBeVisible();
            await expect(thead.locator('text=Status')).toBeVisible();
        }
    });

    test('R11: detail waterfall bars', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            var bars = page.locator('#trace-result .waterfall-bar div');
            var count = await bars.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('R12: detail status badges', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            var badges = page.locator('#trace-result .badge');
            var count = await badges.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('R13: detail summary info', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            await expect(page.locator('.trace-summary')).toBeVisible({ timeout: 3000 });
        }
    });

    test('R14: Back restores pagination', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Trace")');
        await page.waitForTimeout(1500);
        var td = page.locator('#trace-list tr.clickable td.fw-medium').first();
        var traceId = await td.textContent().catch(function() { return ''; });
        if (traceId) {
            await page.fill('#traceIdInput', traceId.trim());
            await page.press('#traceIdInput', 'Enter');
            await page.waitForTimeout(800);
            await page.click('#trace-result .btn-primary');
            await page.waitForTimeout(500);
            await expect(page.locator('#trace-pagination')).toBeVisible({ timeout: 3000 });
        }
    });
});

// =============================================================================
// Downloads Tab
// =============================================================================

test.describe('Downloads Tab', function() {

    test('D01: filter dropdown options', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Downloads")');
        await page.waitForTimeout(500);
        var filter = page.locator('#dl-filter');
        await expect(filter.locator('option[value="all"]')).toBeVisible();
        await expect(filter.locator('option[value="trace"]')).toBeVisible();
        await expect(filter.locator('option[value="series"]')).toBeVisible();
    });

    test('D02: filter By Trace ID shows input', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Downloads")');
        await page.waitForTimeout(500);
        await page.selectOption('#dl-filter', 'trace');
        await expect(page.locator('#dl-trace-input')).toBeVisible();
    });

    test('D03: filter By Series ID shows input', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Downloads")');
        await page.waitForTimeout(500);
        await page.selectOption('#dl-filter', 'series');
        await expect(page.locator('#dl-series-input')).toBeVisible();
    });

    test('D04: format options present', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Downloads")');
        await page.waitForTimeout(500);
        var format = page.locator('#dl-format');
        await expect(format.locator('option[value="csv"]')).toBeVisible();
        await expect(format.locator('option[value="jsonl"]')).toBeVisible();
        await expect(format.locator('option[value="json"]')).toBeVisible();
        await expect(format.locator('option[value="log"]')).toBeVisible();
    });

    test('D05: limit field present', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Downloads")');
        await page.waitForTimeout(500);
        await expect(page.locator('#dl-limit')).toBeVisible();
        await expect(page.locator('#dl-limit')).toHaveValue('10000');
    });

    test('D06: Download button present', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Downloads")');
        await page.waitForTimeout(500);
        await expect(page.locator('text=Download').first()).toBeVisible();
        // Note: actual download behavior requires manual testing (headless browser
        // download handling is complex and environment-dependent)
    });
});

// =============================================================================
// Cross-cutting
// =============================================================================

test.describe('Cross-cutting', function() {

    test('X01: tab persistence on refresh', async function({ page }) {
        await page.goto('/');
        await page.click('button.tab:has-text("Series")');
        await page.waitForTimeout(500);
        await page.reload();
        await expect(page.locator('#series-panel')).toBeVisible();
    });

    test('X02: theme toggle', async function({ page }) {
        await page.goto('/');
        await page.waitForTimeout(500);
        var html = page.locator('html');
        var beforeTheme = await html.getAttribute('data-theme');
        await page.click('#themeToggle');
        await page.waitForTimeout(300);
        var afterTheme = await html.getAttribute('data-theme');
        expect(afterTheme).not.toBe(beforeTheme);
        // Toggle back
        await page.click('#themeToggle');
    });

    test('X03: all tabs load without error', async function({ page }) {
        await page.goto('/');
        var tabs = ['Series', 'Test', 'Trace', 'Downloads'];
        for (var i = 0; i < tabs.length; i++) {
            await page.click('button.tab:has-text("' + tabs[i] + '")');
            await page.waitForTimeout(500);
        }
    });

    test('X04: no console errors', async function({ page }) {
        var errors = [];
        page.on('pageerror', function(err) { errors.push(err.message); });
        await page.goto('/');
        var tabs = ['Test', 'Series', 'Trace', 'Downloads'];
        for (var i = 0; i < tabs.length; i++) {
            await page.click('button.tab:has-text("' + tabs[i] + '")');
            await page.waitForTimeout(1000);
        }
        expect(errors.length).toBe(0);
    });
});
