document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('creator-form');
    const name = $('char-name');
    const upload = $('image-upload');
    const preview = $('preview-image');
    const placeholder = $('editor-placeholder');
    const line = $('cut-line');
    const slider = $('cut-position');
    const output = $('cut-value');
    const create = $('create-button');
    const status = $('status-message');
    let originalFile = null;
    let objectUrl = null;
    let ready = false;
    let busy = false;

    function showStatus(text, error = false) {
        status.textContent = text;
        status.style.color = error ? 'var(--rec)' : 'var(--teal)';
    }

    function updateForm() {
        const valid = /^[a-z0-9_]+$/.test(name.value) && name.value.length <= 64;
        name.setAttribute('aria-invalid', String(!!name.value && !valid));
        create.disabled = busy || !valid || !ready || !originalFile;
        slider.disabled = busy || !ready;
    }

    function updateCut() {
        const percent = Math.max(1, Math.min(99, Number(slider.value)));
        line.style.top = `${percent}%`;
        output.textContent = `${percent.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
    }

    function resetImage() {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        originalFile = null;
        ready = false;
        preview.removeAttribute('src');
        preview.style.display = 'none';
        line.style.display = 'none';
        placeholder.hidden = false;
        slider.value = 50;
        updateCut();
        updateForm();
    }

    upload.addEventListener('change', () => {
        resetImage();
        status.textContent = '';
        const file = upload.files[0];
        if (!file) return;
        if (file.type !== 'image/png') {
            showStatus('Нужен рисунок в формате PNG.', true);
            upload.value = '';
            return;
        }
        originalFile = file;
        objectUrl = URL.createObjectURL(file);
        preview.src = objectUrl;
    });

    preview.addEventListener('load', () => {
        ready = true;
        preview.style.display = 'block';
        line.style.display = 'block';
        placeholder.hidden = true;
        updateForm();
    });
    preview.addEventListener('error', () => {
        if (!originalFile) return;
        resetImage();
        upload.value = '';
        showStatus('Не удалось прочитать изображение. Попробуй другой PNG.', true);
    });
    preview.addEventListener('click', event => {
        if (!ready || busy) return;
        const rect = preview.getBoundingClientRect();
        slider.value = Math.max(1, Math.min(99, (event.clientY - rect.top) / rect.height * 100));
        updateCut();
    });
    slider.addEventListener('input', updateCut);
    name.addEventListener('input', updateForm);

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (create.disabled || !form.reportValidity()) return;
        const data = new FormData();
        data.append('name', name.value);
        data.append('image', originalFile);
        data.append('cutY', slider.value);
        busy = true;
        name.disabled = upload.disabled = true;
        create.textContent = 'Создаю персонажа…';
        status.textContent = '';
        updateForm();
        try {
            const response = await fetch('/create-character', { method: 'POST', body: data });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Ошибка сервера: ${response.status}`);
            showStatus(`Персонаж «${result.name}» создан. Теперь его можно выбрать в студии.`);
            form.reset();
            resetImage();
        } catch (error) {
            showStatus(error.message, true);
        } finally {
            busy = false;
            name.disabled = upload.disabled = false;
            create.textContent = 'Создать персонажа';
            updateForm();
        }
    });
});
