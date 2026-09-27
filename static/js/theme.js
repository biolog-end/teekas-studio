/* Loaded in <head>: applies the saved theme before first paint, then wires the toggle. */
(function () {
    const KEY = 'teekas-theme';
    const root = document.documentElement;
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const saved = () => { try { return localStorage.getItem(KEY); } catch (_error) { return null; } };
    const apply = theme => { root.dataset.theme = theme === 'dark' ? 'dark' : 'light'; };
    apply(saved() || (system.matches ? 'dark' : 'light'));
    system.addEventListener('change', event => { if (!saved()) apply(event.matches ? 'dark' : 'light'); });
    document.addEventListener('DOMContentLoaded', () => {
        const button = document.getElementById('theme-toggle');
        if (!button) return;
        const sync = () => {
            const dark = root.dataset.theme === 'dark';
            button.setAttribute('aria-pressed', String(dark));
            button.title = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
        };
        button.addEventListener('click', () => {
            apply(root.dataset.theme === 'dark' ? 'light' : 'dark');
            try { localStorage.setItem(KEY, root.dataset.theme); } catch (_error) { /* private mode */ }
            sync();
        });
        sync();
    });
})();
