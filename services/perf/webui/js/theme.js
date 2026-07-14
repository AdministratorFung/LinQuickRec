(function () {
    const KEY = 'perf-theme';

    function apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(KEY, theme);
        const btn = document.getElementById('themeToggle');
        if (btn) {
            btn.innerHTML = theme === 'dark'
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
                : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
            btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        }
        document.documentElement.dispatchEvent(
            new CustomEvent('themechange', { detail: { theme } })
        );
    }

    function toggle() {
        const current = document.documentElement.getAttribute('data-theme');
        apply(current === 'dark' ? 'light' : 'dark');
    }

    // Init
    const saved = localStorage.getItem(KEY);
    if (saved) {
        apply(saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        apply('dark');
    } else {
        apply('light');
    }

    window.toggleTheme = toggle;
})();
