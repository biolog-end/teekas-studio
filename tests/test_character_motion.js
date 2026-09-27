const assert = require('node:assert/strict');
const { target, Director, INITIAL } = require('../static/js/character-motion.js');

const audio = { bass: 90, mid: 65, treble: 40 };
const emotions = ['neutral', 'excited', 'bouncy', 'tense', 'wobbly', 'sad', 'surprised', 'love', 'thinking'];

for (const preset of ['jelly_deformer', 'dynamic_rotation']) {
    for (const id of emotions) {
        const pose = target({ preset, timeMs: 900, audio, emotion: { id, phase: .4, weight: 1 }, movementEnabled: true, intensity: 1 });
        assert(Object.values(pose).every(Number.isFinite), `${preset}/${id}: invalid pose`);
        assert(pose.headScaleX >= .84 && pose.headScaleX <= 1.2);
        assert(pose.bodyScaleY >= .84 && pose.bodyScaleY <= 1.14);
    }
    const baseline = target({ preset, timeMs: 900, audio, movementEnabled: true, intensity: 1 });
    const sad = target({ preset, timeMs: 900, audio, emotion: { id: 'sad', phase: .4, weight: 1 }, movementEnabled: true, intensity: 1 });
    const tense = target({ preset, timeMs: 900, audio, emotion: { id: 'tense', phase: .4, weight: 1 }, movementEnabled: true, intensity: 1 });
    assert(sad.headAngle > baseline.headAngle);
    assert(tense.headAngle < baseline.headAngle);
    const still = target({ preset, timeMs: 900, audio, emotion: { id: 'tense', phase: .4, weight: 1 }, movementEnabled: false, intensity: 1 });
    assert.equal(still.headAngle, baseline.headAngle);
}

const director = new Director();
director.sample({ preset: 'dynamic_rotation', timeMs: 1000, audio });
assert.deepEqual(director.sample({ preset: 'dynamic_rotation', timeMs: 1016, reduced: true }), INITIAL);
console.log('character motion ok');
