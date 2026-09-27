"""Validated, resolution-independent settings for the OBS scene."""
import math
import re

DEFAULT_SCENE = dict(x=85, y=98, size=40, flip=False, effectsEnabled=True,
                     movementEnabled=True, intensity=1, subtitleX=50, subtitleY=88, subtitleWidth=80)
RANGES = dict(x=(0, 100), y=(0, 100), size=(10, 85), intensity=(0, 1.5),
              subtitleX=(0, 100), subtitleY=(5, 98), subtitleWidth=(20, 100))


def normalize_scene(value):
    value = value if isinstance(value, dict) else {}
    result = DEFAULT_SCENE.copy()
    for key, (low, high) in RANGES.items():
        try:
            number = float(value[key])
            if math.isfinite(number):
                result[key] = max(low, min(high, number))
        except (KeyError, ValueError, TypeError, OverflowError):
            pass
    for key in ('flip', 'effectsEnabled', 'movementEnabled'):
        if isinstance(value.get(key), bool):
            result[key] = value[key]
    return result


def normalize_state(value, previous=None):
    """Accept presentation settings only, never arbitrary event fields."""
    value = value if isinstance(value, dict) else {}
    previous = previous or {}
    result = {
        'characterId': previous.get('characterId', 'starter'),
        'animationStyle': previous.get('animationStyle', 'jelly_deformer'),
        'scene': normalize_scene(previous.get('scene')),
        'subtitles': dict(previous.get('subtitles') or dict(enabled=True, color='#FFFFFF', size=36, font='Impact')),
    }
    for key in ('characterId', 'animationStyle'):
        if isinstance(value.get(key), str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', value[key]):
            result[key] = value[key]
    if isinstance(value.get('scene'), dict):
        result['scene'] = normalize_scene({**result['scene'], **value['scene']})
    if isinstance(value.get('subtitles'), dict):
        subtitles = value['subtitles']
        if isinstance(subtitles.get('enabled'), bool):
            result['subtitles']['enabled'] = subtitles['enabled']
        if isinstance(subtitles.get('color'), str) and re.fullmatch(r'#[0-9a-fA-F]{6}', subtitles['color']):
            result['subtitles']['color'] = subtitles['color']
        if subtitles.get('font') in ('Impact', 'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Times New Roman', 'Segoe UI'):
            result['subtitles']['font'] = subtitles['font']
        try:
            size = float(subtitles['size'])
            if math.isfinite(size):
                result['subtitles']['size'] = max(12, min(120, size))
        except (KeyError, TypeError, ValueError, OverflowError):
            pass
    return result
