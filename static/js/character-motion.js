/* Small, deterministic acting layer for the two main character rigs. */
(function (root) {
    const INITIAL = Object.freeze({
        bodyX: 0, bodyY: 0, bodyAngle: 0, bodyScaleX: 1, bodyScaleY: 1,
        headX: 0, headY: 0, headAngle: 0, headScaleX: 1, headScaleY: 1,
    });
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const wave = (phase, cycles = 1) => Math.sin(phase * Math.PI * 2 * cycles);
    const ease = value => value * value * (3 - 2 * value);

    function target(options = {}) {
        const time = (Number(options.timeMs) || 0) / 1000;
        const audio = options.audio || {};
        const bass = clamp((Number(audio.bass) || 0) / 145, 0, 1);
        const middle = clamp((Number(audio.mid) || 0) / 145, 0, 1);
        const treble = clamp((Number(audio.treble) || 0) / 180, 0, 1);
        const speaking = clamp((bass + middle + treble) / 3, 0, 1);
        const jelly = options.preset !== 'dynamic_rotation';
        const result = { ...INITIAL };

        // One slow breath, a small counter-motion of the head, and voice-led movement.
        const breath = Math.sin(time * 2.1);
        result.bodyX = Math.sin(time * 1.17) * (jelly ? 2.4 : 1.8);
        result.bodyY = Math.sin(time * 1.55) * 1.4;
        result.bodyAngle = Math.sin(time * (jelly ? 1.08 : 1.36)) * (jelly ? 1.1 : 1.8);
        result.bodyScaleX = 1 + breath * (jelly ? .007 : .005);
        result.bodyScaleY = 1 - breath * (jelly ? .006 : .004);
        result.headX = Math.sin(time * 1.31 + .4) * 1.8;
        result.headY = Math.sin(time * 1.63 + .7) * 1.3;
        result.headAngle = -result.bodyAngle * .55 + Math.sin(time * .93 + .6) * (jelly ? 1.3 : 1.8);

        if (jelly) {
            result.bodyScaleX += bass * .027;
            result.bodyScaleY -= bass * .035;
            result.headScaleX += middle * .065;
            result.headScaleY -= bass * .075;
            result.headY += bass * 5;
            result.headAngle += Math.sin(time * 13) * treble * 2.3;
            result.bodyAngle += Math.sin(time * 4.2) * speaking * 2;
        } else {
            result.bodyAngle += bass * 4.2 + Math.sin(time * 3.7) * speaking * 1.6;
            result.bodyX += Math.sin(time * 2.3) * bass * 4;
            result.headAngle -= bass * 8.5;
            result.headX += middle * 4;
            result.headScaleX += middle * .035;
            result.headScaleY -= bass * .045;
            result.headAngle += Math.sin(time * 17) * treble * 2.4;
        }

        const emotion = options.emotion || {};
        const weight = options.movementEnabled === false ? 0 : clamp(Number(emotion.weight) || 0, 0, 1) * clamp(Number(options.intensity) || 0, 0, 1.5);
        const phase = clamp(Number(emotion.phase) || 0, 0, 1);
        if (weight) {
            const gesture = { ...INITIAL };
            const bob = Math.abs(wave(phase, 2));
            // Poses ease in instead of snapping; the timing below adds anticipation and overshoot.
            const settle = span => ease(clamp(phase / span, 0, 1));
            switch (emotion.id) {
                case 'neutral': {
                    const exhale = Math.sin(clamp(phase / .6, 0, 1) * Math.PI);
                    gesture.bodyScaleX = 1 + exhale * .012;
                    gesture.bodyScaleY = 1 - exhale * .03;
                    gesture.headY = exhale * 4;
                    gesture.headAngle = exhale * 2;
                    break;
                }
                case 'excited': {
                    // Three hops in sync with the scene-level jump: squash on landing, stretch in the air.
                    const hop = Math.abs(wave(phase, 1.5));
                    const land = Math.pow(1 - hop, 6);
                    gesture.bodyScaleX = 1 + land * .06 - hop * .02;
                    gesture.bodyScaleY = 1 - land * .075 + hop * .045;
                    gesture.bodyAngle = wave(phase, 2) * 3;
                    gesture.headAngle = wave(phase, 3) * 10;
                    gesture.headY = -6 - hop * 9 + land * 6;
                    gesture.headScaleX = 1.035;
                    break;
                }
                case 'bouncy':
                    gesture.bodyAngle = wave(phase, 2) * 5;
                    gesture.bodyScaleX = 1 + bob * .055;
                    gesture.bodyScaleY = 1 - bob * .055;
                    gesture.headAngle = -wave(phase, 2) * 9;
                    gesture.headX = wave(phase, 2) * 4;
                    gesture.headY = -bob * 9;
                    break;
                case 'tense': {
                    const grip = settle(.15);
                    gesture.bodyAngle = (6 + Math.sin(time * 47) * 1.2) * grip;
                    gesture.bodyScaleX = 1 + .02 * grip;
                    gesture.bodyScaleY = 1 - .04 * grip;
                    gesture.headAngle = (-14 + Math.sin(time * 53) * 2.2) * grip;
                    gesture.headX = 7 * grip + Math.sin(time * 61) * 1.5;
                    gesture.headY = 4 * grip;
                    gesture.headScaleY = .96;
                    break;
                }
                case 'wobbly': {
                    const shy = settle(.2);
                    gesture.bodyAngle = -wave(phase, 1.5) * 3;
                    gesture.bodyScaleX = 1 + .015 * shy;
                    gesture.bodyScaleY = 1 - .035 * shy;
                    gesture.headAngle = (7 + wave(phase, 2) * 9) * shy;
                    gesture.headX = wave(phase, 2) * 7;
                    gesture.headY = 6 * shy + bob * 2;
                    break;
                }
                case 'sad': {
                    const droop = settle(.25);
                    gesture.bodyAngle = -4 * droop;
                    gesture.bodyScaleX = 1 + .01 * droop;
                    gesture.bodyScaleY = 1 - .045 * droop;
                    gesture.headAngle = (15 + wave(phase, .75) * 2) * droop;
                    gesture.headX = -3 * droop;
                    gesture.headY = 14 * droop;
                    break;
                }
                case 'surprised': {
                    // A sharp jolt in the first moments, then a damped wobble back to rest.
                    const jolt = phase < .08 ? ease(phase / .08)
                        : Math.exp(-(phase - .08) * 5) * (.55 + .45 * Math.cos((phase - .08) * 22));
                    gesture.bodyAngle = -3 * jolt;
                    gesture.bodyScaleX = 1 - .05 * jolt;
                    gesture.bodyScaleY = 1 + .07 * jolt;
                    gesture.headY = -16 * jolt;
                    gesture.headScaleX = 1 + .08 * jolt;
                    gesture.headScaleY = 1 + .08 * jolt;
                    gesture.headAngle = -8 * jolt;
                    break;
                }
                case 'love': {
                    const beat = Math.pow(Math.max(0, Math.sin(time * 7.5)), 8);
                    gesture.bodyAngle = wave(phase, 1) * 2.5;
                    gesture.headAngle = 8 + wave(phase, 1.5) * 5;
                    gesture.headY = -4 - bob * 3;
                    gesture.headScaleX = 1 + beat * .03;
                    gesture.headScaleY = 1 + beat * .03;
                    break;
                }
                case 'thinking': {
                    const ponder = settle(.2);
                    gesture.bodyAngle = -2 * ponder;
                    gesture.headAngle = (-13 + wave(phase, .8) * 2.5) * ponder;
                    gesture.headX = -7 * ponder;
                    gesture.headY = (-3 + wave(phase, 1) * 1.5) * ponder;
                    break;
                }
            }
            Object.keys(result).forEach(key => {
                const neutral = key.includes('Scale') ? 1 : 0;
                result[key] += (gesture[key] - neutral) * weight;
            });
        }

        result.bodyAngle = clamp(result.bodyAngle, -12, 12);
        result.headAngle = clamp(result.headAngle, -25, 25);
        result.headScaleX = clamp(result.headScaleX, .84, 1.2);
        result.headScaleY = clamp(result.headScaleY, .82, 1.16);
        result.bodyScaleX = clamp(result.bodyScaleX, .86, 1.17);
        result.bodyScaleY = clamp(result.bodyScaleY, .84, 1.14);
        return result;
    }

    class Director {
        constructor() { this.pose = { ...INITIAL }; this.lastTime = null; this.preset = null; }
        sample(options) {
            if (options.reduced) {
                this.pose = { ...INITIAL };
                this.lastTime = options.timeMs;
                return this.pose;
            }
            const goal = target(options);
            const dt = this.lastTime == null ? 1 / 60 : clamp((options.timeMs - this.lastTime) / 1000, 1 / 240, .1);
            this.lastTime = options.timeMs;
            this.preset = options.preset;
            for (const key of Object.keys(this.pose)) {
                const head = key.startsWith('head');
                const duration = options.preset === 'dynamic_rotation'
                    ? (head ? .125 : .085) : (head ? .07 : .115);
                const blend = 1 - Math.exp(-dt / duration);
                this.pose[key] += (goal[key] - this.pose[key]) * blend;
            }
            return this.pose;
        }
    }
    const api = { target, Director, INITIAL };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CharacterMotion = api;
})(typeof window !== 'undefined' ? window : this);
