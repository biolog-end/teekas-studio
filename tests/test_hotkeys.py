import json

import pytest

import ptt


@pytest.mark.parametrize('value', ['f8', 'ctrl+alt+f10', 'ctrl+m', 'ctrl+ctrl+m', 'ctrl+control+m', 'ctrl+alt', 'ctrl+alt+m,ctrl+alt+b', '', 'ctrl+alt+unknown'])
def test_invalid_chords_are_rejected(value):
    with pytest.raises(ValueError):
        ptt.normalize_hotkey(value)


def test_chords_are_canonical():
    assert ptt.normalize_hotkey(' Alt + Control + M ') == 'ctrl+alt+m'
    assert ptt.normalize_hotkey('Shift+Win+Control+7') == 'ctrl+shift+windows+7'
    assert ptt.normalize_hotkey('ctrl+shift+PgUp') == 'ctrl+shift+page up'


def test_migration_keeps_custom_chords(tmp_path, monkeypatch):
    config = tmp_path / 'ptt_config.json'
    config.write_text(json.dumps({'hotkeys': {'microphone': 'f8', 'summon': 'Shift+Ctrl+B'}}), encoding='utf-8')
    monkeypatch.setattr(ptt, 'CONFIG_PATH', str(config))
    controller = ptt.PttController()
    assert controller.hotkeys == {'microphone': 'ctrl+alt+m', 'summon': 'ctrl+shift+b', 'screenshot': 'ctrl+alt+s'}
    assert json.loads(config.read_text(encoding='utf-8'))['hotkeys'] == controller.hotkeys


def test_duplicate_chords_do_not_change_config(tmp_path, monkeypatch):
    config = tmp_path / 'ptt_config.json'
    monkeypatch.setattr(ptt, 'CONFIG_PATH', str(config))
    monkeypatch.setattr(ptt, '_HAS_KEYBOARD', False)
    controller = ptt.PttController()
    ok, _ = controller.set_hotkeys({'summon': 'Alt+Control+M'})
    assert not ok
    assert controller.hotkeys == ptt.DEFAULT_HOTKEYS
    assert not config.exists()
    ok, _ = controller.set_hotkeys({'microphone': 'Ctrl+Shift+7'})
    assert ok
    assert json.loads(config.read_text(encoding='utf-8'))['hotkeys']['microphone'] == 'ctrl+shift+7'


def test_panel_summon_and_hotkey_share_state(tmp_path, monkeypatch):
    monkeypatch.setattr(ptt, 'CONFIG_PATH', str(tmp_path / 'ptt_config.json'))
    controller = ptt.PttController()
    controller.set_summoned(True)
    assert controller.generations['summon'] == 0
    controller._activate('summon')
    assert not controller.summoned


def test_hotkeys_fire_on_release(monkeypatch, tmp_path):
    from types import SimpleNamespace
    registered = []
    monkeypatch.setattr(ptt, 'CONFIG_PATH', str(tmp_path / 'ptt_config.json'))
    monkeypatch.setattr(ptt, '_HAS_KEYBOARD', True)
    monkeypatch.setattr(ptt, 'keyboard', SimpleNamespace(add_hotkey=lambda *args, **kwargs: registered.append(kwargs)))
    controller = ptt.PttController()
    controller._register()
    assert len(registered) == 3
    assert all(item['trigger_on_release'] for item in registered)
