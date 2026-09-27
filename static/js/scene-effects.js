/* Full-scene effects layer, drawn independently of the avatar size. */
const EFFECT_INK = '#202031';
// Social credit particles fade out after the sound ends.
const CREDIT_FADE_MS = 1100;

class SceneEffects {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.scene = SceneConfig.normalize();
        this.active = [];
        this.pipes = [];
        // Screen-space box of the avatar's head; the renderer refreshes it every frame.
        this.head = null;
        this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        fetch('/list-effect-images/pipes').then(r => r.json()).then(data => {
            this.pipes = (data.images || []).slice(0, 12).map(path => { const img = new Image(); img.src = '/' + path.replace(/^\//, ''); return img; });
        }).catch(() => {});
    }
    resize(w, h) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.w = w; this.h = h;
    }
    play(id, type = 'emotion', duration = null) {
        const definition = type === 'emotion' ? SceneConfig.findEmotion(id) : SceneConfig.soundEffects[id];
        if (!definition) return;
        const now = performance.now();
        // New emotion replaces the old one; sound cues may overlap it.
        this.active = this.active.filter(e => !(e.type === type && (type === 'emotion' || e.id === id)));
        const effect = { id: type === 'emotion' ? definition.id : id, type, color: definition.color, start: now, duration: Math.max(500, Number(duration) || definition.duration), seed: Math.random() * 1000 };
        if (effect.id === 'social_credit') effect.credit = this.creditState(now);
        this.active.push(effect);
        this.active = this.active.slice(-4);
    }
    lifetime(e) { return e.duration + (e.credit ? CREDIT_FADE_MS : 0); }
    clear(fade = 250) {
        const now = performance.now();
        this.active.forEach(e => { e.end = now + fade; });
        if (!fade) this.active = [];
    }
    currentEmotion(now) {
        for (let index = this.active.length - 1; index >= 0; index--) {
            const cue = this.active[index];
            const remaining = Math.min(cue.start + cue.duration, cue.end || Infinity) - now;
            if (cue.type !== 'emotion' || remaining <= 0) continue;
            const phase = Math.max(0, Math.min(1, (now - cue.start) / cue.duration));
            const weight = Math.max(0, Math.min(1, phase * 12, (1 - phase) * 7, cue.end ? remaining / 250 : 1));
            return { id: cue.id, phase, weight };
        }
        return null;
    }
    frame(now, avatar) {
        const c = this.ctx;
        c.clearRect(0, 0, this.w, this.h);
        this.active = this.active.filter(e => now < Math.min(e.start + this.lifetime(e), e.end || Infinity));
        const pose = { x: 0, y: 0, angle: 0, scaleX: 1, scaleY: 1 };
        const head = this.head || this.guessHead(avatar);
        for (const e of this.active) {
            const t = Math.max(0, (now - e.start) / e.duration);
            const cut = e.end ? (e.end - now) / 250 : 1;
            const envelope = Math.max(0, Math.min(1, t * 12, (1 - t) * 7, cut));
            if (this.scene.effectsEnabled && this.scene.intensity > 0) {
                c.save();
                c.globalAlpha = (e.credit ? Math.min(1, cut) : envelope) * Math.min(1, this.scene.intensity);
                c.lineCap = c.lineJoin = 'round';
                if (e.credit) this.drawSocialCredit(e, now);
                else if (e.type === 'emotion') this.drawEmotion(e, this.reduced.matches ? .45 : t, head);
                else this.drawEffect(e, this.reduced.matches ? .45 : t, avatar);
                c.restore();
            }
            if (this.scene.movementEnabled && !this.reduced.matches) this.addMotion(pose, e, Math.min(1, t), envelope, avatar);
        }
        return pose;
    }
    guessHead(a) { return { x: a.x, y: a.y - a.h * .78, w: a.w * .62, h: a.h * .34 }; }
    addMotion(p, e, t, envelope, a) {
        const power = envelope * this.scene.intensity;
        const direction = a.x > this.w / 2 ? -1 : 1;
        const hop = Math.abs(Math.sin(t * Math.PI * 3));
        const wave = Math.sin(t * Math.PI * 4);
        let x = 0, y = 0, angle = 0, sx = 0, sy = 0;
        switch (e.id) {
            case 'excited': y = -hop * a.h * .13; angle = wave * 5; break;
            case 'bouncy': x = direction * this.w * .055 * Math.sin(t * Math.PI); y = -hop * a.h * .17; sx = -hop * .045; sy = hop * .045; break;
            case 'tense': x = direction * a.w * .12 * Math.sin(t * Math.PI); angle = Math.sin(t * 40) * 3; sy = .035; break;
            case 'wobbly': x = wave * a.w * .08; angle = wave * 8; break;
            case 'sad': y = a.h * .035; sy = -.06; angle = direction * 6; break;
            case 'surprised': y = -a.h * .12 * Math.sin(Math.min(1, t * 2) * Math.PI); sx = -.05; sy = .06; angle = -direction * 6; break;
            case 'love': y = -a.h * .05 * Math.sin(t * Math.PI); angle = Math.sin(t * 7) * 4; break;
            case 'thinking': x = direction * this.w * .025 * Math.sin(t * Math.PI); angle = -direction * 7; break;
            case 'bad_to_the_bone': y = -hop * a.h * .025; angle = Math.sin(t * 23) * 4; break;
            case 'social_credit': x = direction * this.w * .025 * Math.sin(t * Math.PI); sy = -.05; angle = -direction * 7; break;
            case 'discord_call': angle = Math.sin(t * 50) * 3; x = direction * this.w * .035 * Math.sin(t * Math.PI); break;
            case 'falling_pipe': sy = -.2 * Math.sin(t * Math.PI); sx = .1 * Math.sin(t * Math.PI); x = direction * a.w * .4 * Math.sin(t * Math.PI); angle = direction * 8; break;
            case 'to_be_continued': angle = -direction * 12; x = direction * this.w * .06 * Math.sin(t * Math.PI); break;
            case 'vine_boom': { const kick = Math.sin(t * 20) * Math.exp(-t * 5); sx = sy = kick * .17; x = direction * kick * a.w * .25; break; }
            case 'answer_42': x = direction * this.w * .07 * Math.sin(t * Math.PI); y = -a.h * .15 * Math.sin(t * Math.PI); angle = Math.sin(t * Math.PI * 2) * 9; break;
        }
        p.x += x * power; p.y += y * power; p.angle += angle * power;
        p.scaleX += sx * power; p.scaleY += sy * power;
    }
    random(seed, i) { const n = Math.sin(seed + i * 127.1) * 43758.5453; return n - Math.floor(n); }
    // Smooth 1D value noise in 0..1, standing in for p5's noise().
    noise(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return this.random(17.3, i) * (1 - u) + this.random(17.3, i + 1) * u; }
    // Springy 0→1 scale with a small overshoot; starts at `at` and lasts `span` of the phase.
    pop(t, at = 0, span = .12) {
        const x = Math.max(0, Math.min(1, (t - at) / span)), c1 = 1.70158;
        return x <= 0 ? 0 : 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    // Stroke first, then fill: overlapping sub-paths get one clean outer contour.
    outlined(fill, width) {
        const c = this.ctx;
        c.strokeStyle = EFFECT_INK; c.lineWidth = width * 2; c.stroke();
        c.fillStyle = fill; c.fill();
    }
    inkLine(x1, y1, x2, y2, color, width) {
        const c = this.ctx;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
        c.strokeStyle = EFFECT_INK; c.lineWidth = width + 4; c.stroke();
        c.strokeStyle = color; c.lineWidth = width; c.stroke();
    }
    text(value, x, y, size, color, angle = 0) {
        const c = this.ctx;
        c.save(); c.translate(x, y); c.rotate(angle);
        c.font = `900 ${size}px "Segoe UI", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = Math.max(2, size * .065); c.strokeStyle = EFFECT_INK; c.fillStyle = color;
        c.strokeText(value, 0, 0); c.fillText(value, 0, 0); c.restore();
    }
    star(x, y, radius, color, angle = 0) {
        const c = this.ctx; c.save(); c.translate(x, y); c.rotate(angle); c.beginPath();
        for (let i = 0; i < 10; i++) { const r = radius * (i % 2 ? .42 : 1), a = i * Math.PI / 5 - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        c.closePath(); c.fillStyle = color; c.fill(); c.strokeStyle = '#352b49'; c.lineWidth = 2; c.stroke(); c.restore();
    }
    sparkle(x, y, r, color, angle, k) {
        if (r <= .5) return;
        const c = this.ctx; c.save(); c.translate(x, y); c.rotate(angle); c.beginPath(); c.moveTo(0, -r);
        for (let i = 1; i <= 4; i++) {
            const a = i * Math.PI / 2 - Math.PI / 2, m = a - Math.PI / 4;
            c.quadraticCurveTo(Math.cos(m) * r * .16, Math.sin(m) * r * .16, Math.cos(a) * r, Math.sin(a) * r);
        }
        c.closePath(); this.outlined(color, Math.max(1, 1.3 * k)); c.restore();
    }
    heart(x, y, size, color, angle = 0) {
        const c = this.ctx; c.save(); c.translate(x, y); c.rotate(angle); c.scale(size / 40, size / 40);
        c.beginPath(); c.moveTo(0, 14); c.bezierCurveTo(-40, -6, -17, -32, 0, -14); c.bezierCurveTo(17, -32, 40, -6, 0, 14);
        c.fillStyle = color; c.fill(); c.lineWidth = 2; c.strokeStyle = '#963857'; c.stroke(); c.restore();
    }
    note(x, y, size, color, angle, double, k) {
        if (size <= 1) return;
        const c = this.ctx; c.save(); c.translate(x, y); c.rotate(angle); c.scale(size / 40, size / 40);
        c.beginPath();
        if (double) {
            c.ellipse(-11, 15, 8, 6, -.35, 0, Math.PI * 2);
            c.moveTo(13 + 8 * Math.cos(-.35), 9 + 8 * Math.sin(-.35)); c.ellipse(13, 9, 8, 6, -.35, 0, Math.PI * 2);
            c.rect(-6, -15, 4, 30); c.rect(18, -21, 4, 30);
            c.moveTo(-6, -15); c.lineTo(22, -21); c.lineTo(22, -13); c.lineTo(-6, -7); c.closePath();
        } else {
            c.ellipse(0, 14, 9, 6.5, -.35, 0, Math.PI * 2);
            c.rect(5, -18, 4, 32);
            c.moveTo(9, -18); c.quadraticCurveTo(20, -12, 17, 0); c.quadraticCurveTo(15, -8, 9, -9); c.closePath();
        }
        this.outlined(color, 2.2 * 40 / size * Math.max(1, 1.2 * k)); c.restore();
    }
    vein(x, y, size, k) {
        if (size <= 1) return;
        const c = this.ctx; c.save(); c.translate(x, y); c.rotate(-.2); c.scale(size / 30, size / 30);
        for (const [color, width] of [[EFFECT_INK, 11], ['#ff4d5e', 6]]) {
            c.strokeStyle = color; c.lineWidth = width;
            for (let i = 0; i < 4; i++) {
                c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(4, -9); c.quadraticCurveTo(4, -26, 22, -26); c.stroke();
            }
        }
        c.restore();
    }
    puff(x, y, r, color, k) {
        const c = this.ctx; c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2); c.moveTo(x - r * .1, y + r * .3);
        c.arc(x - r * .8, y + r * .3, r * .7, 0, Math.PI * 2); c.moveTo(x + r * 1.5, y + r * .3);
        c.arc(x + r * .8, y + r * .3, r * .7, 0, Math.PI * 2);
        this.outlined(color, Math.max(1, 1.2 * k));
    }
    drop(x, y, s, k) {
        if (s <= 1) return;
        const c = this.ctx; c.save(); c.translate(x, y); c.beginPath();
        c.moveTo(0, -s); c.bezierCurveTo(s * .2, -s * .45, s * .62, -s * .05, s * .62, s * .28);
        c.arc(0, s * .28, s * .62, 0, Math.PI); c.bezierCurveTo(-s * .62, -s * .05, -s * .2, -s * .45, 0, -s);
        this.outlined('#9fd6ff', Math.max(1, 1.3 * k));
        c.beginPath(); c.ellipse(-s * .22, s * .18, s * .1, s * .2, .4, 0, Math.PI * 2); c.fillStyle = '#ffffffd9'; c.fill();
        c.restore();
    }
    spiral(x, y, r, color, angle, k) {
        if (r <= 1) return;
        const c = this.ctx; c.save(); c.translate(x, y); c.rotate(angle); c.beginPath();
        for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 4.4, d = r * i / 60; c.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
        c.strokeStyle = EFFECT_INK; c.lineWidth = 6 * k; c.stroke();
        c.strokeStyle = color; c.lineWidth = 3 * k; c.stroke(); c.restore();
    }
    raincloud(x, y, w, k) {
        const c = this.ctx; c.beginPath();
        c.roundRect(x - w * .42, y - w * .05, w * .84, w * .2, w * .1);
        for (const [dx, dy, r] of [[-.25, 0, .19], [.02, -.1, .26], [.27, 0, .18]]) {
            c.moveTo(x + (dx + r) * w, y + dy * w); c.arc(x + dx * w, y + dy * w, r * w, 0, Math.PI * 2);
        }
        this.outlined('#8fa3bd', Math.max(1, 1.4 * k));
    }
    thoughtCloud(x, y, rx, ry, k) {
        if (rx <= 1) return;
        const c = this.ctx; c.beginPath();
        c.ellipse(x, y, rx * .82, ry * .78, 0, 0, Math.PI * 2);
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2, cx = x + Math.cos(a) * rx * .72, cy = y + Math.sin(a) * ry * .62, r = ry * (.42 + (i % 2) * .08);
            c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, Math.PI * 2);
        }
        this.outlined('#fbfaff', Math.max(1, 1.4 * k));
    }
    bubbleDot(x, y, r, k) {
        if (r <= .5) return;
        const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); this.outlined('#fbfaff', Math.max(1, 1.2 * k));
    }
    ray(x1, y1, x2, y2, color, size) {
        const c = this.ctx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = size; c.stroke();
    }
    ring(x, y, r, color, size = 3) {
        const c = this.ctx; c.beginPath(); c.arc(x, y, Math.max(1, r), 0, Math.PI * 2); c.strokeStyle = color; c.lineWidth = size; c.stroke();
    }
    pipe(x, y, size, rotation, index) {
        const c = this.ctx; c.save(); c.translate(x, y); c.rotate(rotation);
        const img = this.pipes[index % this.pipes.length];
        if (img?.complete && img.naturalWidth) {
            const h = size * img.naturalHeight / img.naturalWidth;
            c.drawImage(img, -size / 2, -h / 2, size, h);
        } else {
            // Brushed-metal pipe with collars and a dark hollow opening.
            const shade = c.createLinearGradient(-size * .1, 0, size * .1, 0);
            shade.addColorStop(0, '#69798a'); shade.addColorStop(.35, '#eef5fa'); shade.addColorStop(.65, '#b2c0cf'); shade.addColorStop(1, '#526374');
            c.fillStyle = shade; c.strokeStyle = '#263444'; c.lineWidth = 2;
            c.fillRect(-size * .1, -size / 2, size * .2, size); c.strokeRect(-size * .1, -size / 2, size * .2, size);
            for (const dy of [-.46, .39]) { c.fillRect(-size * .13, size * dy, size * .26, size * .07); c.strokeRect(-size * .13, size * dy, size * .26, size * .07); }
            c.beginPath(); c.ellipse(0, -size / 2, size * .1, size * .037, 0, 0, Math.PI * 2); c.fillStyle = '#263444'; c.fill();
        }
        c.restore();
    }
    skull(x, y, size) {
        const c = this.ctx; c.save(); c.translate(x, y); c.scale(size / 100, size / 100);
        c.strokeStyle = '#f3e7c9'; c.lineWidth = 13;
        for (const flip of [-1, 1]) { this.ray(-58, flip * 44, 58, -flip * 44, '#f3e7c9', 13); }
        c.beginPath(); c.ellipse(0, -10, 40, 36, 0, 0, Math.PI * 2); c.rect(-24, 5, 48, 37); c.fillStyle = '#fff4d7'; c.fill(); c.strokeStyle = '#292735'; c.lineWidth = 4; c.stroke();
        c.fillStyle = '#242331'; c.fillRect(-34, -16, 29, 17); c.fillRect(5, -16, 29, 17); this.ray(-8, -11, 8, -11, '#242331', 5);
        c.beginPath(); c.moveTo(0, 5); c.lineTo(-6, 18); c.lineTo(6, 18); c.fill();
        for (const dx of [-12, 0, 12]) this.ray(dx, 28, dx, 39, '#292735', 3);
        c.restore();
    }
    // Anime-style marks around the head: they follow the avatar instead of covering the scene.
    drawEmotion(e, t, head) {
        const c = this.ctx, r = i => this.random(e.seed, i);
        const k = Math.max(.35, Math.min(2.5, (head.w + head.h) / 2 / 160));
        const side = head.x > this.w / 2 ? -1 : 1;
        const top = head.y - head.h / 2, R = Math.max(head.w, head.h) / 2;
        switch (e.id) {
            case 'neutral': {
                c.save(); c.globalAlpha *= (1 - t) * .7;
                this.ring(head.x, head.y, R * (1.02 + (1 - Math.pow(1 - t, 3)) * .4), e.color, 3 * k);
                c.restore(); break;
            }
            case 'excited': {
                if (t < .3) {
                    c.save(); c.globalAlpha *= 1 - t / .3;
                    for (let i = 0; i < 12; i++) {
                        const a = i / 12 * Math.PI * 2, from = R * (1.05 + t * .9), to = from + 26 * k;
                        this.ray(head.x + Math.cos(a) * from, head.y + Math.sin(a) * from, head.x + Math.cos(a) * to, head.y + Math.sin(a) * to, '#fff1b8', 4 * k);
                    }
                    c.restore();
                }
                for (let i = 0; i < 9; i++) {
                    const a = -Math.PI / 2 + (i - 4) * .36 + (r(i) - .5) * .2;
                    const d = R * (1.1 + r(i + 1) * .3) + Math.sin(t * 9 + i) * 4 * k;
                    const s = this.pop(t, i * .045) * (.8 + .2 * Math.sin(t * 22 + i * 2));
                    this.sparkle(head.x + Math.cos(a) * d, head.y + Math.sin(a) * d * .92, (10 + r(i + 2) * 12) * k * s,
                        ['#ffd36d', '#fff3c4', '#ffb86b', '#ffe79a'][i % 4], t * 1.5 + i, k);
                }
                break;
            }
            case 'bouncy':
                for (let i = 0; i < 8; i++) {
                    const p = (t - i * .1) / .42;
                    if (p <= 0 || p >= 1) continue;
                    const dir = i % 2 ? side : -side;
                    const x = head.x + dir * (head.w * .5 + p * 40 * k) + Math.sin(p * Math.PI * 2 + i) * 10 * k;
                    c.save(); c.globalAlpha *= Math.min(1, (1 - p) * 4);
                    this.note(x, top + head.h * .25 - p * head.h * .95, 38 * k * this.pop(p, 0, .25),
                        ['#c8a5ff', '#ff9ec7', '#8fe3cf'][i % 3], Math.sin(p * 6 + i) * .3, i % 3 === 1, k);
                    c.restore();
                }
                break;
            case 'tense': {
                const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 7)), 6);
                const glow = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * .35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * .75);
                glow.addColorStop(0, 'rgba(255, 70, 90, 0)'); glow.addColorStop(1, `rgba(255, 70, 90, ${.1 + beat * .06})`);
                c.fillStyle = glow; c.fillRect(0, 0, this.w, this.h);
                for (let i = 0; i < 4; i++) {
                    const p = (t * 2.2 + i / 4) % 1, dir = i % 2 ? 1 : -1;
                    c.save(); c.globalAlpha *= Math.sin(p * Math.PI) * .9;
                    this.puff(head.x + dir * head.w * (.16 + p * .22), top - p * 45 * k, (7 + p * 9) * k, '#f4f2fa', k);
                    c.restore();
                }
                this.vein(head.x + side * head.w * .3, top + head.h * .12, 24 * k * this.pop(t, 0, .1) * (1 + beat * .18), k);
                break;
            }
            case 'wobbly': {
                const slide = (1 - Math.cos(Math.min(1, t * 1.3) * Math.PI)) / 2;
                this.spiral(head.x - side * head.w * .18, top - 16 * k, 17 * k * this.pop(t, .08), e.color, t * 9, k);
                this.drop(head.x + side * head.w * .47, head.y - head.h * .14 + slide * head.h * .12, 22 * k * this.pop(t, 0, .14), k);
                break;
            }
            case 'sad': {
                const w = Math.max(head.w * .85, 90 * k) * this.pop(t, 0, .16);
                const x = head.x, y = Math.max(w * .3, top - 34 * k + Math.sin(t * 5) * 3 * k);
                const floor = top + head.h * .22;
                c.save(); c.strokeStyle = '#a9d4ff'; c.lineWidth = 3 * k;
                const alpha = c.globalAlpha;
                for (let i = 0; i < 12 && w > 1; i++) {
                    const p = (t * 2.6 + r(i)) % 1, dx = x + (r(i + 1) - .5) * w * .72;
                    const dy = y + w * .15 + p * (floor - y - w * .15);
                    c.globalAlpha = alpha * (1 - p * .6);
                    c.beginPath(); c.moveTo(dx, dy); c.lineTo(dx - 2 * k, dy + 11 * k); c.stroke();
                }
                c.restore();
                if (w > 1) this.raincloud(x, y, w, k);
                break;
            }
            case 'surprised': {
                const s = this.pop(t, 0, .1);
                if (t < .28) {
                    c.save(); c.globalAlpha *= 1 - t / .28;
                    this.ring(head.x, head.y, R * (1 + t / .28 * .8), '#fff4c2', 5 * k); c.restore();
                }
                for (const dir of [-1, 1]) {
                    for (let i = -1; i <= 1; i++) {
                        const a = -Math.PI / 2 + dir * (.62 + i * .3), from = R * 1.04, to = from + 20 * k * s;
                        this.inkLine(head.x + Math.cos(a) * from, head.y + Math.sin(a) * from, head.x + Math.cos(a) * to, head.y + Math.sin(a) * to, e.color, 4 * k);
                    }
                }
                this.text('!', head.x + side * head.w * .64, top + head.h * .06, 70 * k * s * (1 + .05 * Math.sin(t * 16)), e.color, side * .18);
                break;
            }
            case 'love': {
                for (let i = 0; i < 14; i++) {
                    const p = (t - r(i) * .62) / .38;
                    if (p <= 0 || p >= 1) continue;
                    const x = head.x + (r(i + 1) - .5) * head.w * 1.9 + Math.sin(p * 5 + i) * 12 * k;
                    c.save(); c.globalAlpha *= Math.min(1, (1 - p) * 3);
                    this.heart(x, head.y + head.h * .35 - p * head.h * 1.5, (12 + r(i + 2) * 12) * k * this.pop(p, 0, .2), i % 3 ? '#ff9abd' : '#ffd4df', Math.sin(p * 4 + i) * .25);
                    c.restore();
                }
                const beat = 1 + Math.pow(Math.max(0, Math.sin(t * Math.PI * 6)), 8) * .18;
                this.heart(head.x + side * head.w * .6, top + head.h * .14, 20 * k * this.pop(t, 0, .12) * beat, '#ff6f9f', side * .2);
                break;
            }
            case 'thinking': {
                const bx = SceneConfig.clamp(head.x + side * head.w * .85, 60 * k, this.w - 60 * k);
                const by = Math.max(45 * k, top - head.h * .28);
                const sx = head.x + side * head.w * .42, sy = top + head.h * .12;
                [.3, .55, .78].forEach((f, i) => this.bubbleDot(sx + (bx - sx) * f, sy + (by - sy) * f, (4 + i * 3) * k * this.pop(t, i * .07, .1), k));
                const s = this.pop(t, .22, .14);
                this.thoughtCloud(bx, by, 50 * k * s, 32 * k * s, k);
                if (s > .3) {
                    c.fillStyle = EFFECT_INK;
                    for (let i = 0; i < 3; i++) {
                        const jump = Math.max(0, Math.sin(t * 14 - i * .9)) * 5 * k;
                        c.beginPath(); c.arc(bx + (i - 1) * 14 * k * s, by - jump, 3.8 * k * s, 0, Math.PI * 2); c.fill();
                    }
                }
                break;
            }
        }
    }
    creditState(now) {
        const numbers = Array.from({ length: 29 + Math.floor(Math.random() * 11) }, () => ({
            x: Math.random() * this.w, y: Math.random() * this.h, size: 20 + Math.random() * 35,
            rate: 300 + Math.random() * 1200, nx: Math.random() * 1000, ny: Math.random() * 1000, value: 0,
        }));
        return { numbers, arrows: [], nextArrow: now, last: now, alpha: 255 };
    }
    // Counters sink towards −9999 and redden while arrows rain down.
    drawSocialCredit(e, now) {
        const c = this.ctx, s = e.credit;
        const k = Math.max(.5, this.h / 1080);
        // Speeds are tuned per 60 fps frame; scale them by the real elapsed time.
        const frames = Math.min(6, (now - s.last) / 1000 * 60);
        s.last = now;
        const elapsed = (now - e.start) / 1000;
        const fading = now >= e.start + e.duration;
        if (fading) s.alpha = Math.max(0, s.alpha - 4 * frames);
        else if (now >= s.nextArrow && !this.reduced.matches) {
            const speed = 5 + Math.random() * 7;
            s.arrows.push({ x: Math.random() * this.w, y: -20 * k, size: 15 + Math.random() * 10, speed });
            const delay = 250 - (speed - 5) / 7 * 200;
            s.nextArrow = now + delay * (.8 + Math.random() * .4);
        }
        const alpha = s.alpha / 255;
        s.arrows = s.arrows.filter(p => {
            p.y += p.speed * frames * k;
            if (p.y > this.h + 20 * k) return false;
            const speedFactor = 1 + (p.speed - 5) / 7 * 1.5;
            const amount = Math.min(Math.max(0, p.y / this.h) * speedFactor, 1);
            const grey = 200 * (1 - amount);
            c.fillStyle = `rgba(${200 + 20 * amount}, ${grey}, ${grey}, ${alpha * .8})`;
            const head = p.size * k, shaftWidth = head * .5, shaftHeight = head * .8;
            c.fillRect(p.x - shaftWidth / 2, p.y - head - shaftHeight, shaftWidth, shaftHeight);
            c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - head / 1.5, p.y - head); c.lineTo(p.x + head / 1.5, p.y - head); c.closePath(); c.fill();
            return true;
        });
        c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const p of s.numbers) {
            if (!fading) {
                p.value = -Math.floor(elapsed * p.rate);
                if (!this.reduced.matches) {
                    p.x += (this.noise(p.nx + elapsed * .3) * 2 - 1) * frames * k;
                    p.y += (this.noise(p.ny + elapsed * .3) * 2 - 1) * frames * k;
                }
            }
            const red = Math.min(1, -p.value / 9999), rest = 255 * (1 - red);
            c.fillStyle = `rgba(255, ${rest}, ${rest}, ${alpha})`;
            c.font = `${p.size * k}px sans-serif`;
            c.fillText(String(p.value), p.x, p.y);
        }
    }
    drawEffect(e, t, a) {
        const c = this.ctx, w = this.w, h = this.h, unit = Math.min(w, h) / 720;
        const cx = a.x, cy = a.y - a.h * .72, seed = e.seed, color = e.color;
        const r = i => this.random(seed, i);
        switch (e.id) {
            case 'bad_to_the_bone':
                this.skull(w * .38, h * .36, 135 * unit * (1 + .03 * Math.sin(t * 30)));
                for (let i = 0; i < 10; i++) this.text('♪', w * (.1 + r(i) * .7), h * ((r(i + 1) - t * .25 + 1) % 1), 30 * unit, color, -.15);
                this.text('BAD TO THE BONE', w * .38, h * .56, Math.min(w * .045, 40 * unit), color, -.06); break;
            case 'discord_call': {
                const x = w * .5, y = h * .28, pulse = t * 3 % 1;
                for (let i = 0; i < 3; i++) { c.save(); c.globalAlpha *= (1 - pulse) * .5; this.ring(x, y, (70 + (pulse + i * .3) * 140) * unit, color, 3 * unit); c.restore(); }
                c.fillStyle = '#343148eb'; c.beginPath(); c.roundRect(x - 170 * unit, y - 57 * unit, 340 * unit, 150 * unit, 24 * unit); c.fill();
                c.save(); c.translate(x, y - 8 * unit); c.rotate(Math.sin(t * 55) * .12); c.strokeStyle = color; c.lineWidth = 13 * unit; c.beginPath(); c.arc(0, -5 * unit, 25 * unit, .15 * Math.PI, .85 * Math.PI); c.stroke(); c.restore();
                this.text('Входящий звонок', x, y + 54 * unit, 23 * unit, '#eceaff'); break;
            }
            case 'falling_pipe':
                for (let i = 0; i < 7; i++) { const local = Math.max(0, t * 1.7 - r(i + 2) * .6); const y = -180 * unit + local * local * (h + 280 * unit); this.pipe(w * (.06 + r(i) * .88), y, (140 + r(i + 1) * 160) * unit, (r(i + 3) - .5) * 2 + local * 1.4, i); }
                if (t > .38) { for (let i = 0; i < 13; i++) this.star(w * r(i), h * (.83 + r(i + 1) * .15), (5 + r(i + 2) * 9) * unit, '#ffe097', i); this.text('CLANG!', w * .42, h * .74, 66 * unit, '#f5f7fd', -.1); } break;
            case 'to_be_continued': {
                const slide = 1 - Math.pow(1 - Math.min(1, t * 5), 3), x = -w * .6 + slide * w * .69, y = h * .68;
                c.fillStyle = '#16152145'; c.fillRect(0, 0, w, h * .065); c.fillRect(0, h * .935, w, h * .065);
                c.save(); c.translate(x, y); c.fillStyle = '#ffdc76'; c.strokeStyle = '#382a31'; c.lineWidth = 5 * unit;
                c.beginPath(); c.moveTo(-40 * unit, 0); c.lineTo(20 * unit, -48 * unit); c.lineTo(20 * unit, -27 * unit); c.lineTo(390 * unit, -27 * unit); c.lineTo(375 * unit, 28 * unit); c.lineTo(20 * unit, 28 * unit); c.lineTo(20 * unit, 48 * unit); c.closePath(); c.fill(); c.stroke();
                this.text('To Be Continued', 194 * unit, 0, 31 * unit, '#fff3be'); c.restore(); break;
            }
            case 'vine_boom':
                for (let i = 0; i < 3; i++) { const local = Math.max(0, t - i * .07); c.save(); c.globalAlpha *= Math.max(0, 1 - local * 1.7); this.ring(cx, cy, local * Math.max(w, h) * 1.3, i % 2 ? '#20203199' : '#ffffffd9', (10 - i * 2) * unit); c.restore(); }
                for (let i = 0; i < 24; i++) { const angle = i / 24 * Math.PI * 2; this.ray(cx + Math.cos(angle) * (a.w + t * w), cy + Math.sin(angle) * (a.w + t * h), cx + Math.cos(angle) * (a.w + t * w + w * .12), cy + Math.sin(angle) * (a.w + t * h + h * .12), '#ffffffaa', 3 * unit); } break;
            case 'answer_42':
                c.fillStyle = '#20204444'; c.fillRect(0, 0, w, h);
                for (let i = 0; i < 60; i++) { const angle = r(i) * Math.PI * 2, dist = ((r(i + 1) + t * .6) % 1) * Math.max(w, h) * .65; const x = w * .45 + Math.cos(angle) * dist, y = h * .4 + Math.sin(angle) * dist; this.ray(x, y, x + Math.cos(angle) * 12 * unit, y + Math.sin(angle) * 12 * unit, i % 3 ? '#d7e6ffaa' : '#a5ffcddd', 2 * unit); }
                c.save(); c.translate(w * .45, h * .4); c.scale(1, .35); this.ring(0, 0, 190 * unit, '#bcadffb3', 3 * unit); c.restore();
                this.text('42', w * .45, h * .4, (135 + Math.sin(t * Math.PI) * 25) * unit, color, -.045);
                this.text('Ответ найден.', w * .45, h * .57, 28 * unit, '#e0ffef'); break;
        }
    }
}
window.SceneEffects = SceneEffects;
