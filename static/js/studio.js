// Tab navigation of the control panel.
document.addEventListener('DOMContentLoaded', () => {
    const tabs = [...document.querySelectorAll('[role="tab"][data-panel]')];
    const views = {
        live: ['За пультом.', 'Твой персонаж, его голос и всё, что происходит в эфире.', 'Студия'],
        voice: ['Звучать по-своему.', 'Образ, движение и голос твоего персонажа.', 'Голос и образ'],
        ai: ['У каждого свой характер.', 'Личность, модель и память разговора.', 'Характер и ИИ'],
        keys: ['Запас на весь эфир.', 'Ключи API, их состояние и остаток бесплатных квот на сегодня.', 'Ключи и лимиты'],
        hotkeys: ['Всё под пальцами.', 'Сочетания для эфира и твоего Stream Deck.', 'Горячие клавиши'],
    };
    function selectPanel(name, focus = false) {
        if (!views[name]) name = 'live';
        tabs.forEach(tab => {
            const selected = tab.dataset.panel === name;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
            if (selected && focus) tab.focus();
        });
        const [title, description, label] = views[name];
        document.getElementById('page-title').textContent = title;
        document.getElementById('page-description').textContent = description;
        document.getElementById('section-label').textContent = label;
        document.title = 'Teekas - ' + label;
        history.replaceState(null, '', '#' + name);
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectPanel(tab.dataset.panel));
        tab.addEventListener('keydown', event => {
            let next;
            if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % tabs.length;
            if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = tabs.length - 1;
            if (next !== undefined) {
                event.preventDefault();
                selectPanel(tabs[next].dataset.panel, true);
            }
        });
    });
    window.addEventListener('hashchange', () => selectPanel(location.hash.slice(1)));
    document.getElementById('new-persona-button')?.addEventListener('click', () => selectPanel('ai'));
    document.getElementById('keys-shortcut')?.addEventListener('click', () => selectPanel('keys', true));
    selectPanel(location.hash.slice(1));
});
