const assert = require('node:assert/strict');
const SceneConfig = require('../static/js/scene-config.js');

const effects = [{ id: 'vine_boom', name: 'Vine Boom' }, { id: 'social_credit', name: 'Social Credit Siren' }];
const parsed = SceneConfig.parseDirectives(
    'emotion(surprised) Да ладно?! *хлопает глазами* soundboard(vine_boom) Это **лучшая** новость 🔥 дня! emotion(Восторг) Ура', effects);
assert.equal(parsed.cleaned, 'Да ладно?! Это лучшая новость дня! Ура');
assert.deepEqual(parsed.inlineEmotions.map(item => item.emotion), ['surprised', 'excited']);
assert.equal(parsed.cleaned.slice(parsed.inlineEffects[0].charIndex).split(' ')[0], 'Это');
assert.equal(parsed.cleaned.slice(parsed.inlineEmotions[1].charIndex), 'Ура');

const unknown = SceneConfig.parseDirectives('soundboard(made_up) emotion(nope) Текст', effects);
assert.equal(unknown.cleaned, 'Текст');
assert.equal(unknown.inlineEffects.length + unknown.inlineEmotions.length, 0);

for (const emotion of SceneConfig.emotions) {
    assert.ok(emotion.hint, `${emotion.id}: hint for the AI rules`);
    assert.equal(SceneConfig.findEmotion(emotion.name.toUpperCase()).id, emotion.id);
}
console.log('scene config ok');
