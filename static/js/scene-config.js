/* Shared by the studio, OBS renderer and small offline tests. */
(function (root) {
    const defaults = Object.freeze({ x: 85, y: 98, size: 40, flip: false, effectsEnabled: true, movementEnabled: true, intensity: 1, subtitleX: 50, subtitleY: 88, subtitleWidth: 80 });
    // `hint` tells the AI when an emotion fits; aliases catch the names models invent anyway.
    const emotions = [
        { id: 'neutral', name: 'Спокойствие', hint: 'спокойствие, возврат к обычному тону', aliases: ['спокойно', 'нейтрально', 'спокойствие', 'calm', 'normal'], color: '#b6d9dd', duration: 2200 },
        { id: 'excited', name: 'Восторг', hint: 'восторг, радость, победа', aliases: ['радость', 'восторг', 'счастье', 'happy', 'joy', 'excitement'], color: '#ffd36d', duration: 3800 },
        { id: 'bouncy', name: 'Веселье', hint: 'веселье, шутка, игривость', aliases: ['веселье', 'смех', 'шутка', 'playful', 'fun', 'laugh'], color: '#c8a5ff', duration: 3700 },
        { id: 'tense', name: 'Злость', hint: 'злость, раздражение, возмущение', aliases: ['злость', 'гнев', 'раздражение', 'напряжение', 'angry', 'anger', 'mad'], color: '#ff747a', duration: 3200 },
        { id: 'wobbly', name: 'Смущение', hint: 'смущение, неловкость, растерянность', aliases: ['смущение', 'неловкость', 'растерянность', 'confused', 'embarrassed', 'awkward'], color: '#94cbff', duration: 3500 },
        { id: 'sad', name: 'Грусть', hint: 'грусть, разочарование, сочувствие', aliases: ['грусть', 'грустно', 'печаль', 'sadness', 'sorrow'], color: '#83b5df', duration: 4200 },
        { id: 'surprised', name: 'Удивление', hint: 'удивление, шок', aliases: ['удивление', 'шок', 'surprise', 'shocked', 'shock'], color: '#ffe795', duration: 2600 },
        { id: 'love', name: 'Нежность', hint: 'нежность, благодарность, симпатия', aliases: ['любовь', 'нежность', 'симпатия', 'loving', 'love', 'affection'], color: '#ff8eb2', duration: 4200 },
        { id: 'thinking', name: 'Задумчивость', hint: 'раздумье, сомнение', aliases: ['задумчивость', 'раздумье', 'думаю', 'think', 'thoughtful'], color: '#c2b5ff', duration: 4000 },
    ];
    const soundEffects = {
        bad_to_the_bone: { name: 'Bad to the Bone', duration: 4400, color: '#ffe2a2' },
        social_credit: { name: 'Social Credit', duration: 4500, color: '#ff6878' },
        discord_call: { name: 'Discord Call', duration: 4200, color: '#a6a1ff' },
        falling_pipe: { name: 'Falling Pipe', duration: 2600, color: '#d9e6ef' },
        to_be_continued: { name: 'To Be Continued', duration: 4800, color: '#ffdc76' },
        vine_boom: { name: 'Vine Boom', duration: 1800, color: '#ffffff' },
        answer_42: { name: '42', duration: 5000, color: '#96ffcf' },
    };
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    function normalize(input = {}) {
        const result = { ...defaults };
        const ranges = { x: [0, 100], y: [0, 100], size: [10, 85], intensity: [0, 1.5], subtitleX: [0, 100], subtitleY: [5, 98], subtitleWidth: [20, 100] };
        Object.entries(ranges).forEach(([key, [min, max]]) => {
            const value = Number(input?.[key]);
            if (input?.[key] != null && Number.isFinite(value)) result[key] = clamp(value, min, max);
        });
        ['flip', 'effectsEnabled', 'movementEnabled'].forEach(key => {
            if (typeof input?.[key] === 'boolean') result[key] = input[key];
        });
        return result;
    }
    function bounds(scene, width, height, ratio = 1.6) {
        const s = normalize(scene);
        const margin = Math.min(width, height) * .015;
        const h = Math.min(height * s.size / 100, width * .85 * ratio);
        const w = h / ratio;
        return { x: clamp(width * s.x / 100, w / 2 + margin, width - w / 2 - margin), y: clamp(height * s.y / 100, h + margin, height - margin), w, h };
    }
    function findEmotion(token) {
        const value = String(token || '').trim().replace(/^["'`]|["'`]$/g, '').toLowerCase();
        return emotions.find(item => item.id === value || item.name.toLowerCase() === value || item.aliases.includes(value));
    }
    function parseDirectives(source, effects = []) {
        const text = String(source || '');
        // Commands first; then stage remarks in asterisks, markdown marks and emoji, which TTS must not read.
        const pattern = /emotion\s*\(\s*([^)]*?)\s*\)|\[(?:emotion|эмоция)\s*[:=]\s*([^\]]+?)\s*\]|<emotion\s*=\s*([^>]+?)\s*>|soundboard\s*\(\s*([^)]*?)\s*\)|\*[^*\n]{1,80}\*|[*_`~#]+|\p{Extended_Pictographic}️?/giu;
        const inlineEffects = [];
        const inlineEmotions = [];
        let cleaned = '', last = 0, match;
        while ((match = pattern.exec(text))) {
            cleaned += text.slice(last, match.index);
            if (match[1] === undefined && match[2] === undefined && match[3] === undefined && match[4] === undefined) {
                // Removed noise.
            } else if (match[4] !== undefined) {
                const token = match[4].trim().replace(/^["']|["']$/g, '').toLowerCase();
                const effect = effects.find(item => item.id.toLowerCase() === token || item.name.toLowerCase() === token);
                if (effect) inlineEffects.push({ effect, charIndex: cleaned.length });
            } else {
                const emotion = findEmotion(match[1] || match[2] || match[3]);
                if (emotion) inlineEmotions.push({ emotion: emotion.id, charIndex: cleaned.length });
            }
            last = pattern.lastIndex;
            // Removing a word-like token must not leave a double space behind.
            if (!cleaned || /\s$/.test(cleaned)) while (text[last] === ' ' || text[last] === '\t') last++;
        }
        cleaned += text.slice(last);
        const leading = cleaned.length - cleaned.trimStart().length;
        cleaned = cleaned.trim();
        [...inlineEffects, ...inlineEmotions].forEach(item => { item.charIndex = clamp(item.charIndex - leading, 0, cleaned.length); });
        return { cleaned, inlineEffects, inlineEmotions };
    }
    const api = { defaults, emotions, soundEffects, normalize, bounds, findEmotion, parseDirectives, clamp };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SceneConfig = api;
})(typeof window !== 'undefined' ? window : this);
