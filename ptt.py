"""Global configurable hotkeys for the stream avatar.

The browser consumes monotonically increasing action counters via ``/ptt-state``.
Microphone mode is a toggle: first press starts the session, the next finishes it.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading

try:
    import keyboard
    _HAS_KEYBOARD = True
except Exception:
    keyboard = None
    _HAS_KEYBOARD = False


CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ptt_config.json")
DEFAULT_HOTKEYS = {
    "microphone": "ctrl+alt+m",
    "summon": "ctrl+alt+b",
    "screenshot": "ctrl+alt+s",
}

MODIFIERS = ("ctrl", "alt", "shift", "windows")
KEY_ALIASES = {"control": "ctrl", "win": "windows", "super": "windows", "esc": "escape", "return": "enter", "pgup": "page up", "pgdn": "page down", "del": "delete", "ins": "insert"}
NAMED_KEYS = {"space", "tab", "enter", "escape", "backspace", "delete", "insert", "home", "end", "page up", "page down", "up", "down", "left", "right"}


def normalize_hotkey(value):
    """A single Stream Deck chord: at least two modifiers and one regular key."""
    tokens = [KEY_ALIASES.get(token.strip().lower(), token.strip().lower())
              for token in str(value or "").split("+")]
    if any(re.fullmatch(r"f\d+", token) for token in tokens):
        raise ValueError("F-клавиши не используются. Например: Ctrl+Alt+M.")
    modifiers = [key for key in MODIFIERS if key in tokens]
    regular = [key for key in tokens if key not in MODIFIERS]
    if (len(tokens) != len(set(tokens)) or len(modifiers) < 2 or len(regular) != 1
            or not (re.fullmatch(r"[a-z0-9]", regular[0]) or regular[0] in NAMED_KEYS)):
        raise ValueError("Нужны минимум 3 разные клавиши: два модификатора (Ctrl, Alt, Shift, Win) и обычная клавиша. Например: Ctrl+Alt+M.")
    return "+".join([*modifiers, regular[0]])


class PttController:
    """Registers hotkeys and exposes edge-triggered state to the browser."""

    def __init__(self):
        self._lock = threading.RLock()
        self.hotkeys = dict(DEFAULT_HOTKEYS)
        self.generations = {name: 0 for name in DEFAULT_HOTKEYS}
        self.generation = 0
        self.microphone_active = False
        self.summoned = False
        self._handles = []
        self._registered = False
        self._load_config()

    @property
    def active(self):
        """Compatibility alias for the old push-to-talk API."""
        return self.microphone_active

    @property
    def hotkey(self):
        return self.hotkeys["microphone"]

    def _load_config(self):
        if not os.path.exists(CONFIG_PATH):
            return
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                return
            configured = data.get("hotkeys") if isinstance(data.get("hotkeys"), dict) else {}
            if data.get("hotkey") and not configured.get("microphone"):
                configured["microphone"] = data["hotkey"]
            valid = {}
            for action in DEFAULT_HOTKEYS:
                try:
                    value = normalize_hotkey(configured.get(action))
                    if value not in valid.values():
                        valid[action] = value
                except ValueError:
                    pass  # Migrate old F8/F9/F10 and invalid saved chords.
            for action, default in DEFAULT_HOTKEYS.items():
                if action not in valid:
                    value = default if default not in valid.values() else default.replace("alt+", "alt+shift+")
                    while value in valid.values():
                        value = value.replace("shift+", "shift+windows+")
                    valid[action] = value
            self.hotkeys = valid
            if data != {"hotkeys": valid}:
                self._save_config()
        except (OSError, json.JSONDecodeError) as exc:
            logging.warning("Не удалось прочитать %s: %s", CONFIG_PATH, exc)

    def _save_config(self):
        directory = os.path.dirname(CONFIG_PATH)
        fd, temporary = tempfile.mkstemp(dir=directory, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"hotkeys": self.hotkeys}, fh, ensure_ascii=False, indent=2)
            os.replace(temporary, CONFIG_PATH)
        except Exception:
            try:
                os.remove(temporary)
            except OSError:
                pass
            raise

    def snapshot(self):
        with self._lock:
            return {
                "active": self.microphone_active,
                "microphone_active": self.microphone_active,
                "summoned": self.summoned,
                "generation": self.generation,
                "generations": dict(self.generations),
                "hotkey": self.hotkeys["microphone"],
                "hotkeys": dict(self.hotkeys),
                "available": _HAS_KEYBOARD and self._registered,
            }

    def start(self):
        if not _HAS_KEYBOARD:
            logging.warning("Библиотека keyboard не установлена - глобальные хоткеи отключены.")
            return
        self._register()

    def set_hotkey(self, new_hotkey):
        return self.set_hotkeys({"microphone": new_hotkey})

    def set_hotkeys(self, updates):
        updates = updates or {}
        if not isinstance(updates, dict):
            return False, "Передайте сочетания клавиш для каждого действия."
        candidate = dict(self.hotkeys)
        for action in DEFAULT_HOTKEYS:
            if action in updates:
                try:
                    candidate[action] = normalize_hotkey(updates[action])
                except ValueError as exc:
                    return False, str(exc)

        normalized = [value.replace(" ", "") for value in candidate.values()]
        if len(set(normalized)) != len(normalized):
            return False, "Для разных действий нужны разные сочетания клавиш."

        if _HAS_KEYBOARD:
            try:
                for value in candidate.values():
                    keyboard.parse_hotkey(value)
            except Exception as exc:
                return False, f"Не удалось разобрать сочетание клавиш: {exc}"

        with self._lock:
            previous = self.hotkeys
            self.hotkeys = candidate
            try:
                if _HAS_KEYBOARD:
                    self._register()
                self._save_config()
            except Exception as exc:
                self.hotkeys = previous
                if _HAS_KEYBOARD:
                    try:
                        self._register()
                    except Exception:
                        logging.exception("Не удалось восстановить прежние хоткеи")
                logging.error("Не удалось сохранить хоткеи: %s", exc)
                return False, f"Не удалось применить хоткеи: {exc}"
        return True, None

    def _remove_handles(self):
        if not _HAS_KEYBOARD:
            return
        for handle in self._handles:
            try:
                keyboard.remove_hotkey(handle)
            except Exception:
                pass
        self._handles = []

    def _register(self):
        self._remove_handles()
        try:
            for action, combo in self.hotkeys.items():
                handle = keyboard.add_hotkey(
                    combo,
                    lambda selected=action: self._activate(selected),
                    suppress=False,
                    trigger_on_release=True,
                )
                self._handles.append(handle)
            self._registered = True
            logging.info("Глобальные хоткеи активны: %s", ", ".join(self.hotkeys))
        except Exception:
            self._registered = False
            self._remove_handles()
            raise

    def _activate(self, action):
        with self._lock:
            if action == "microphone":
                self.microphone_active = not self.microphone_active
                if not self.summoned:
                    self.summoned = True
                    self.generations["summon"] += 1
            elif action == "summon":
                self.summoned = not self.summoned
                if not self.summoned:
                    self.microphone_active = False
            elif action == "screenshot" and not self.summoned:
                self.summoned = True
                self.generations["summon"] += 1

            self.generations[action] += 1
            self.generation += 1

    def set_summoned(self, summoned):
        """Keep panel buttons and the next global toggle in sync, without a new event."""
        with self._lock:
            self.summoned = bool(summoned)
            if not self.summoned:
                self.microphone_active = False
