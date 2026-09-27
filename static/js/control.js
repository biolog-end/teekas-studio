document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const ui = {
        personaSelect: $('persona-select'), savePersona: $('save-persona-button'), newPersona: $('new-persona-button'),
        personaName: $('persona-name-input'), character: $('character-select'), animation: $('animation-select'),
        language: $('language-select'), speed: $('speed-control'), pitch: $('pitch-control'),
        subtitleEnabled: $('subtitle-enabled'), subtitleColor: $('subtitle-color'), subtitleSize: $('subtitle-size'),
        subtitleFont: $('subtitle-font-select'), systemPrompt: $('system-prompt-input'), aiRules: $('ai-rules-display'),
        provider: $('ai-provider-select'), model: $('model-tier-select'), modelOptions: $('ai-model-options'),
        contextMode: $('context-mode-select'), contextLimit: $('context-limit-input'), cacheChat: $('chat-cache-toggle'),
        idleListen: $('idle-listen-toggle'), idleDelay: $('idle-delay-input'),
        text: $('text-input'), send: $('send-button'), history: $('chat-history-display'), prompt: $('gemini-prompt-input'),
        ask: $('send-gemini-button'), autoSpeak: $('auto-confirm-toggle'), responseArea: $('gemini-response-area'),
        responseText: $('gemini-response-text'), confirm: $('confirm-gemini-button'), discard: $('discard-gemini-button'),
        status: $('status-message'), effects: $('special-effects-container'), speedValue: $('speed-value'),
        pitchValue: $('pitch-value'), subtitleSizeValue: $('subtitle-size-value'), voice: $('voice-chat-button'),
        pttStatus: $('ptt-status'), pttStatusText: $('ptt-status-text'), micHotkey: $('ptt-hotkey-input'),
        summonHotkey: $('summon-hotkey-input'), screenshotHotkey: $('screenshot-hotkey-input'),
        hotkeySave: $('ptt-save-button'), validationDelay: $('validation-delay'),
        validationDelayValue: $('validation-delay-value'), budgetCard: $('ai-budget-card'),
        budgetTitle: $('ai-budget-title'), budgetDetail: $('ai-budget-detail'), budgetFill: $('ai-budget-fill'),
        budgetRefresh: $('ai-budget-refresh'),
        summon: $('summon-button'), stageName: $('stage-name'), stageState: $('stage-state'),
        stageCharacter: $('stage-character'), stageHead: $('stage-head'), stageBody: $('stage-body'),
        conversationModel: $('conversation-model'), effectCount: $('effect-count'),
        sceneEditor: $('scene-editor'), scenePreview: $('scene-preview-character'),
        scenePreviewHead: $('scene-preview-head'), scenePreviewBody: $('scene-preview-body'),
        scenePreviewSubtitle: $('scene-preview-subtitle'), sceneX: $('scene-x'), sceneY: $('scene-y'),
        sceneSize: $('scene-size'), sceneFlip: $('scene-flip'), sceneEffects: $('scene-effects-enabled'),
        sceneMovement: $('scene-movement-enabled'), sceneIntensity: $('scene-intensity'),
        sceneXValue: $('scene-x-value'), sceneYValue: $('scene-y-value'), sceneSizeValue: $('scene-size-value'),
        sceneIntensityValue: $('scene-intensity-value'), sceneReset: $('scene-reset-button'),
        subtitleX: $('subtitle-x'), subtitleY: $('subtitle-y'), subtitleWidth: $('subtitle-width'),
        subtitleXValue: $('subtitle-x-value'), subtitleYValue: $('subtitle-y-value'), subtitleWidthValue: $('subtitle-width-value'),
        emotionPreviews: $('emotion-preview-container'), effectPreviews: $('effect-preview-container'),
        fallbackToggle: $('fallback-toggle'), fallbackEditor: $('fallback-editor'), fallbackRows: $('fallback-rows'),
        fallbackAdd: $('fallback-add'), fallbackPreset: $('fallback-preset'), singleModel: $('single-model'),
        chainOptions: $('chain-model-options'), modelNote: $('model-note'), requestTimeout: $('request-timeout-input'),
        thinking: $('thinking-toggle'), keysSummary: $('keys-summary'), keysList: $('keys-list'),
        keyAddForm: $('key-add-form'), keyAddProvider: $('key-add-provider'), keyAddLabel: $('key-add-label'),
        keyAddValue: $('key-add-value'), keysSave: $('keys-save-button'), keysRefresh: $('keys-refresh'),
        keysDirty: $('keys-dirty'), quotaTable: $('quota-table'), keysTab: $('tab-keys'), keysShortcut: $('keys-shortcut'),
    };
    ui.stage = ui.stageCharacter.closest('.stage');

    // Filled from /api/models; these are the offline defaults.
    let modelCatalog = {
        models: [],
        defaults: { gemini: 'gemini-3.6-flash', openai: 'gpt-5.4-mini' },
        fallback_chain: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gpt-5.4', 'gpt-5.4-mini'],
    };
    const providerFor = (model) => (/^(gpt-|o1|o3|o4|o5|chatgpt-)/i.test(String(model || '').trim()) ? 'openai' : 'gemini');
    const PROVIDER_LABELS = { gemini: 'Gemini', openai: 'OpenAI' };
    const EMOTIONS = SceneConfig.emotions;
    const DEFAULT_SYSTEM_PROMPT = 'Ты - живой и харизматичный персонаж. Общайся естественно и по делу, отвечай так, как говорил бы живой человек.';
    const VOICE_NOTE = '\n\n{Системный текст: идёт голосовое общение. Если реплика оборвана или плохо распознана, попроси повторить или уточнить.}';
    const SCREEN_PROMPT = '{Системный текст: это снимок первого монитора пользователя. Коротко и живо прокомментируй важное на экране или помоги с тем, что там происходит.}';

    let personas = [];
    let currentPersona = null;
    let effects = [];
    let visualCharacters = [];
    let pendingUserMessage = null;
    let pendingWasStreamed = false;
    let pendingResponseId = null;
    let avatarSummoned = false;
    let requestInFlight = false;
    let requestAbort = null;
    let summonTimer = null;
    let pendingScreenshot = null;
    let lastInteractionAt = Date.now();

    let speechTracker = null;
    let speechTimer = null;

    let recognition = null;
    let recognitionRunning = false;
    let voiceDesired = false;
    let voiceMode = 'dialogue';
    let voiceTranscript = '';
    let voiceInterim = '';
    let voiceRestartTimer = null;
    let idleStopTimer = null;

    let hotkeysAvailable = false;
    let lastHotkeyGenerations = null;
    let sceneUpdateTimer = null;
    let scenePersistTimer = null;

    let fallbackChain = [];
    let keysStatus = null;
    let keysDraft = [];

    function showStatus(message, type = 'info', duration = 4000) {
        ui.status.textContent = message;
        ui.status.style.color = type === 'error' ? 'var(--rec)' : type === 'success' ? 'var(--teal)' : 'var(--muted)';
        if (duration > 0) setTimeout(() => {
            if (ui.status.textContent === message) ui.status.textContent = '';
        }, duration);
    }

    function noteInteraction() {
        lastInteractionAt = Date.now();
    }

    function updateRanges() {
        ui.speedValue.textContent = `${Number(ui.speed.value).toFixed(1)}x`;
        ui.pitchValue.textContent = `${Number(ui.pitch.value).toFixed(1)}x`;
        ui.subtitleSizeValue.textContent = `${ui.subtitleSize.value}px`;
        ui.validationDelayValue.textContent = `${Number(ui.validationDelay.value).toFixed(1)} с`;
        ui.subtitleXValue.textContent = `${Math.round(ui.subtitleX.value)}%`;
        ui.subtitleYValue.textContent = `${Math.round(ui.subtitleY.value)}%`;
        ui.subtitleWidthValue.textContent = `${Math.round(ui.subtitleWidth.value)}%`;
    }

    function fitStageCharacter() {
        const images = [ui.stageHead, ui.stageBody];
        if (images.some(img => !img.naturalWidth)) return;
        const area = ui.stageCharacter.parentElement;
        const ratio = images.reduce((sum, img) => sum + img.naturalHeight / img.naturalWidth, 0);
        ui.stageCharacter.style.width = `${Math.min(area.clientWidth * .57, (area.clientHeight - 5) / ratio)}px`;
    }

    function updateStage() {
        const character = visualCharacters.find(item => item.id === ui.character.value) || visualCharacters[0];
        if (character) {
            const head = '/' + character.images.head.replace(/^\//, '');
            const body = '/' + character.images.body.replace(/^\//, '');
            if (ui.stageHead.getAttribute('src') !== head) ui.stageHead.src = head;
            if (ui.stageBody.getAttribute('src') !== body) ui.stageBody.src = body;
            if (ui.scenePreviewHead.getAttribute('src') !== head) ui.scenePreviewHead.src = head;
            if (ui.scenePreviewBody.getAttribute('src') !== body) ui.scenePreviewBody.src = body;
            ui.stageName.textContent = ui.personaName.value.trim() || character.name;
        }
        ui.stageState.textContent = avatarSummoned ? 'На сцене' : 'За кулисами';
        ui.summon.textContent = avatarSummoned ? 'Убрать персонажа' : 'Призвать персонажа';
        ui.summon.setAttribute('aria-pressed', String(avatarSummoned));
        ui.stageCharacter.dataset.summoned = String(avatarSummoned);
        ui.stage.dataset.summoned = String(avatarSummoned);
        fitStageCharacter();
        updateScenePreview();
    }

    function sceneFromForm() {
        return SceneConfig.normalize({
            x: ui.sceneX.value, y: ui.sceneY.value, size: ui.sceneSize.value,
            flip: ui.sceneFlip.checked, effectsEnabled: ui.sceneEffects.checked,
            movementEnabled: ui.sceneMovement.checked, intensity: ui.sceneIntensity.value,
            subtitleX: ui.subtitleX.value, subtitleY: ui.subtitleY.value, subtitleWidth: ui.subtitleWidth.value,
        });
    }

    function setSceneForm(scene) {
        const value = SceneConfig.normalize(scene);
        ui.sceneX.value = value.x; ui.sceneY.value = value.y; ui.sceneSize.value = value.size;
        ui.sceneFlip.checked = value.flip; ui.sceneEffects.checked = value.effectsEnabled;
        ui.sceneMovement.checked = value.movementEnabled; ui.sceneIntensity.value = value.intensity;
        ui.subtitleX.value = value.subtitleX; ui.subtitleY.value = value.subtitleY; ui.subtitleWidth.value = value.subtitleWidth;
        updateScenePreview();
    }

    function updateScenePreview() {
        if (!ui.scenePreview) return;
        const scene = sceneFromForm();
        const images = [ui.scenePreviewHead, ui.scenePreviewBody];
        const ratio = images.every(img => img.naturalWidth) ? images.reduce((sum, img) => sum + img.naturalHeight / img.naturalWidth, 0) : 1.6;
        const editorRatio = ui.sceneEditor.clientWidth / Math.max(1, ui.sceneEditor.clientHeight);
        const characterWidth = scene.size / ratio / editorRatio;
        scene.x = SceneConfig.clamp(scene.x, characterWidth / 2 + 1, 99 - characterWidth / 2);
        scene.y = SceneConfig.clamp(scene.y, scene.size + 1, 99);
        scene.subtitleX = SceneConfig.clamp(scene.subtitleX, scene.subtitleWidth / 2, 100 - scene.subtitleWidth / 2);
        ui.sceneX.value = scene.x; ui.sceneY.value = scene.y; ui.subtitleX.value = scene.subtitleX;
        ui.scenePreview.style.left = `${scene.x}%`;
        ui.scenePreview.style.top = `${scene.y}%`;
        ui.scenePreview.style.width = `${characterWidth}%`;
        ui.scenePreview.style.transform = `translate(-50%, -100%) scaleX(${scene.flip ? -1 : 1})`;
        ui.scenePreviewSubtitle.style.left = `${scene.subtitleX}%`;
        ui.scenePreviewSubtitle.style.top = `${scene.subtitleY}%`;
        ui.scenePreviewSubtitle.style.width = `${scene.subtitleWidth}%`;
        ui.scenePreviewSubtitle.style.color = ui.subtitleColor.value;
        ui.scenePreviewSubtitle.style.fontFamily = ui.subtitleFont.value;
        ui.scenePreviewSubtitle.style.fontSize = `${Math.max(8, Number(ui.subtitleSize.value) * .28)}px`;
        ui.scenePreviewSubtitle.hidden = !ui.subtitleEnabled.checked;
        ui.sceneXValue.textContent = `${Math.round(scene.x)}%`;
        ui.sceneYValue.textContent = `${Math.round(scene.y)}%`;
        ui.sceneSizeValue.textContent = `${Math.round(scene.size)}%`;
        ui.sceneIntensityValue.textContent = `${Math.round(scene.intensity * 100)}%`;
        updateRanges();
    }

    function scenePayload() {
        return {
            characterId: ui.character.value,
            animationStyle: ui.animation.value,
            scene: sceneFromForm(),
            subtitles: { enabled: ui.subtitleEnabled.checked, color: ui.subtitleColor.value, size: Number(ui.subtitleSize.value), font: ui.subtitleFont.value },
        };
    }

    function queueSceneUpdate(persist = true) {
        if (!currentPersona) return;
        updateScenePreview();
        const send = async (save) => {
            try {
                await fetch(save ? '/api/scene' : '/trigger-animation', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(save ? scenePayload() : { job_type: 'scene', ...scenePayload() }),
                });
            } catch (_error) { /* the preview still works when the server restarts */ }
        };
        if (!sceneUpdateTimer) {
            sceneUpdateTimer = setTimeout(() => { sceneUpdateTimer = null; send(false); }, 80);
        }
        if (persist) {
            clearTimeout(scenePersistTimer);
            scenePersistTimer = setTimeout(() => send(true), 320);
        }
    }

    function buildRules() {
        const soundboard = effects.length
            ? effects.map((effect) => `   • soundboard(${effect.id}) - ${effect.name}`).join('\n')
            : '   • нет доступных эффектов';
        const emotions = EMOTIONS.map((emotion) => `   • emotion(${emotion.id}) - ${emotion.hint}`).join('\n');
        return `[СИСТЕМНЫЕ ПРАВИЛА ОТВЕТА - соблюдай всегда]
1. Пиши только то, что персонаж произносит вслух: без ремарок в звёздочках и скобках, без Markdown, списков и эмодзи.
2. Текст в фигурных скобках - системная информация приложения, а не слова пользователя.
3. Эмоции. Команда emotion(идентификатор) меняет пластику и графику аватара. Ставь её прямо в тексте перед фразой, к которой она относится, 1–2 раза за ответ, когда настроение заметно меняется:
${emotions}
4. Звуки. soundboard(идентификатор) проигрывает эффект поверх речи; используй редко и только к месту:
${soundboard}
Команды не произносятся вслух. Пиши их латиницей ровно в таком виде и не придумывай новых идентификаторов.
Пример: emotion(surprised) Серьёзно? emotion(excited) Это лучшая новость за день!`;
    }

    function fullSystemPrompt(extra = '') {
        return `${(ui.systemPrompt.value || '').trim()}\n\n${buildRules()}${extra}`;
    }

    function parseAssistantDirectives(source) {
        return SceneConfig.parseDirectives(source, effects);
    }

    function ensurePersonaShape(persona) {
        persona.settings ||= {};
        persona.settings.subtitles ||= { enabled: true, color: '#FFFFFF', size: 36, font: 'Impact' };
        persona.settings.scene = SceneConfig.normalize(persona.settings.scene);
        persona.gemini ||= {};
        const oldTier = persona.gemini.model_tier || 'smart';
        persona.gemini.model ||= oldTier === 'smart' ? modelCatalog.defaults.gemini : oldTier === 'dumb' ? 'gemini-3.5-flash-lite' : oldTier;
        persona.gemini.provider = providerFor(persona.gemini.model);
        if (persona.gemini.fallback_enabled === undefined) persona.gemini.fallback_enabled = true;
        if (!Array.isArray(persona.gemini.fallback_models) || !persona.gemini.fallback_models.length) {
            persona.gemini.fallback_models = [...modelCatalog.fallback_chain];
        }
        persona.gemini.request_timeout_s ||= 60;
        persona.gemini.thinking = !!persona.gemini.thinking;
        persona.gemini.history ||= [];
        persona.gemini.context_mode ||= 'summarize';
        persona.gemini.context_limit ||= 30;
        if (persona.gemini.cache_chat === undefined) persona.gemini.cache_chat = true;
        if (persona.gemini.idle_listen === undefined) persona.gemini.idle_listen = false;
        persona.gemini.idle_delay ||= 120;
        persona.gemini.validation_delay ||= 2;
        return persona;
    }

    function collectForm() {
        if (!currentPersona) return;
        currentPersona.name = ui.personaName.value.trim();
        currentPersona.settings = {
            characterId: ui.character.value,
            animationStyle: ui.animation.value,
            language: ui.language.value,
            speed: Number(ui.speed.value),
            pitch: Number(ui.pitch.value),
            subtitles: {
                enabled: ui.subtitleEnabled.checked,
                color: ui.subtitleColor.value,
                size: Number(ui.subtitleSize.value),
                font: ui.subtitleFont.value,
            },
            scene: sceneFromForm(),
        };
        currentPersona.gemini = {
            ...currentPersona.gemini,
            system_prompt: ui.systemPrompt.value,
            provider: providerFor(ui.model.value),
            model: ui.model.value.trim(),
            model_tier: ui.model.value.trim(),
            fallback_enabled: ui.fallbackToggle.checked,
            fallback_models: fallbackChain.filter(Boolean),
            request_timeout_s: Math.max(5, Math.min(600, Number(ui.requestTimeout.value) || 60)),
            thinking: ui.thinking.checked,
            context_mode: ui.contextMode.value,
            context_limit: Number(ui.contextLimit.value),
            cache_chat: ui.cacheChat.checked,
            idle_listen: ui.idleListen.checked,
            idle_delay: Number(ui.idleDelay.value),
            validation_delay: Number(ui.validationDelay.value),
            history: currentPersona.gemini.history || [],
        };
    }

    function loadPersonaIntoForm(personaId) {
        const source = personas.find((item) => item.id === personaId);
        if (source) currentPersona = ensurePersonaShape(structuredClone(source));
        if (!currentPersona) return;
        const settings = currentPersona.settings;
        const ai = currentPersona.gemini;
        ui.personaName.value = currentPersona.name || '';
        ui.character.value = settings.characterId || '';
        if (!ui.character.value) ui.character.selectedIndex = 0;
        ui.animation.value = settings.animationStyle || 'jelly_deformer';
        ui.language.value = settings.language || 'ru';
        ui.speed.value = settings.speed || 1;
        ui.pitch.value = settings.pitch || 1;
        ui.subtitleEnabled.checked = settings.subtitles.enabled !== false;
        ui.subtitleColor.value = settings.subtitles.color || '#FFFFFF';
        ui.subtitleSize.value = settings.subtitles.size || 36;
        ui.subtitleFont.value = settings.subtitles.font || 'Impact';
        setSceneForm(settings.scene);
        ui.systemPrompt.value = ai.system_prompt || DEFAULT_SYSTEM_PROMPT;
        ui.provider.value = ai.provider;
        ui.model.value = ai.model;
        ui.fallbackToggle.checked = ai.fallback_enabled !== false;
        fallbackChain = [...ai.fallback_models];
        ui.requestTimeout.value = ai.request_timeout_s;
        ui.thinking.checked = !!ai.thinking;
        renderFallbackChain();
        ui.contextMode.value = ai.context_mode;
        ui.contextLimit.value = ai.context_limit;
        ui.cacheChat.checked = ai.cache_chat !== false;
        ui.idleListen.checked = !!ai.idle_listen;
        ui.idleDelay.value = ai.idle_delay;
        ui.validationDelay.value = ai.validation_delay;
        populateModelOptions(false);
        renderHistory();
        updateRanges();
        updateStage();
        queueSceneUpdate(true);
        refreshBudget();
    }

    async function loadPersonas(preferredId = null) {
        try {
            const response = await fetch('/get-personas');
            if (!response.ok) throw new Error('Не удалось загрузить персоны');
            personas = (await response.json()).map(ensurePersonaShape);
            const selected = preferredId || ui.personaSelect.value;
            ui.personaSelect.innerHTML = '';
            personas.forEach((persona) => {
                const option = document.createElement('option');
                option.value = persona.id;
                option.textContent = persona.name;
                ui.personaSelect.appendChild(option);
            });
            if (personas.some((item) => item.id === selected)) ui.personaSelect.value = selected;
            else if (personas.length) ui.personaSelect.value = personas[0].id;
            if (ui.personaSelect.value) loadPersonaIntoForm(ui.personaSelect.value);
            else createPersona();
        } catch (error) {
            showStatus(`Ошибка загрузки персон: ${error.message}`, 'error');
        }
    }

    async function savePersona(silent = false) {
        if (!currentPersona) return;
        collectForm();
        if (!currentPersona.name) return showStatus('Имя персоны не может быть пустым', 'error');
        if (!silent) showStatus('Сохранение…', 'info', 0);
        try {
            const response = await fetch('/save-persona', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(currentPersona),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Ошибка сервера');
            const index = personas.findIndex((item) => item.id === currentPersona.id);
            if (index >= 0) personas[index] = structuredClone(currentPersona);
            else personas.push(structuredClone(currentPersona));
            if (!silent) {
                showStatus('Персона сохранена', 'success');
                await loadPersonas(currentPersona.id);
            }
        } catch (error) {
            showStatus(`Ошибка сохранения: ${error.message}`, 'error');
        }
    }

    function createPersona() {
        currentPersona = ensurePersonaShape({
            id: `persona_${Date.now()}`, name: '',
            settings: {
                characterId: visualCharacters[0]?.id || 'starter', animationStyle: 'jelly_deformer', language: 'ru', speed: 1, pitch: 1,
                subtitles: { enabled: true, color: '#FFFFFF', size: 36, font: 'Impact' },
                scene: SceneConfig.normalize(),
            },
            gemini: { system_prompt: DEFAULT_SYSTEM_PROMPT, provider: 'gemini', model: modelCatalog.defaults.gemini, history: [] },
        });
        loadPersonaIntoForm(currentPersona.id);
        ui.personaSelect.value = '';
        ui.personaName.focus();
        showStatus('Новая персона создана. Настройте и сохраните её.', 'info');
    }

    function invalidateOpenAIChain() {
        if (currentPersona?.gemini) {
            currentPersona.gemini.previous_response_id = null;
            currentPersona.gemini.previous_key_id = null;
        }
    }

    function renderHistory() {
        if (!currentPersona) return;
        ui.history.innerHTML = '';
        (currentPersona.gemini.history || []).forEach((message, index) => {
            const wrapper = document.createElement('div');
            const isSystem = !!message.meta?.system;
            wrapper.className = `chat-msg ${isSystem ? 'system' : message.role}`;
            const who = document.createElement('span');
            who.className = 'chat-who';
            who.textContent = isSystem ? 'Система' : message.role === 'user' ? 'Вы' : currentPersona.name || 'Персонаж';
            const text = document.createElement('div');
            text.className = 'chat-text';
            text.textContent = message.parts?.[0]?.text || '';
            const actions = document.createElement('div');
            actions.className = 'chat-actions';
            const edit = document.createElement('button');
            edit.type = 'button'; edit.textContent = 'Изменить';
            edit.addEventListener('click', () => editHistory(index, wrapper));
            const remove = document.createElement('button');
            remove.type = 'button'; remove.textContent = 'Удалить';
            remove.addEventListener('click', () => {
                currentPersona.gemini.history.splice(index, 1);
                invalidateOpenAIChain(); renderHistory(); savePersona(true);
            });
            actions.append(edit, remove);
            wrapper.append(who, text, actions);
            ui.history.appendChild(wrapper);
        });
        ui.history.scrollTop = ui.history.scrollHeight;
    }

    function editHistory(index, wrapper) {
        const message = currentPersona.gemini.history[index];
        const editor = document.createElement('div');
        editor.className = 'chat-edit-area';
        const textarea = document.createElement('textarea');
        textarea.value = message.parts?.[0]?.text || '';
        const row = document.createElement('div');
        row.className = 'chat-edit-actions';
        const save = document.createElement('button'); save.className = 'button-primary'; save.textContent = 'Сохранить';
        const cancel = document.createElement('button'); cancel.className = 'button-quiet'; cancel.textContent = 'Отмена';
        save.addEventListener('click', () => {
            message.parts = [{ text: textarea.value }]; invalidateOpenAIChain(); renderHistory(); savePersona(true);
        });
        cancel.addEventListener('click', renderHistory);
        row.append(save, cancel); editor.append(textarea, row); wrapper.replaceChildren(editor); textarea.focus();
    }

    async function postAvatar(data) {
        const response = await fetch('/trigger-animation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Ошибка окна анимации');
    }

    async function setSummoned(summoned, { fade = true } = {}) {
        const previous = avatarSummoned;
        avatarSummoned = summoned;
        updateStage();
        noteInteraction();
        if (!summoned) {
            clearTimeout(summonTimer);
            summonTimer = null;
            if (requestAbort) requestAbort.abort();
            stopVoiceSession(false);
        }
        try {
            await postAvatar({
                job_type: summoned ? 'summon' : 'dismiss',
                ...scenePayload(),
                fade_ms: fade ? 520 : 0,
            });
        } catch (error) {
            avatarSummoned = previous;
            updateStage();
            showStatus(error.message, 'error');
        }
    }

    async function ensureSummoned() {
        if (!avatarSummoned) await setSummoned(true);
    }

    async function sendToAnimation(text, settings, directives = {}, append = false) {
        if (!text && !(directives.inlineEffects || []).length && !(directives.inlineEmotions || []).length) return;
        await ensureSummoned();
        const liveScene = scenePayload();
        await postAvatar({
            job_type: append ? 'tts_append' : 'tts', text,
            lang: settings.language, speed: settings.speed, pitch: settings.pitch,
            characterId: liveScene.characterId,
            animationStyle: directives.animationStyle || liveScene.animationStyle,
            subtitles: liveScene.subtitles,
            scene: liveScene.scene,
            inlineEffects: (directives.inlineEffects || []).map((item) => ({ effect: item.effect, charIndex: item.charIndex })),
            inlineEmotions: (directives.inlineEmotions || []).map((item) => ({ emotion: item.emotion, charIndex: item.charIndex })),
        });
    }

    async function stopAnimation(fadeMs = 120) {
        try { await postAvatar({ job_type: 'stop', fade_ms: fadeMs }); } catch (_error) { /* window may be closed */ }
    }

    function beginSpeechTracking(text, settings, historyEntry) {
        const words = text.split(/\s+/).filter(Boolean);
        const wordsPerSecond = Math.max(0.5, 2.5 * (Number(settings.speed) || 1));
        speechTracker = { active: true, startTime: performance.now(), wordsPerSecond, words, historyEntry };
        clearTimeout(speechTimer);
        speechTimer = setTimeout(() => { if (speechTracker) speechTracker.active = false; }, words.length / wordsPerSecond * 1000 + 1800);
    }

    function handleBargeIn() {
        if (requestAbort) requestAbort.abort();
        if (!speechTracker?.active) {
            stopAnimation(100);
            return;
        }
        const spoken = Math.max(1, Math.round((performance.now() - speechTracker.startTime) / 1000 * speechTracker.wordsPerSecond));
        if (speechTracker.historyEntry && spoken < speechTracker.words.length) {
            speechTracker.historyEntry.parts = [{ text: `${speechTracker.words.slice(0, spoken).join(' ')}…` }];
            invalidateOpenAIChain(); renderHistory(); savePersona(true);
        }
        speechTracker.active = false;
        stopAnimation(100);
    }

    async function prepareHistory() {
        const history = currentPersona.gemini.history || [];
        const limit = Math.max(8, Number(ui.contextLimit.value) || 30);
        if (ui.contextMode.value === 'full' || history.length <= limit) return [...history];
        if (ui.contextMode.value === 'truncate') return history.slice(-limit);

        const keepCount = Math.max(6, Math.floor(limit / 2));
        const older = history.slice(0, -keepCount);
        const recent = history.slice(-keepCount);
        if (!older.length) return [...history];
        showStatus('Сжимаю старую часть диалога…', 'info', 0);
        try {
            const response = await fetch('/api/ai/compact', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: ui.provider.value, model: ui.model.value.trim(), chat_history: older }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Сжатие не удалось');
            const summary = {
                role: 'user', meta: { system: true, summary: true },
                parts: [{ text: `Сжатая сводка предыдущего диалога: ${result.summary}` }],
            };
            currentPersona.gemini.history = [summary, ...recent];
            invalidateOpenAIChain(); renderHistory(); await savePersona(true);
            return [...currentPersona.gemini.history];
        } catch (error) {
            showStatus(`Авто-сжатие не удалось; отправляю последние сообщения: ${error.message}`, 'error');
            return history.slice(-limit);
        }
    }

    function takeCompleteSpeechChunks(buffer, flush = false) {
        if (flush) return { chunks: buffer.trim() ? [buffer.trim()] : [], rest: '' };
        const chunks = [];
        let cut = 0;
        const regex = /[^.!?…\n]+[.!?…]+(?:\s+|$)|[^\n]+\n+/g;
        let match;
        while ((match = regex.exec(buffer)) !== null) {
            const candidate = match[0].trim();
            const opens = (candidate.match(/(?:soundboard|emotion)\s*\(/gi) || []).length;
            const closes = (candidate.match(/\)/g) || []).length;
            if (opens > closes) break;
            if (candidate) chunks.push(candidate);
            cut = regex.lastIndex;
        }
        return { chunks, rest: buffer.slice(cut) };
    }

    async function speakStreamChunks(chunks) {
        for (const chunk of chunks) {
            const parsed = parseAssistantDirectives(chunk);
            await sendToAnimation(parsed.cleaned, currentPersona.settings, parsed, true);
        }
    }

    async function commitReply(rawReply, { alreadySpoken = false, responseId = null } = {}) {
        if (!rawReply.trim() || !currentPersona) return;
        if (pendingUserMessage) currentPersona.gemini.history.push(pendingUserMessage);
        const modelEntry = { role: 'model', parts: [{ text: rawReply.trim() }] };
        currentPersona.gemini.history.push(modelEntry);
        // A stored OpenAI response only continues the dialogue if OpenAI also produced this turn.
        const chained = responseId?.id && ui.cacheChat.checked;
        currentPersona.gemini.previous_response_id = chained ? responseId.id : null;
        currentPersona.gemini.previous_key_id = chained ? responseId.keyId : null;
        pendingUserMessage = null;
        renderHistory();
        await savePersona(true);
        const parsed = parseAssistantDirectives(rawReply);
        if (!alreadySpoken) await sendToAnimation(parsed.cleaned, currentPersona.settings, parsed, false);
        beginSpeechTracking(parsed.cleaned, currentPersona.settings, modelEntry);
        ui.responseArea.style.display = 'none';
        ui.responseArea.dataset.streaming = 'false';
        ui.responseText.textContent = '';
        pendingWasStreamed = false;
        pendingResponseId = null;
    }

    async function askAI(userMessage, { autoSpeak = false, systemMessage = false, screenId = null, fromVoice = false } = {}) {
        if (!userMessage?.trim() || requestInFlight) return;
        collectForm();
        noteInteraction();
        clearTimeout(summonTimer); summonTimer = null;
        await ensureSummoned();
        requestInFlight = true;
        pendingWasStreamed = false;
        pendingResponseId = null;
        ui.ask.disabled = true;
        ui.ask.textContent = 'ИИ отвечает…';
        ui.responseText.textContent = '';
        ui.responseArea.style.display = 'block';
        ui.responseArea.dataset.streaming = 'true';
        const chain = activeChain();
        showStatus(`Запрос: ${chain[0] || 'модель не выбрана'}${chain.length > 1 ? ` (цепочка из ${chain.length})` : ''}`, 'info', 0);

        const history = await prepareHistory();
        pendingUserMessage = {
            role: 'user', parts: [{ text: userMessage.trim() }],
            ...(systemMessage ? { meta: { system: true } } : {}),
        };
        const historyForRequest = [...history, pendingUserMessage];
        let fullReply = '';
        let speechBuffer = '';
        let responseId = null;
        let answeringModel = chain[0];
        requestAbort = new AbortController();

        try {
            const response = await fetch('/api/ai/stream', {
                method: 'POST', signal: requestAbort.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: providerFor(ui.model.value), model: ui.model.value.trim(), persona_id: currentPersona.id,
                    fallback_enabled: ui.fallbackToggle.checked, fallback_models: fallbackChain.filter(Boolean),
                    request_timeout_s: Number(ui.requestTimeout.value) || 60, thinking: ui.thinking.checked,
                    system_prompt: fullSystemPrompt(fromVoice ? VOICE_NOTE : ''), chat_history: historyForRequest,
                    previous_response_id: currentPersona.gemini.previous_response_id || null,
                    previous_key_id: currentPersona.gemini.previous_key_id || null,
                    cache_chat: ui.cacheChat.checked, context_mode: ui.contextMode.value,
                    compact_threshold: Math.max(8000, Number(ui.contextLimit.value) * 1000), screen_id: screenId,
                }),
            });
            if (!response.ok || !response.body) throw new Error(`Сервер вернул HTTP ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let pending = '';
            while (true) {
                const { value, done } = await reader.read();
                pending += decoder.decode(value || new Uint8Array(), { stream: !done });
                const lines = pending.split('\n');
                pending = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);
                    if (event.type === 'error') throw new Error(event.error || 'Ошибка ИИ');
                    if (event.type === 'model') {
                        answeringModel = event.model;
                        ui.conversationModel.textContent = `Отвечает ${event.model}` + (event.total > 1 ? ` · ступень ${event.position} из ${event.total}` : '');
                    }
                    if (event.type === 'notice') showStatus(event.text, 'info', 8000);
                    if (event.type === 'delta') {
                        fullReply += event.text || '';
                        ui.responseText.textContent = fullReply;
                        if (autoSpeak) {
                            speechBuffer += event.text || '';
                            const ready = takeCompleteSpeechChunks(speechBuffer);
                            speechBuffer = ready.rest;
                            if (ready.chunks.length) {
                                pendingWasStreamed = true;
                                await speakStreamChunks(ready.chunks);
                            }
                        }
                    }
                    if (event.type === 'done') responseId = event.response_id ? { id: event.response_id, keyId: event.key_id || null } : null;
                }
                if (done) break;
            }
            if (autoSpeak && speechBuffer.trim()) {
                pendingWasStreamed = true;
                await speakStreamChunks(takeCompleteSpeechChunks(speechBuffer, true).chunks);
            }
            ui.prompt.value = '';
            ui.responseArea.dataset.streaming = 'false';
            showStatus(`Ответ получен · ${answeringModel}`, 'success');
            pendingResponseId = responseId;
            if (autoSpeak) await commitReply(fullReply, { alreadySpoken: pendingWasStreamed, responseId });
        } catch (error) {
            if (!fullReply.trim()) {
                if (error.name !== 'AbortError') showStatus(`Ошибка ИИ: ${error.message}`, 'error', 12000);
                pendingUserMessage = null;
                ui.responseArea.style.display = 'none';
            } else {
                ui.responseArea.dataset.streaming = 'false';
                if (error.name !== 'AbortError') showStatus(`${error.message} Частичный ответ оставлен как черновик.`, 'error', 12000);
            }
        } finally {
            requestInFlight = false;
            requestAbort = null;
            ui.ask.disabled = false;
            ui.ask.textContent = 'Отправить';
            refreshBudget();
            loadKeys();
        }
    }

    function createRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return null;
        const instance = new SpeechRecognition();
        instance.continuous = true;
        instance.interimResults = true;
        instance.maxAlternatives = 1;
        instance.onstart = () => {
            recognitionRunning = true;
            ui.voice.textContent = voiceMode === 'idle' ? 'Слушаю фон…' : 'Закончить разговор';
            ui.voice.setAttribute('aria-pressed', 'true');
            setPttStatus('live', voiceMode === 'idle' ? 'Слушаю фон' : 'Микрофон включён');
        };
        instance.onresult = (event) => {
            voiceInterim = '';
            for (let index = event.resultIndex; index < event.results.length; index++) {
                const result = event.results[index];
                if (result.isFinal) voiceTranscript += `${result[0].transcript} `;
                else voiceInterim += result[0].transcript;
            }
            if (voiceMode !== 'idle') ui.prompt.value = `${voiceTranscript}${voiceInterim}`.trim();
        };
        instance.onerror = (event) => {
            if (!['aborted', 'no-speech'].includes(event.error)) showStatus(`Распознавание речи: ${event.error}`, 'error');
        };
        instance.onend = () => {
            recognitionRunning = false;
            if (voiceDesired) {
                clearTimeout(voiceRestartTimer);
                voiceRestartTimer = setTimeout(startRecognitionEngine, 180);
            } else {
                finalizeVoiceSession();
            }
        };
        return instance;
    }

    function startRecognitionEngine() {
        if (!voiceDesired || recognitionRunning) return;
        recognition ||= createRecognition();
        if (!recognition) {
            voiceDesired = false;
            showStatus('Браузер не поддерживает распознавание речи.', 'error');
            return;
        }
        try {
            recognition.lang = ui.language.value;
            recognition.start();
        } catch (_error) {
            voiceRestartTimer = setTimeout(startRecognitionEngine, 250);
        }
    }

    async function startVoiceSession(mode = 'dialogue') {
        if (voiceDesired) return;
        await ensureSummoned();
        noteInteraction();
        clearTimeout(summonTimer); summonTimer = null;
        handleBargeIn();
        voiceMode = mode;
        voiceTranscript = '';
        voiceInterim = '';
        voiceDesired = true;
        startRecognitionEngine();
        if (mode === 'idle') idleStopTimer = setTimeout(() => stopVoiceSession(true), 5000);
    }

    function stopVoiceSession(shouldFinalize = true) {
        clearTimeout(idleStopTimer); idleStopTimer = null;
        clearTimeout(voiceRestartTimer); voiceRestartTimer = null;
        if (!voiceDesired && !recognitionRunning) return;
        voiceDesired = false;
        if (!shouldFinalize) {
            voiceTranscript = '';
            voiceInterim = '';
        }
        try {
            if (recognitionRunning) recognition.stop();
            else finalizeVoiceSession();
        } catch (_error) {
            finalizeVoiceSession();
        }
    }

    function finalizeVoiceSession() {
        const mode = voiceMode;
        const text = `${voiceTranscript} ${voiceInterim}`.replace(/\s+/g, ' ').trim();
        voiceTranscript = ''; voiceInterim = '';
        ui.voice.textContent = 'Включить микрофон';
        ui.voice.setAttribute('aria-pressed', 'false');
        setPttStatus(hotkeysAvailable ? 'ready' : 'off', hotkeysAvailable ? 'Хоткеи: готовы' : 'Хоткеи: выкл');
        if (!text) {
            if (mode !== 'idle') showStatus('Ничего не распознано.', 'info', 2200);
            return;
        }
        if (pendingScreenshot) {
            const screen = pendingScreenshot;
            pendingScreenshot = null;
            clearTimeout(screen.timer);
            askAI(text, { autoSpeak: true, screenId: screen.id, fromVoice: true });
        } else if (mode === 'idle') {
            const note = `{Системный текст: пользователь давно с тобой не говорил. Несколько секунд фонового разговора: «${text}». Отреагируй только если это уместно.}`;
            askAI(note, { autoSpeak: true, systemMessage: true, fromVoice: true });
        } else {
            askAI(text, { autoSpeak: true, fromVoice: true });
        }
    }

    function setPttStatus(state, text) {
        ui.pttStatus.dataset.state = state;
        ui.pttStatusText.textContent = text;
    }

    function scheduleSummonGreeting() {
        clearTimeout(summonTimer);
        summonTimer = setTimeout(() => {
            summonTimer = null;
            if (!voiceDesired && !pendingScreenshot && avatarSummoned && !requestInFlight) {
                askAI('{Системный текст: пользователь только что призвал тебя. Начни короткую живую реплику.}', {
                    autoSpeak: true, systemMessage: true,
                });
            }
        }, Number(ui.validationDelay.value) * 1000);
    }

    async function captureScreenshotFlow() {
        noteInteraction();
        clearTimeout(summonTimer); summonTimer = null;
        await ensureSummoned();
        showStatus('Снимок первого монитора сделан; жду возможную реплику…', 'info', 0);
        try {
            const response = await fetch('/capture-screen', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Снимок не удался');
            if (pendingScreenshot) clearTimeout(pendingScreenshot.timer);
            pendingScreenshot = { id: result.screen_id, timer: null };
            pendingScreenshot.timer = setTimeout(() => {
                if (!pendingScreenshot || voiceDesired) return;
                const screen = pendingScreenshot;
                pendingScreenshot = null;
                askAI(SCREEN_PROMPT, { autoSpeak: true, systemMessage: true, screenId: screen.id });
            }, Number(ui.validationDelay.value) * 1000);
        } catch (error) {
            pendingScreenshot = null;
            showStatus(error.message, 'error');
        }
    }

    async function pollHotkeys() {
        try {
            const response = await fetch('/ptt-state');
            if (!response.ok) return;
            const state = await response.json();
            hotkeysAvailable = !!state.available;
            if (!lastHotkeyGenerations) {
                lastHotkeyGenerations = { ...(state.generations || {}) };
                ui.micHotkey.value = state.hotkeys?.microphone || 'ctrl+alt+m';
                ui.summonHotkey.value = state.hotkeys?.summon || 'ctrl+alt+b';
                ui.screenshotHotkey.value = state.hotkeys?.screenshot || 'ctrl+alt+s';
                avatarSummoned = !!state.summoned;
                updateStage();
                setPttStatus(hotkeysAvailable ? 'ready' : 'off', hotkeysAvailable ? 'Хоткеи: готовы' : 'Хоткеи: недоступны');
                return;
            }
            const generations = state.generations || {};
            if (generations.summon !== lastHotkeyGenerations.summon) {
                lastHotkeyGenerations.summon = generations.summon;
                if (state.summoned) {
                    await setSummoned(true);
                    scheduleSummonGreeting();
                } else {
                    await setSummoned(false);
                }
            }
            if (generations.microphone !== lastHotkeyGenerations.microphone) {
                lastHotkeyGenerations.microphone = generations.microphone;
                if (state.microphone_active) startVoiceSession('dialogue');
                else stopVoiceSession(true);
            }
            if (generations.screenshot !== lastHotkeyGenerations.screenshot) {
                lastHotkeyGenerations.screenshot = generations.screenshot;
                captureScreenshotFlow();
            }
        } catch (_error) { /* server may be restarting */ }
    }

    async function saveHotkeys() {
        const fields = [ui.micHotkey, ui.summonHotkey, ui.screenshotHotkey];
        const modifiers = ['ctrl', 'alt', 'shift', 'windows'];
        const aliases = { control: 'ctrl', win: 'windows', super: 'windows', esc: 'escape', return: 'enter', pgup: 'page up', pgdn: 'page down', del: 'delete', ins: 'insert' };
        const named = ['space', 'tab', 'enter', 'escape', 'backspace', 'delete', 'insert', 'home', 'end', 'page up', 'page down', 'up', 'down', 'left', 'right'];
        const used = new Set();
        for (const field of fields) {
            const tokens = field.value.toLowerCase().split('+').map(key => aliases[key.trim()] || key.trim());
            const mods = modifiers.filter(key => tokens.includes(key));
            const keys = tokens.filter(key => !modifiers.includes(key));
            const valid = mods.length >= 2 && keys.length === 1 && new Set(tokens).size === tokens.length && (/^[a-z0-9]$/.test(keys[0]) || named.includes(keys[0]));
            const normalized = [...mods, ...keys].join('+');
            const error = !valid ? 'Минимум 3 разные клавиши: два модификатора и обычная клавиша. Например Ctrl+Alt+M. Без F-клавиш.' : used.has(normalized) ? 'Для каждого действия нужно отдельное сочетание.' : '';
            field.setCustomValidity(error);
            field.setAttribute('aria-invalid', String(!!error));
            if (error) { field.reportValidity(); showStatus(error, 'error'); return; }
            field.value = normalized;
            used.add(normalized);
        }
        ui.hotkeySave.disabled = true;
        try {
            const response = await fetch('/ptt-config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hotkeys: {
                    microphone: ui.micHotkey.value.trim(), summon: ui.summonHotkey.value.trim(),
                    screenshot: ui.screenshotHotkey.value.trim(),
                } }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Не удалось применить хоткеи');
            lastHotkeyGenerations = { ...result.generations };
            ui.micHotkey.value = result.hotkeys.microphone;
            ui.summonHotkey.value = result.hotkeys.summon;
            ui.screenshotHotkey.value = result.hotkeys.screenshot;
            showStatus(result.available ? 'Сочетания сохранены. Теперь назначь их кнопкам Stream Deck.' : 'Сочетания сохранены, но глобальные хоткеи недоступны. Проверь запуск сервера.', result.available ? 'success' : 'info');
        } catch (error) {
            showStatus(error.message, 'error');
        } finally {
            ui.hotkeySave.disabled = false;
        }
    }

    function activeChain() {
        return ui.fallbackToggle.checked ? fallbackChain.filter(Boolean) : [ui.model.value.trim()].filter(Boolean);
    }

    function modelInfo(id) {
        const name = String(id || '').trim().replace(/^models\//, '');
        return modelCatalog.models.find((item) => item.id === name);
    }

    function hasKeys(provider) {
        return !keysStatus || (keysStatus.providers?.[provider]?.total || 0) > 0;
    }

    function dailyLimit(model) {
        for (const key of keysStatus?.keys || []) {
            const row = (key.gemini_usage || []).find((item) => item.model === model);
            if (row?.limits?.rpd) return row.limits.rpd;
        }
        return null;
    }

    // One short line per model: provider, free tier and why it may be skipped.
    function modelTag(id) {
        const provider = providerFor(id);
        const info = modelInfo(id);
        const parts = [PROVIDER_LABELS[provider]];
        if (!info) parts.push(modelCatalog.models.length ? 'нет в каталоге - проверь имя' : 'каталог загружается');
        else if (provider === 'openai') parts.push(info.free_tier ? info.price.split(' · ').pop() : 'платная');
        else if (info.free_tier === true) parts.push(dailyLimit(info.id) ? `бесплатно, ${dailyLimit(info.id)} запросов в день на проект` : 'бесплатно');
        else parts.push(info.free_tier === false ? 'только платно' : 'бесплатная квота не подтверждена');
        if (!hasKeys(provider)) parts.push(`нет ключей ${PROVIDER_LABELS[provider]}`);
        return parts.join(' · ');
    }

    function describeModels() {
        const chain = activeChain();
        ui.conversationModel.textContent = chain.length > 1
            ? `Цепочка · ${chain[0]} и ещё ${chain.length - 1}` : (chain[0] || 'Модель не выбрана');
        const missing = [...new Set(chain.map(providerFor))].filter((provider) => !hasKeys(provider));
        const unknown = modelCatalog.models.length ? chain.filter((id) => !modelInfo(id)) : [];
        const notes = [];
        if (!chain.length) notes.push('Добавь хотя бы одну модель.');
        if (missing.length) notes.push(`Нет ключей ${missing.map((provider) => PROVIDER_LABELS[provider]).join(' и ')}: такие модели будут пропущены. Добавь ключ в разделе «Ключи и лимиты».`);
        if (unknown.length) notes.push(`Нет в каталоге: ${unknown.join(', ')}. Проверь имя модели.`);
        ui.modelNote.dataset.tone = notes.length ? 'warn' : '';
        ui.modelNote.textContent = notes.length ? notes.join(' ') : ui.fallbackToggle.checked ? '' : modelTag(chain[0]);
    }

    function renderFallbackChain() {
        ui.singleModel.hidden = ui.fallbackToggle.checked;
        ui.fallbackEditor.hidden = !ui.fallbackToggle.checked;
        ui.fallbackRows.replaceChildren(...fallbackChain.map((model, index) => {
            const row = document.createElement('li');
            row.className = 'fallback-row';
            const input = document.createElement('input');
            input.type = 'text'; input.value = model; input.placeholder = 'Имя модели'; input.spellcheck = false;
            input.setAttribute('list', 'chain-model-options');
            input.setAttribute('aria-label', `Модель ${index + 1}`);
            const tag = document.createElement('span');
            tag.className = 'model-tag';
            tag.textContent = model ? modelTag(model) : 'Выбери модель из списка или впиши имя';
            input.addEventListener('input', () => {
                fallbackChain[index] = input.value.trim();
                tag.textContent = fallbackChain[index] ? modelTag(fallbackChain[index]) : '';
                describeModels();
            });
            row.append(input);
            [['↑', -1, 'Выше'], ['↓', 1, 'Ниже'], ['×', 0, 'Убрать']].forEach(([symbol, shift, label]) => {
                const button = document.createElement('button');
                button.type = 'button'; button.textContent = symbol; button.title = label;
                button.setAttribute('aria-label', `${label}: ${model || 'пустая строка'}`);
                button.disabled = shift !== 0 && (index + shift < 0 || index + shift >= fallbackChain.length);
                button.addEventListener('click', () => {
                    if (shift) [fallbackChain[index], fallbackChain[index + shift]] = [fallbackChain[index + shift], fallbackChain[index]];
                    else fallbackChain.splice(index, 1);
                    renderFallbackChain();
                });
                row.append(button);
            });
            row.append(tag);
            return row;
        }));
        describeModels();
    }

    function populateModelOptions(changeModel = true) {
        const provider = ui.provider.value;
        const order = { strong: 0, light: 1, paid: 2, unknown: 3 };
        const sorted = [...modelCatalog.models].sort((a, b) => (order[a.tier] ?? 3) - (order[b.tier] ?? 3) || (a.rank ?? 999) - (b.rank ?? 999));
        const options = (items) => items.map((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.label = `${item.label} · ${item.free_tier ? 'бесплатно' : item.free_tier === false ? 'платно' : 'квота не подтверждена'}`;
            return option;
        });
        ui.modelOptions.replaceChildren(...options(sorted.filter((item) => item.provider === provider)));
        ui.chainOptions.replaceChildren(...options(sorted));
        if (changeModel && providerFor(ui.model.value) !== provider) ui.model.value = modelCatalog.defaults[provider];
        describeModels();
    }

    async function loadModels() {
        try {
            const response = await fetch('/api/models');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            modelCatalog = await response.json();
        } catch (error) {
            showStatus(`Каталог моделей недоступен: ${error.message}`, 'error');
        }
        populateModelOptions(false);
        if (!ui.fallbackRows.contains(document.activeElement)) renderFallbackChain();
    }

    function formatReset(seconds) {
        const safe = Math.max(0, Number(seconds) || 0);
        return `${Math.floor(safe / 3600)} ч ${Math.floor(safe % 3600 / 60)} мин`;
    }

    function formatWait(seconds) {
        const safe = Math.max(0, Math.round(Number(seconds) || 0));
        return safe >= 3600 ? formatReset(safe) : safe >= 90 ? `${Math.round(safe / 60)} мин` : `${safe} с`;
    }

    function maskKey(key) {
        return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : `${key.slice(0, 3)}…`;
    }

    function markKeysDirty() {
        ui.keysSave.dataset.dirty = 'true';
        ui.keysDirty.textContent = 'Есть несохранённые изменения';
    }

    function keyState(item) {
        const live = keysStatus?.keys.find((key) => key.id === item.id);
        if (!live) return { state: 'pause', title: 'Новый', detail: 'заработает после сохранения' };
        if (!item.enabled) return { state: 'off', title: 'Выключен', detail: live.cooldown_reason || live.last_error || '' };
        if (live.cooling_down) return { state: 'pause', title: `Пауза ${formatWait(live.cooldown_left_s)}`, detail: live.cooldown_reason };
        if (live.last_error && !live.success_count && live.fail_count) return { state: 'error', title: 'Ошибка', detail: live.last_error };
        const paused = live.model_cooldowns || [];
        // Gemini requests come from the shared counter, so other projects' calls are included.
        const today = live.provider === 'gemini'
            ? (live.gemini_usage || []).reduce((sum, row) => sum + (row.requests_today || 0), 0) : live.requests_today;
        const word = today % 10 === 1 && today % 100 !== 11 ? 'запрос'
            : [2, 3, 4].includes(today % 10) && ![12, 13, 14].includes(today % 100) ? 'запроса' : 'запросов';
        return {
            state: paused.length ? 'pause' : 'ok',
            title: 'Работает',
            detail: `${today} ${word} сегодня` + (paused.length ? ` · на паузе: ${paused.map((item) => item.model).join(', ')}` : ''),
            reasons: paused.map((item) => `${item.model}: ${item.reason} (ещё ${formatWait(item.left_s)})`).join('\n'),
        };
    }

    function renderKeys() {
        const counts = keysStatus?.providers || {};
        const summary = Object.entries(PROVIDER_LABELS).map(([provider, label]) => {
            const value = counts[provider] || { total: 0, available: 0 };
            return `${label}: готовы ${value.available} из ${value.total}`;
        });
        if (keysStatus && !keysStatus.gemini_quota_available) summary.push('Общий учёт Gemini не установлен');
        ui.keysSummary.replaceChildren(...summary.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
        ui.keysList.replaceChildren(...keysDraft.map((item, index) => {
            const row = document.createElement('li');
            row.className = 'key-row';
            row.dataset.provider = item.provider;
            row.dataset.enabled = String(item.enabled);
            const provider = Object.assign(document.createElement('span'), { className: 'key-provider', textContent: PROVIDER_LABELS[item.provider] });
            const main = Object.assign(document.createElement('div'), { className: 'key-main' });
            const label = Object.assign(document.createElement('input'), { type: 'text', value: item.label, maxLength: 60 });
            label.setAttribute('aria-label', 'Подпись ключа');
            label.addEventListener('input', () => { item.label = label.value; markKeysDirty(); });
            main.append(label, Object.assign(document.createElement('code'), { textContent: item.masked || maskKey(item.key || '') }));
            const status = keyState(item);
            const state = Object.assign(document.createElement('span'), { className: 'key-state', title: status.reasons || status.detail || '' });
            state.dataset.state = status.state;
            state.append(Object.assign(document.createElement('strong'), { textContent: status.title }), status.detail || '');
            const toggle = document.createElement('label');
            toggle.className = 'switch';
            const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox', checked: item.enabled });
            checkbox.addEventListener('change', () => { item.enabled = checkbox.checked; row.dataset.enabled = String(item.enabled); markKeysDirty(); });
            toggle.append(checkbox, Object.assign(document.createElement('span'), { className: 'track' }),
                Object.assign(document.createElement('span'), { className: 'sr-only', textContent: `Ключ «${item.label}» включён` }));
            const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'key-remove', textContent: '×' });
            remove.setAttribute('aria-label', `Удалить ключ «${item.label}»`);
            remove.addEventListener('click', () => { keysDraft.splice(index, 1); markKeysDirty(); renderKeys(); });
            row.append(provider, main, state, toggle, remove);
            return row;
        }));
        renderQuota();
    }

    function renderQuota() {
        const keys = (keysStatus?.keys || []).filter((key) => key.provider === 'gemini' && key.enabled && key.gemini_usage?.length);
        let models = activeChain().filter((id) => providerFor(id) === 'gemini');
        if (!models.length) models = modelCatalog.fallback_chain.filter((id) => providerFor(id) === 'gemini');
        models = [...new Set(models)].filter((id) => keys.some((key) => key.gemini_usage.some((row) => row.model === id)));
        if (!keys.length || !models.length) { ui.quotaTable.replaceChildren(); return; }
        const cell = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
        const table = document.createElement('table');
        table.append(Object.assign(document.createElement('caption'), { className: 'sr-only', textContent: 'Остаток бесплатных запросов Gemini на сегодня' }));
        const head = document.createElement('tr');
        head.append(cell('th', 'Ключ'), ...models.map((id) => cell('th', modelInfo(id)?.label || id)));
        const body = document.createElement('tbody');
        keys.forEach((key) => {
            const row = document.createElement('tr');
            row.append(cell('td', key.label));
            models.forEach((id) => {
                const usage = key.gemini_usage.find((item) => item.model === id);
                const td = cell('td', !usage ? '-' : usage.blocked ? 'пауза' : `${usage.remaining_day} / ${usage.limits.rpd}`);
                if (usage) {
                    td.dataset.level = usage.blocked || usage.remaining_day <= 0 ? 'empty' : usage.remaining_day / usage.limits.rpd < .25 ? 'low' : '';
                    td.title = usage.reason || `Сброс через ${formatReset(usage.reset_at - Date.now() / 1000)}`;
                }
                row.append(td);
            });
            body.append(row);
        });
        const thead = document.createElement('thead');
        thead.append(head);
        table.append(thead, body);
        ui.quotaTable.replaceChildren(table);
    }

    async function loadKeys() {
        try {
            const response = await fetch('/api/keys');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            keysStatus = await response.json();
            if (!ui.keysSave.dataset.dirty) keysDraft = keysStatus.keys.map((item) => ({ ...item }));
            renderKeys();
        } catch (error) {
            ui.keysSummary.textContent = `Статус ключей недоступен: ${error.message}`;
        }
        if (!ui.fallbackRows.contains(document.activeElement)) renderFallbackChain();
    }

    async function saveKeys() {
        ui.keysSave.disabled = true;
        try {
            const response = await fetch('/api/keys', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys: keysDraft.map(({ id, label, provider, enabled, key }) => ({ id, label, provider, enabled, ...(key ? { key } : {}) })) }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Не удалось сохранить ключи');
            delete ui.keysSave.dataset.dirty;
            ui.keysDirty.textContent = '';
            keysStatus = result;
            keysDraft = result.keys.map((item) => ({ ...item }));
            renderKeys();
            renderFallbackChain();
            refreshBudget();
            loadModels();
            showStatus('Ключи сохранены. Паузы сброшены - каждый ключ получит новый шанс.', 'success');
        } catch (error) {
            showStatus(error.message, 'error');
        } finally {
            ui.keysSave.disabled = false;
        }
    }

    function budgetModel() {
        return activeChain().find((id) => providerFor(id) === 'openai') || modelCatalog.defaults.openai;
    }

    async function refreshBudget() {
        describeModels();
        ui.budgetCard.hidden = !hasKeys('openai');
        if (ui.budgetCard.hidden) return;
        try {
            const response = await fetch(`/api/ai-budget?model=${encodeURIComponent(budgetModel())}`);
            const data = await response.json();
            if (!data.available) throw new Error(data.error || 'Трекер недоступен');
            const group = data.groups?.[data.selected_group];
            if (!group) throw new Error('Модель не входит в настроенные бесплатные группы');
            const percent = Math.min(100, Math.max(0, Number(group.pct) || 0));
            ui.budgetTitle.textContent = group.label || data.selected_group;
            ui.budgetDetail.textContent = `${group.used.toLocaleString('ru-RU')} / ${group.limit.toLocaleString('ru-RU')} токенов · сброс через ${formatReset(data.reset_in_s)} · ${data.source}`;
            ui.budgetFill.style.width = `${percent}%`;
            ui.budgetCard.dataset.state = percent >= 90 ? 'danger' : percent >= 70 ? 'warn' : 'ok';
        } catch (error) {
            ui.budgetTitle.textContent = 'OpenAI API-лимит';
            ui.budgetDetail.textContent = error.message;
            ui.budgetFill.style.width = '0%';
            ui.budgetCard.dataset.state = 'idle';
        }
    }

    async function populateStaticData() {
        const [charactersResponse, animationsResponse, effectsResponse] = await Promise.all([
            fetch('/static/characters.json'), fetch('/static/animations.json'), fetch('/static/special_effects.json'),
        ]);
        const characters = await charactersResponse.json();
        visualCharacters = characters;
        const animations = await animationsResponse.json();
        effects = await effectsResponse.json();
        ui.effectCount.textContent = effects.length;
        ui.character.innerHTML = '';
        characters.forEach((character) => {
            const option = document.createElement('option'); option.value = character.id; option.textContent = character.name; ui.character.appendChild(option);
        });
        ui.animation.innerHTML = '';
        animations.forEach((group) => {
            const optgroup = document.createElement('optgroup'); optgroup.label = group.groupName;
            group.animations.forEach((animation) => {
                const option = document.createElement('option'); option.value = animation.id; option.textContent = animation.name; optgroup.appendChild(option);
            });
            ui.animation.appendChild(optgroup);
        });
        ui.effects.innerHTML = '';
        effects.forEach((effect) => {
            const button = document.createElement('button'); button.className = 'sfx-button'; button.textContent = effect.name;
            button.type = 'button';
            if (SceneConfig.soundEffects[effect.id]) button.style.setProperty('--cue-color', SceneConfig.soundEffects[effect.id].color);
            button.addEventListener('click', async () => {
                if (!currentPersona) return;
                collectForm();
                button.disabled = true;
                try {
                    await ensureSummoned();
                    const response = await fetch('/trigger-special-effect', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ effectId: effect.id, ...scenePayload() }),
                    });
                    if (!response.ok) throw new Error('Не удалось включить звуковой эффект');
                    showStatus(`Эффект «${effect.name}» отправлен в окно OBS.`, 'success');
                } catch (error) { showStatus(error.message, 'error'); }
                finally { button.disabled = false; }
            });
            ui.effects.appendChild(button);
        });
        ui.emotionPreviews.innerHTML = '';
        EMOTIONS.forEach((emotion) => {
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = emotion.name;
            button.style.setProperty('--cue-color', emotion.color);
            button.addEventListener('click', async () => {
                await ensureSummoned();
                await postAvatar({ job_type: 'emotion', emotion: emotion.id, ...scenePayload() });
            });
            ui.emotionPreviews.appendChild(button);
        });
        ui.effectPreviews.innerHTML = '';
        effects.forEach((effect) => {
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = effect.name;
            button.style.setProperty('--cue-color', SceneConfig.soundEffects[effect.id]?.color || '#bba7db');
            button.addEventListener('click', async () => {
                await ensureSummoned();
                await postAvatar({ job_type: 'effect_preview', effectId: effect.id, ...scenePayload() });
            });
            ui.effectPreviews.appendChild(button);
        });
        ui.aiRules.value = buildRules();
    }

    function checkIdleListening() {
        if (!currentPersona || !ui.idleListen.checked || !avatarSummoned || voiceDesired || requestInFlight || speechTracker?.active) return;
        const delay = Math.max(30, Number(ui.idleDelay.value) || 120) * 1000;
        if (Date.now() - lastInteractionAt >= delay) {
            lastInteractionAt = Date.now();
            startVoiceSession('idle');
        }
    }

    function setupSceneEditor() {
        let dragging = false;
        let dragOffset = { x: 0, y: 0 };
        const moveTo = (clientX, clientY, persist = false) => {
            const rect = ui.sceneEditor.getBoundingClientRect();
            ui.sceneX.value = SceneConfig.clamp((clientX - dragOffset.x - rect.left) / rect.width * 100, 0, 100);
            ui.sceneY.value = SceneConfig.clamp((clientY - dragOffset.y - rect.top) / rect.height * 100, 0, 100);
            queueSceneUpdate(persist);
        };
        ui.scenePreview.addEventListener('pointerdown', event => {
            const rect = ui.sceneEditor.getBoundingClientRect();
            dragOffset = {
                x: event.clientX - (rect.left + rect.width * Number(ui.sceneX.value) / 100),
                y: event.clientY - (rect.top + rect.height * Number(ui.sceneY.value) / 100),
            };
            dragging = true; ui.scenePreview.setPointerCapture(event.pointerId); moveTo(event.clientX, event.clientY);
        });
        ui.scenePreview.addEventListener('pointermove', event => {
            if (dragging) moveTo(event.clientX, event.clientY);
        });
        const finish = event => {
            if (!dragging) return;
            dragging = false; moveTo(event.clientX, event.clientY, true);
        };
        ui.scenePreview.addEventListener('pointerup', finish);
        ui.scenePreview.addEventListener('pointercancel', () => { dragging = false; queueSceneUpdate(true); });
        ui.scenePreview.addEventListener('keydown', event => {
            const delta = event.shiftKey ? 5 : 1;
            if (event.key === 'ArrowLeft') ui.sceneX.value = Number(ui.sceneX.value) - delta;
            else if (event.key === 'ArrowRight') ui.sceneX.value = Number(ui.sceneX.value) + delta;
            else if (event.key === 'ArrowUp') ui.sceneY.value = Number(ui.sceneY.value) - delta;
            else if (event.key === 'ArrowDown') ui.sceneY.value = Number(ui.sceneY.value) + delta;
            else return;
            event.preventDefault(); queueSceneUpdate(true);
        });
        document.querySelectorAll('[data-scene-preset]').forEach(button => button.addEventListener('click', () => {
            ui.sceneX.value = button.dataset.scenePreset === 'left' ? 15 : button.dataset.scenePreset === 'right' ? 85 : 50;
            ui.sceneY.value = 98;
            queueSceneUpdate(true);
        }));
        ui.sceneReset.addEventListener('click', () => { setSceneForm(SceneConfig.defaults); queueSceneUpdate(true); });
    }

    ui.personaSelect.addEventListener('change', () => loadPersonaIntoForm(ui.personaSelect.value));
    ui.savePersona.addEventListener('click', () => savePersona(false));
    ui.newPersona.addEventListener('click', createPersona);
    ui.summon.addEventListener('click', async () => {
        if (!currentPersona) return;
        collectForm();
        ui.summon.disabled = true;
        try {
            await setSummoned(!avatarSummoned);
            if (avatarSummoned) scheduleSummonGreeting();
        } finally { ui.summon.disabled = false; }
    });
    ui.character.addEventListener('change', () => { updateStage(); queueSceneUpdate(true); });
    ui.animation.addEventListener('change', () => queueSceneUpdate(true));
    ui.personaName.addEventListener('input', updateStage);
    ui.stageHead.addEventListener('load', fitStageCharacter);
    ui.stageBody.addEventListener('load', fitStageCharacter);
    ui.scenePreviewHead.addEventListener('load', updateScenePreview);
    ui.scenePreviewBody.addEventListener('load', updateScenePreview);
    new ResizeObserver(fitStageCharacter).observe(ui.stageCharacter.parentElement);
    ui.send.addEventListener('click', async () => {
        collectForm();
        const parsed = parseAssistantDirectives(ui.text.value.trim());
        ui.send.disabled = true;
        try { await sendToAnimation(parsed.cleaned, currentPersona.settings, parsed); }
        catch (error) { showStatus(error.message, 'error'); }
        finally { ui.send.disabled = false; }
    });
    ui.ask.addEventListener('click', () => askAI(ui.prompt.value.trim(), { autoSpeak: ui.autoSpeak.checked }));
    ui.prompt.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); ui.ask.click(); }
    });
    ui.confirm.addEventListener('click', () => commitReply(ui.responseText.textContent, { alreadySpoken: pendingWasStreamed, responseId: pendingResponseId }));
    ui.discard.addEventListener('click', () => {
        if (requestAbort) requestAbort.abort();
        ui.responseArea.style.display = 'none'; ui.responseText.textContent = ''; pendingUserMessage = null; pendingWasStreamed = false; pendingResponseId = null;
    });
    ui.voice.addEventListener('click', () => voiceDesired ? stopVoiceSession(true) : startVoiceSession('dialogue'));
    ui.hotkeySave.addEventListener('click', saveHotkeys);
    [ui.micHotkey, ui.summonHotkey, ui.screenshotHotkey].forEach((input) => {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); saveHotkeys(); }
        });
        input.addEventListener('input', () => { input.setCustomValidity(''); input.removeAttribute('aria-invalid'); });
    });
    [ui.speed, ui.pitch, ui.subtitleSize, ui.validationDelay].forEach((input) => input.addEventListener('input', updateRanges));
    [ui.sceneX, ui.sceneY, ui.sceneSize, ui.sceneIntensity, ui.subtitleX, ui.subtitleY, ui.subtitleWidth].forEach(input => {
        input.addEventListener('input', () => queueSceneUpdate(false));
        input.addEventListener('change', () => queueSceneUpdate(true));
    });
    [ui.sceneFlip, ui.sceneEffects, ui.sceneMovement, ui.subtitleEnabled].forEach(input => input.addEventListener('change', () => queueSceneUpdate(true)));
    [ui.subtitleColor, ui.subtitleFont, ui.subtitleSize].forEach(input => input.addEventListener('input', () => queueSceneUpdate(true)));
    ui.provider.addEventListener('change', () => { invalidateOpenAIChain(); populateModelOptions(true); refreshBudget(); });
    ui.model.addEventListener('input', () => {
        // Typing a model of the other family flips the provider.
        if (providerFor(ui.model.value) !== ui.provider.value) { ui.provider.value = providerFor(ui.model.value); populateModelOptions(false); }
        describeModels();
    });
    ui.model.addEventListener('change', () => { invalidateOpenAIChain(); refreshBudget(); });
    ui.fallbackToggle.addEventListener('change', () => { renderFallbackChain(); refreshBudget(); renderQuota(); });
    ui.fallbackAdd.addEventListener('click', () => {
        fallbackChain.push('');
        renderFallbackChain();
        ui.fallbackRows.lastElementChild?.querySelector('input')?.focus();
    });
    ui.fallbackPreset.addEventListener('click', () => {
        fallbackChain = [...modelCatalog.fallback_chain];
        ui.fallbackToggle.checked = true;
        renderFallbackChain();
    });
    ui.fallbackRows.addEventListener('change', () => { refreshBudget(); renderQuota(); });
    ui.keyAddForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const key = ui.keyAddValue.value.trim();
        if (key.length < 16 || /\s/.test(key)) {
            showStatus('Ключ выглядит неполным: проверь, что он скопирован целиком.', 'error');
            ui.keyAddValue.focus();
            return;
        }
        if (keysDraft.some((item) => item.key === key)) { showStatus('Этот ключ уже в списке.', 'info'); return; }
        const provider = key.startsWith('sk-') ? 'openai' : key.startsWith('AIza') ? 'gemini' : ui.keyAddProvider.value;
        keysDraft.push({ id: '', label: ui.keyAddLabel.value.trim(), provider, enabled: true, key, masked: maskKey(key) });
        ui.keyAddValue.value = '';
        ui.keyAddLabel.value = '';
        markKeysDirty();
        renderKeys();
        showStatus(`Ключ ${PROVIDER_LABELS[provider]} добавлен в список. Нажми «Сохранить ключи».`, 'info');
    });
    ui.keysSave.addEventListener('click', saveKeys);
    ui.keysRefresh.addEventListener('click', () => { loadKeys(); refreshBudget(); });
    [ui.keysTab, ui.keysShortcut].forEach((element) => element.addEventListener('click', () => { loadKeys(); refreshBudget(); }));
    ui.contextMode.addEventListener('change', invalidateOpenAIChain);
    ui.cacheChat.addEventListener('change', invalidateOpenAIChain);
    ui.budgetRefresh.addEventListener('click', refreshBudget);
    ui.language.addEventListener('change', () => { if (recognition) recognition.lang = ui.language.value; });

    async function init() {
        ui.voice.style.display = 'inline-block';
        ui.voice.textContent = 'Включить микрофон';
        populateModelOptions(false);
        setupSceneEditor();
        try {
            loadModels();
            loadKeys();
            await populateStaticData();
            await loadPersonas();
        } catch (error) {
            showStatus(`Ошибка запуска панели: ${error.message}`, 'error', 0);
        }
        updateRanges();
        refreshBudget();
        pollHotkeys();
        setInterval(pollHotkeys, 180);
        setInterval(checkIdleListening, 5000);
        setInterval(() => { if (ui.keysTab.getAttribute('aria-selected') === 'true') loadKeys(); }, 15000);
    }

    init();
});
