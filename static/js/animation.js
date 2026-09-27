let charactersData = [], animationsConfig = [];
let headImg, bodyImg, headBox = null, loadedCharacterId = null;
let currentVolume = 0, bassVolume = 0, midVolume = 0, trebleVolume = 0;
let currentAnimation = 'jelly_deformer';
let audioContext, analyserNode, outputGain, animationFrameId, currentAudioSource;
let subtitleContainer, effectsPlayer;
let sceneSettings = SceneConfig.normalize();
let subtitleSettings = { enabled: true, color: '#FFFFFF', size: 36, font: 'Impact' };
let lastEventId = 0, speechEpoch = 0, stopFadeToken = 0, currentQueueIndex = 0;
let isSummoned = false, audioQueue = [], layeredSources = [];
let streamAppendChain = Promise.resolve();
let visibility = { from: 0, to: 0, start: 0 };
const cueTimers = new Set(), soundCache = new Map();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// The two featured rigs share one neck-aware renderer; their timing differs.
const motionDirector = new CharacterMotion.Director();
let actingPose = CharacterMotion.INITIAL;

function drawActedCharacter(cx, bcy, bw, bh, hw, hh) {
    const p = actingPose;
    const footY = bcy + bh / 2;
    const radians = p.bodyAngle * Math.PI / 180;
    const neckX = cx + p.bodyX + Math.sin(radians) * bh * p.bodyScaleY;
    const neckY = footY + p.bodyY - Math.cos(radians) * bh * p.bodyScaleY + 1;
    push();
    imageMode(CENTER);
    translate(cx + p.bodyX, footY + p.bodyY);
    rotate(p.bodyAngle);
    scale(p.bodyScaleX, p.bodyScaleY);
    image(bodyImg, 0, -bh / 2, bw, bh);
    pop();

    push();
    imageMode(CENTER);
    translate(neckX + p.headX, neckY + p.headY);
    rotate(p.headAngle);
    scale(p.headScaleX, p.headScaleY);
    image(headImg, 0, -hh / 2, hw, hh);
    pop();
}

const AnimationHandlers = {
    animateJellyDeformer(cx, bcy, _hcy, bw, bh, hw, hh) {
        drawActedCharacter(cx, bcy, bw, bh, hw, hh);
    },
    animateDynamicRotation(cx, bcy, _hcy, bw, bh, hw, hh) {
        drawActedCharacter(cx, bcy, bw, bh, hw, hh);
    },
    animateOppositeRotate(cx, bcy, hcy, bw, bh, hw, hh) { const angle = map(currentVolume, 0, 140, 0, 15); const bodyPivotX = cx - bw / 2; const bodyPivotY = bcy - bh / 2; push(); translate(bodyPivotX, bodyPivotY); rotate(angle / 2); imageMode(CORNER); image(bodyImg, 0, 0, bw, bh); pop(); const headPivotX = cx - hw / 2; const headPivotY = hcy + hh / 2; push(); translate(headPivotX, headPivotY); rotate(-angle); imageMode(CORNER); image(headImg, 0, -hh, hw, hh); pop(); },
    animateExpressiveSway(cx, bcy, hcy, bw, bh, hw, hh) { const bodyAngle = map(bassVolume, 0, 160, -18, 18); const headAngle = map(midVolume, 0, 150, 15, -15); const headShake = map(trebleVolume, 0, 130, 0, 4); push(); imageMode(CENTER); translate(cx, bcy); rotate(bodyAngle); image(bodyImg, 0, 0, bw, bh); pop(); const headAnchorY = bcy - bh / 2; push(); imageMode(CENTER); translate(cx, headAnchorY); rotate(bodyAngle); translate(random(-headShake, headShake), -hh / 2 + random(-headShake / 2, headShake / 2)); rotate(headAngle); image(headImg, 0, 0, hw, hh); pop(); },
    animateClassicRotate(cx, cy, w, h) { const angle = map(currentVolume, 0, 140, 0, 20); const pivotX = cx - w / 2; const pivotY = cy + h / 2; push(); translate(pivotX, pivotY); rotate(-angle); imageMode(CORNER); image(headImg, 0, -h, w, h); pop(); },
    animateFrequencyDeform(cx, cy, w, h) { const scaleY = map(bassVolume, 0, 150, 1, 0.85); const scaleX = map(midVolume, 0, 150, 1, 1.30); const shakeIntensity = map(trebleVolume, 0, 120, 0, 12); const shakeX = random(-shakeIntensity, shakeIntensity); push(); imageMode(CENTER); translate(cx, cy); translate(shakeX, 0); scale(scaleX, scaleY); image(headImg, 0, 0, w, h); pop(); },
    animateSquash(cx, cy, w, h) { const squashFactor = map(currentVolume, 0, 140, 0, 0.35); const newW = w * (1 + squashFactor); const newH = h * (1 - squashFactor); const yOffset = (h - newH) / 2; imageMode(CENTER); image(headImg, cx, cy + yOffset, newW, newH); },
    animateBounce(cx, cy, w, h) { const bounceAmount = map(bassVolume, 0, 150, 0, -50); imageMode(CENTER); image(headImg, cx, cy + bounceAmount, w, h); }
};

// OBS is a full-resolution transparent scene. Only the avatar is transformed.
function setup() {
    const canvas = createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent('character-container');
    pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    angleMode(DEGREES);
    subtitleContainer = document.getElementById('subtitle-container');
    effectsPlayer = new SceneEffects(document.getElementById('effects-canvas'));
    effectsPlayer.resize(width, height);
    initializeScene();
}

async function initializeScene() {
    try {
        const responses = await Promise.all([fetch('/static/characters.json'), fetch('/static/animations.json'), fetch('/api/scene')]);
        if (responses.some(r => !r.ok)) throw new Error('Не удалось загрузить сцену');
        const [chars, anims, state] = await Promise.all(responses.map(r => r.json()));
        charactersData = chars;
        animationsConfig = anims;
        applySceneSettings(state);
        loadCharacter(state.characterId || chars[0]?.id);
        lastEventId = Number(state.event_id) || 0;
        setSummonedState(!!state.summoned);
        pollForAnimationJob();
    } catch (error) {
        console.error('Загрузка сцены:', error);
        setTimeout(initializeScene, 3000);
    }
}

function applySceneSettings(data) {
    if (data.scene) sceneSettings = SceneConfig.normalize(data.scene);
    if (data.subtitles) subtitleSettings = { ...subtitleSettings, ...data.subtitles };
    if (data.characterId) loadCharacter(data.characterId);
    if (data.animationStyle) currentAnimation = data.animationStyle;
    effectsPlayer.scene = sceneSettings;
    const sw = sceneSettings.subtitleWidth;
    subtitleContainer.style.width = sw + '%';
    subtitleContainer.style.left = SceneConfig.clamp(sceneSettings.subtitleX, sw / 2, 100 - sw / 2) + '%';
    subtitleContainer.style.top = sceneSettings.subtitleY + '%';
    styleSubtitle();
}
function styleSubtitle() {
    subtitleContainer.style.display = subtitleSettings.enabled === false ? 'none' : '';
    subtitleContainer.style.color = subtitleSettings.color || '#FFFFFF';
    subtitleContainer.style.fontSize = SceneConfig.clamp(Number(subtitleSettings.size) || 36, 12, 120) + 'px';
    subtitleContainer.style.fontFamily = subtitleSettings.font || 'Impact';
}
function showSubtitle(text, settings = subtitleSettings) {
    subtitleSettings = { ...subtitleSettings, ...(settings || {}) };
    styleSubtitle();
    subtitleContainer.style.opacity = '1';
    subtitleContainer.textContent = text || '';
}
function visibleAmount(now) {
    const t = reducedMotion.matches ? 1 : SceneConfig.clamp((now - visibility.start) / 620, 0, 1);
    const eased = visibility.to ? 1 - Math.pow(1 - t, 3) : t * t;
    return visibility.from + (visibility.to - visibility.from) * eased;
}
function setSummonedState(summoned) {
    if (summoned === isSummoned) return;
    const now = performance.now();
    visibility = { from: visibleAmount(now), to: summoned ? 1 : 0, start: now };
    isSummoned = summoned;
}
function draw() {
    clear();
    if (!effectsPlayer) return;
    const ratio = headImg?.width && bodyImg?.width ? headImg.height / headImg.width + bodyImg.height / bodyImg.width : 1.6;
    const a = SceneConfig.bounds(sceneSettings, width, height, ratio);
    const now = performance.now(), visible = visibleAmount(now);
    const pose = effectsPlayer.frame(now, a);
    if (!headImg?.width || !bodyImg?.width || visible <= .001) return;
    const animConfig = animationsConfig.flatMap(g => g.animations).find(item => item.id === currentAnimation);
    if (currentAnimation === 'jelly_deformer' || currentAnimation === 'dynamic_rotation') {
        actingPose = motionDirector.sample({
            preset: currentAnimation, timeMs: now,
            audio: { bass: bassVolume, mid: midVolume, treble: trebleVolume },
            emotion: effectsPlayer.currentEmotion(now),
            movementEnabled: sceneSettings.movementEnabled,
            intensity: sceneSettings.intensity,
            reduced: reducedMotion.matches,
        });
    }
    const unit = a.w / 500, bh = 500 * bodyImg.height / bodyImg.width, hh = 500 * headImg.height / headImg.width;
    const sx = SceneConfig.clamp(pose.scaleX, .65, 1.3), sy = SceneConfig.clamp(pose.scaleY, .65, 1.3);
    const margin = Math.min(width, height) * .01;
    const rig = currentAnimation === 'dynamic_rotation' || currentAnimation === 'jelly_deformer';
    const rigMargin = rig ? a.h * .12 : 0;
    const x = SceneConfig.clamp(a.x + pose.x, a.w * sx / 2 + margin + rigMargin, width - a.w * sx / 2 - margin - rigMargin);
    const y = SceneConfig.clamp(a.y + pose.y, a.h * sy + margin, height - margin);
    const hideOffset = (1 - visible) * (height - a.y + a.h + 40);
    effectsPlayer.head = headAnchor(x, y + hideOffset, pose.angle, (sceneSettings.flip ? -1 : 1) * unit * sx, unit * sy, bh, hh, rig && !reducedMotion.matches);
    push();
    drawingContext.globalAlpha = Math.min(1, visible * 3);
    translate(x, y + hideOffset);
    rotate(pose.angle + (reducedMotion.matches ? 0 : sin(millis() * .022) * .7));
    scale((sceneSettings.flip ? -1 : 1) * unit * sx, unit * sy);
    if (!reducedMotion.matches) translate(sin(millis() * .035) * 2, sin(millis() * .05) * 2);
    imageMode(CENTER);
    const handler = animConfig && AnimationHandlers[animConfig.functionName];
    if (reducedMotion.matches || typeof handler !== 'function') {
        image(bodyImg, 0, -bh / 2, 500, bh); image(headImg, 0, -bh - hh / 2 + 1, 500, hh);
    } else if (animConfig.type === 'head_only') {
        image(bodyImg, 0, -bh / 2, 500, bh); handler.call(AnimationHandlers, 0, -bh - hh / 2 + 1, 500, hh);
    } else {
        handler.call(AnimationHandlers, 0, -bh / 2, -bh - hh / 2 + 1, 500, bh, 500, hh);
    }
    pop();
}

function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyserNode = audioContext.createAnalyser(); analyserNode.fftSize = 256;
        outputGain = audioContext.createGain();
        analyserNode.connect(outputGain); outputGain.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(console.warn);
    stopFadeToken++;
    outputGain.gain.cancelScheduledValues(audioContext.currentTime);
    outputGain.gain.setValueAtTime(1, audioContext.currentTime);
}
function resetAnalysisState() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    currentVolume = bassVolume = midVolume = trebleVolume = 0;
}
function analyzeSound() {
    if (!analyserNode) return;
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const average = (from, to) => { const slice = data.slice(from, to); return slice.reduce((sum, n) => sum + n, 0) / Math.max(1, slice.length); };
    bassVolume = average(0, 26); midVolume = average(26, 77); trebleVolume = Math.min(255, average(77, 100) * 1.8);
    currentVolume = (bassVolume + midVolume + trebleVolume) / 3;
    animationFrameId = requestAnimationFrame(analyzeSound);
}
function clearCueTimers() { cueTimers.forEach(clearTimeout); cueTimers.clear(); }
function stopSpeaking(fadeMs = 0) {
    clearCueTimers();
    audioQueue = []; currentQueueIndex = 0;
    effectsPlayer.clear(fadeMs || 180);
    if (currentAudioSource) currentAudioSource.onended = null;
    const token = ++stopFadeToken;
    const finish = () => {
        if (token !== stopFadeToken) return;
        if (currentAudioSource) { try { currentAudioSource.stop(); } catch (_) {} currentAudioSource = null; }
        layeredSources.forEach(source => { source.onended = null; try { source.stop(); } catch (_) {} });
        layeredSources = []; resetAnalysisState(); showSubtitle('');
    };
    if (fadeMs && audioContext && outputGain) {
        const now = audioContext.currentTime;
        outputGain.gain.cancelScheduledValues(now);
        outputGain.gain.setValueAtTime(outputGain.gain.value, now);
        outputGain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
        subtitleContainer.style.opacity = '0';
        setTimeout(finish, fadeMs + 20);
    } else finish();
}
async function getSoundBuffer(effect) {
    ensureAudioContext();
    if (!soundCache.has(effect.id)) {
        soundCache.set(effect.id, fetch('/' + effect.audio.replace(/^\//, '')).then(r => {
            if (!r.ok) throw new Error('Звуковой файл недоступен: ' + effect.id);
            return r.arrayBuffer();
        }).then(buffer => audioContext.decodeAudioData(buffer)).catch(error => { soundCache.delete(effect.id); throw error; }));
    }
    return soundCache.get(effect.id);
}
async function playLayeredEffect(effect, epoch = speechEpoch, standalone = false) {
    if (!effect?.id || !effect.audio) return;
    try {
        const buffer = await getSoundBuffer(effect);
        if (epoch !== speechEpoch || !isSummoned) return;
        const source = audioContext.createBufferSource(); source.buffer = buffer;
        source.connect(standalone ? analyserNode : outputGain);
        layeredSources.push(source);
        effectsPlayer.play(effect.id, 'sfx', buffer.duration * 1000);
        if (standalone) { showSubtitle(effect.subtitle); if (!animationFrameId) analyzeSound(); }
        source.onended = () => {
            layeredSources = layeredSources.filter(s => s !== source);
            if (standalone && epoch === speechEpoch) { showSubtitle(''); if (!currentAudioSource) resetAnalysisState(); }
        };
        source.start();
    } catch (error) {
        if (epoch === speechEpoch && isSummoned) effectsPlayer.play(effect.id, 'sfx');
        console.error('Звуковой эффект:', error);
    }
}
function runCue(cue, epoch) {
    if (epoch !== speechEpoch || !isSummoned) return;
    if (cue.emotion) effectsPlayer.play(cue.emotion);
    if (cue.effect) playLayeredEffect(cue.effect, epoch);
}
function playNextInQueue() {
    clearCueTimers();
    if (currentQueueIndex >= audioQueue.length) {
        currentAudioSource = null; audioQueue = []; currentQueueIndex = 0;
        resetAnalysisState(); showSubtitle('');
        // Let inline SFX and visual tails finish instead of cutting them off.
        return;
    }
    const item = audioQueue[currentQueueIndex], epoch = speechEpoch;
    if (!item.buffer) {
        item.cues.forEach(cue => runCue(cue, epoch));
        currentQueueIndex++; playNextInQueue(); return;
    }
    const source = audioContext.createBufferSource(); source.buffer = item.buffer; source.connect(analyserNode);
    currentAudioSource = source;
    showSubtitle(item.text, item.subtitles);
    item.cues.forEach(cue => {
        const fraction = SceneConfig.clamp((cue.charIndex - item.start) / Math.max(1, item.end - item.start), 0, .95);
        const delay = fraction * item.buffer.duration * 1000;
        if (delay < 30) runCue(cue, epoch);
        else { const timer = setTimeout(() => { cueTimers.delete(timer); runCue(cue, epoch); }, delay); cueTimers.add(timer); }
    });
    source.onended = () => {
        if (currentAudioSource === source && epoch === speechEpoch) { currentAudioSource = null; currentQueueIndex++; playNextInQueue(); }
    };
    source.start();
    if (!animationFrameId) analyzeSound();
}

async function appendSpeech(data, epoch) {
    if (epoch !== speechEpoch || !isSummoned) return;
    const text = String(data.text || '');
    const cues = [...(data.inlineEffects || []), ...(data.inlineEmotions || [])].sort((a, b) => (a.charIndex || 0) - (b.charIndex || 0));
    const sentences = [...text.matchAll(/[^.!?]+[.!?]*\s*|[^.!?]+$/g)];
    if (!sentences.length) {
        audioQueue.push({ cues, buffer: null });
        if (!currentAudioSource) playNextInQueue();
        return;
    }
    ensureAudioContext();
    const generated = await Promise.all(sentences.map(async match => {
        const sentence = match[0].trim();
        if (!sentence) return null;
        try {
            const response = await fetch('/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: sentence, lang: data.lang, speed: data.speed, pitch: data.pitch }) });
            if (!response.ok) throw new Error('Ошибка синтеза');
            const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
            return { text: sentence, buffer, start: match.index, end: match.index + match[0].length, cues: [], subtitles: data.subtitles || subtitleSettings };
        } catch (error) { console.warn('Пропущена фраза:', error); return null; }
    }));
    if (epoch !== speechEpoch || !isSummoned) return;
    const items = generated.filter(Boolean);
    if (!items.length) {
        audioQueue.push({ buffer: null, cues });
        if (!currentAudioSource) playNextInQueue();
        return;
    }
    cues.forEach(cue => {
        const pos = Number(cue.charIndex) || 0;
        const target = items.find(item => pos >= item.start && pos < item.end) || items.find(item => item.start >= pos) || items[items.length - 1];
        target.cues.push({ ...cue, charIndex: pos });
    });
    audioQueue.push(...items);
    if (!currentAudioSource) playNextInQueue();
}
function handleAnimationEvent(data) {
    if (!data) return;
    applySceneSettings(data);
    const job = data.job_type;
    if (job === 'scene') return;
    if (job === 'summon') { setSummonedState(true); return; }
    if (job === 'dismiss' || job === 'stop') {
        speechEpoch++; streamAppendChain = Promise.resolve();
        if (job === 'dismiss') setSummonedState(false);
        stopSpeaking(Number(data.fade_ms) || (job === 'dismiss' ? 520 : 120)); return;
    }
    setSummonedState(true);
    if (job === 'emotion') { effectsPlayer.play(data.emotion); return; }
    if (job === 'effect_preview') { effectsPlayer.play(data.effectId, 'sfx'); return; }
    if (job === 'sfx') {
        speechEpoch++; streamAppendChain = Promise.resolve(); stopSpeaking();
        playLayeredEffect(data.sfx_data, speechEpoch, true); return;
    }
    if (job !== 'tts_append') { speechEpoch++; streamAppendChain = Promise.resolve(); stopSpeaking(); }
    const epoch = speechEpoch;
    streamAppendChain = streamAppendChain.then(() => appendSpeech(data, epoch)).catch(error => console.error('Озвучка:', error));
}
async function pollForAnimationJob() {
    try {
        const response = await fetch('/animation-events?after=' + lastEventId);
        if (response.ok) {
            const payload = await response.json();
            if (Number(payload.latest_id) < lastEventId) { initializeScene(); return; }
            for (const event of payload.events || []) { lastEventId = Math.max(lastEventId, Number(event.id) || 0); handleAnimationEvent(event.data); }
            lastEventId = Math.max(lastEventId, Number(payload.latest_id) || 0);
        }
    } catch (error) { console.warn('Связь со студией:', error); }
    setTimeout(pollForAnimationJob, 180);
}
function loadCharacter(id) {
    if (loadedCharacterId === id) return;
    const character = charactersData.find(item => item.id === id) || charactersData[0];
    if (!character) return;
    headBox = null;
    headImg = loadImage('/' + character.images.head.replace(/^\//, ''), img => { if (img === headImg) headBox = opaqueBounds(img); });
    bodyImg = loadImage('/' + character.images.body.replace(/^\//, ''));
    loadedCharacterId = id;
}
// Head PNGs carry transparent margins; emotion marks need the visible part only.
function opaqueBounds(img) {
    try {
        img.loadPixels();
        const w = img.width, h = img.height, px = img.pixels;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y += 2) {
            for (let x = 0; x < w; x += 2) {
                if (px[(y * w + x) * 4 + 3] < 40) continue;
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        return x1 < 0 ? null : { x0: x0 / w, y0: y0 / h, x1: Math.min(1, (x1 + 2) / w), y1: Math.min(1, (y1 + 2) / h) };
    } catch (error) {
        console.warn('Границы головы:', error);
        return null;
    }
}
// Mirrors the transforms in draw() and drawActedCharacter() for the visible head box.
function headAnchor(x, y, angle, sx, sy, bh, hh, rig) {
    const box = headBox || { x0: .15, y0: 0, x1: .85, y1: 1 };
    const u = (box.x0 + box.x1) / 2, v = (box.y0 + box.y1) / 2;
    let lx, ly;
    if (rig) {
        const p = actingPose, body = p.bodyAngle * Math.PI / 180, turn = p.headAngle * Math.PI / 180;
        const hx = (u - .5) * 500 * p.headScaleX, hy = (v - 1) * hh * p.headScaleY;
        lx = p.bodyX + Math.sin(body) * bh * p.bodyScaleY + p.headX + hx * Math.cos(turn) - hy * Math.sin(turn);
        ly = p.bodyY - Math.cos(body) * bh * p.bodyScaleY + 1 + p.headY + hx * Math.sin(turn) + hy * Math.cos(turn);
    } else {
        lx = (u - .5) * 500;
        ly = -bh + 1 - hh + v * hh;
    }
    const r = angle * Math.PI / 180, px = lx * sx, py = ly * sy;
    return {
        x: x + px * Math.cos(r) - py * Math.sin(r), y: y + px * Math.sin(r) + py * Math.cos(r),
        w: 500 * (box.x1 - box.x0) * Math.abs(sx), h: hh * (box.y1 - box.y0) * sy,
    };
}
function windowResized() {
    resizeCanvas(window.innerWidth, window.innerHeight);
    effectsPlayer?.resize(width, height);
}
