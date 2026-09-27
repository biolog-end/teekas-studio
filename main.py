from flask import Flask, Response, render_template, request, send_file, jsonify, redirect, url_for, stream_with_context
from gtts import gTTS
import io
import time
import os
import json
import logging
import socket
import threading
import tempfile
import webbrowser
import base64
import uuid
from collections import deque
from shutil import which
from PIL import Image, ImageGrab
from pydub import AudioSegment
from pydub.effects import speedup
import colorama


import gemini_chat
import gemini_models
import key_pool
import model_fallbacks
import openai_chat
import openai_models
import providers
# Модуль «рации» (глобальная горячая клавиша push-to-talk)
import ptt
from scene import normalize_state

app = Flask(__name__)
# Ограничение размера загружаемых файлов (защита от чрезмерного потребления памяти)
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_UPLOAD_MB', '16')) * 1024 * 1024
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
colorama.init(autoreset=True)

# Проверяем наличие FFmpeg - без него pydub не сможет менять скорость/высоту звука
if which('ffmpeg') is None:
    app.logger.warning(
        "FFmpeg не найден в PATH. Синтез речи с изменением скорости/тона работать не будет. "
        "Установите FFmpeg и добавьте его в PATH."
    )

try:
    key_pool.load_keys()
    key_pool.import_from_env()
    _pool = key_pool.get_status()['providers']
    app.logger.info("Ключи API: " + ", ".join(
        f"{providers.LABELS[name]} {value['available']}/{value['total']}" for name, value in _pool.items()))
except Exception:
    app.logger.error("Не удалось загрузить ключи API.", exc_info=True)

# Запускаем прослушивание глобальной горячей клавиши рации (если доступно)
ptt_controller = ptt.PttController()
try:
    ptt_controller.start()
except Exception:
    app.logger.error("Не удалось запустить рацию (PTT).", exc_info=True)

# --- Пути к файлам ---
PERSONAS_JSON_PATH = os.path.join('static', 'personas.json')
CHARACTERS_JSON_PATH = os.path.join('static', 'characters.json')
CHARACTERS_DIR = os.path.join('static', 'characters')
# Папка с картинками для оверлеев эффектов (например, картинки труб для Falling Pipe)
EFFECT_IMAGES_DIR = os.path.join('static', 'img')
# Разрешённые расширения картинок для оверлеев
_IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.gif', '.webp')

# Блокировка для безопасной записи JSON-файлов (read-modify-write)
_file_lock = threading.Lock()


def _write_json_atomic(path, data):
    """Атомарно записывает JSON: пишем во временный файл и переименовываем."""
    target_dir = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(dir=target_dir, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


# --- Хранилище для данных анимации ---
animation_data = {
    "timestamp": None,
    "data": None
}
_animation_lock = threading.Lock()
_animation_events = deque(maxlen=250)
_animation_event_id = 0
SCENE_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scene_config.json')
try:
    with open(SCENE_CONFIG_PATH, 'r', encoding='utf-8') as scene_file:
        _scene_state = normalize_state(json.load(scene_file))
except (OSError, ValueError, TypeError):
    _scene_state = normalize_state({})

# Screenshots live in memory for a few minutes and are addressed by an opaque id.
_screenshots = {}
_screenshots_lock = threading.Lock()
SCREENSHOT_TTL_SECONDS = 300


def _enqueue_animation(payload):
    """Publish an ordered event so streaming TTS chunks cannot overwrite each other."""
    global animation_data, _animation_event_id, _scene_state
    with _animation_lock:
        _scene_state = normalize_state(payload, _scene_state)
        _animation_event_id += 1
        event = {"id": _animation_event_id, "timestamp": time.time(), "data": payload}
        _animation_events.append(event)
        animation_data = {"timestamp": event["timestamp"], "data": payload}
        return event


def _screen_data_url(screen_id):
    if not screen_id:
        return None
    now = time.time()
    with _screenshots_lock:
        stale = [key for key, item in _screenshots.items() if now - item["created_at"] > SCREENSHOT_TTL_SECONDS]
        for key in stale:
            _screenshots.pop(key, None)
        item = _screenshots.get(screen_id)
        return item["data_url"] if item else None


# --- Константы для безопасности pydub ---
MIN_PYDUB_SPEED_FACTOR = 0.5
MAX_PYDUB_SPEED_FACTOR = 4.0

@app.route('/')
def home():
    """Перенаправляем пользователя сразу на панель управления."""
    return redirect(url_for('control_panel'))

@app.route('/control')
def control_panel():
    """Отдает страницу с панелью управления."""
    return render_template('control.html')

@app.route('/animation')
def animation_view():
    """Отдает страницу только с анимацией персонажа."""
    return render_template('animation.html')


@app.route('/api/scene', methods=['GET', 'POST'])
def scene_config():
    """Snapshot for newly opened OBS sources; layout changes are ordered events."""
    if request.method == 'POST':
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Ожидались настройки сцены.'}), 400
        with _file_lock:
            with _animation_lock:
                settings = normalize_state(data, _scene_state)
            _write_json_atomic(SCENE_CONFIG_PATH, settings)
            _enqueue_animation({'job_type': 'scene', **settings})
    with _animation_lock:
        result = {**_scene_state, 'event_id': _animation_event_id}
    result['summoned'] = ptt_controller.snapshot()['summoned']
    return jsonify(result)

@app.route('/creator')
def creator_view():
    """Отдает страницу для создания персонажей."""
    return render_template('creator.html')

@app.route('/trigger-animation', methods=['POST'])
def trigger_animation():
    """
    Принимает данные с панели управления и сохраняет их в
    наше временное хранилище `animation_data`.
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"status": "error", "message": "Ожидался JSON в теле запроса"}), 400
    event = _enqueue_animation(payload)
    if payload.get('job_type') in ('summon', 'dismiss'):
        ptt_controller.set_summoned(payload['job_type'] == 'summon')
    app.logger.info(f"Received new animation job: {payload.get('text', '')}")
    return jsonify({"status": "success", "message": "Animation triggered", "event_id": event["id"]})

@app.route('/trigger-special-effect', methods=['POST'])
def trigger_special_effect():
    """
    Принимает ID спецэффекта, находит его в JSON и отправляет
    в хранилище `animation_data` как новый тип задания.
    """
    try:
        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({"status": "error", "message": "Ожидался JSON в теле запроса"}), 400
        effect_id = payload.get('effectId')
        if not effect_id:
            return jsonify({"status": "error", "message": "Effect ID is missing"}), 400

        sfx_config_path = os.path.join(app.static_folder, 'special_effects.json')
        with open(sfx_config_path, 'r', encoding='utf-8') as f:
            sfx_data = json.load(f)

        effect = next((item for item in sfx_data if item["id"] == effect_id), None)

        if not effect:
            return jsonify({"status": "error", "message": "Effect not found"}), 404

        _enqueue_animation({
            "job_type": "sfx",
            "sfx_data": effect,
            "characterId": payload.get('characterId'),
            "scene": payload.get('scene'),
            "animationStyle": payload.get('animationStyle'),
            "subtitles": payload.get('subtitles')
        })
        app.logger.info(f"Received new SFX job: {effect_id}")
        return jsonify({"status": "success", "message": "SFX triggered"})

    except Exception as e:
        app.logger.error(f"Error triggering SFX: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/list-effect-images/<folder>', methods=['GET'])
def list_effect_images(folder):
    """
    Возвращает список путей к картинкам из подпапки static/img/<folder>.
    Используется оверлеями эффектов (например, картинки труб для Falling Pipe).
    Если папки нет - возвращаем пустой список (фича мягко деградирует).
    """
    # Защита от выхода за пределы static/img (path traversal)
    safe_name = os.path.basename(folder)
    target_dir = os.path.join(EFFECT_IMAGES_DIR, safe_name)
    if not os.path.isdir(target_dir):
        return jsonify({"images": []})
    try:
        files = sorted(
            f for f in os.listdir(target_dir)
            if f.lower().endswith(_IMAGE_EXTENSIONS)
        )
        images = [f"/static/img/{safe_name}/{f}".replace('\\', '/') for f in files]
        return jsonify({"images": images})
    except Exception:
        app.logger.error("Не удалось прочитать папку с картинками эффекта.", exc_info=True)
        return jsonify({"images": []})

@app.route('/get-animation-data', methods=['GET'])
def get_animation_data():
    """
    Этот эндпоинт вызывается страницей с анимацией.
    Она просто возвращает текущие данные из хранилища.
    """
    return jsonify(animation_data)


@app.route('/animation-events', methods=['GET'])
def animation_events():
    """Return all ordered avatar events newer than ``after``."""
    try:
        after = max(0, int(request.args.get('after', '0')))
    except ValueError:
        after = 0
    with _animation_lock:
        events = [event for event in _animation_events if event["id"] > after]
        latest = _animation_event_id
    return jsonify({"events": events, "latest_id": latest})

@app.route('/ptt-state', methods=['GET'])
def ptt_state():
    """Текущее состояние рации (зажата ли клавиша). Поллится панелью управления."""
    return jsonify(ptt_controller.snapshot())

@app.route('/ptt-config', methods=['GET', 'POST'])
def ptt_config():
    """Чтение/смена всех глобальных горячих клавиш."""
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        updates = data.get('hotkeys') or ({"microphone": data.get('hotkey')} if data.get('hotkey') else {})
        ok, error = ptt_controller.set_hotkeys(updates)
        if not ok:
            return jsonify({"status": "error", "message": error}), 400
        app.logger.info("Горячие клавиши обновлены.")
        snap = ptt_controller.snapshot()
        snap["status"] = "success"
        return jsonify(snap)
    return jsonify(ptt_controller.snapshot())


@app.route('/api/ai/status', methods=['GET'])
def ai_status():
    status = key_pool.get_status()
    return jsonify({"providers": status['providers'], "gemini_quota": status['gemini_quota_available'],
                    "openai_budget": status['openai_budget_available']})


_live_models = {"at": 0.0, "ids": {}}
LIVE_MODELS_TTL_SECONDS = 600


def _refresh_live_models():
    ids = {}
    try:
        ids['gemini'] = gemini_models.fetch_live_model_ids(key_pool.get_any_client('gemini'))
        ids['openai'] = openai_models.fetch_live_model_ids(key_pool.get_any_client('openai'))
    except Exception as exc:
        app.logger.warning("Список моделей API недоступен: %s", exc)
    _live_models["ids"] = ids


def _live_model_ids(provider):
    """Model ids the API reports; the catalogs may lag behind new releases.

    Refreshed in the background so a slow network never delays the panel.
    """
    if time.time() - _live_models["at"] > LIVE_MODELS_TTL_SECONDS:
        _live_models["at"] = time.time()
        threading.Thread(target=_refresh_live_models, daemon=True).start()
    return _live_models["ids"].get(provider) or []


@app.route('/api/models', methods=['GET'])
def ai_models():
    options = [{**item, "provider": "gemini"} for item in gemini_models.build_selector_options(_live_model_ids('gemini'))]
    options += openai_models.build_selector_options(_live_model_ids('openai'))
    return jsonify({
        "models": options,
        "defaults": {name: providers.default_model(name) for name in providers.PROVIDERS},
        "fallback_chain": model_fallbacks.DEFAULT_CHAIN,
    })


@app.route('/api/keys', methods=['GET', 'POST'])
def api_keys():
    """Key editor. The browser only ever sees masked values."""
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        try:
            status = key_pool.update_from_client(data.get('keys'))
        except (ValueError, OSError) as exc:
            return jsonify({"status": "error", "message": str(exc)}), 400
        _live_models["at"] = 0.0
        app.logger.info("Ключи API обновлены: %s шт.", status['total'])
        return jsonify({"status": "success", **status})
    return jsonify(key_pool.get_status())


@app.route('/api/ai-budget', methods=['GET'])
def ai_budget():
    return jsonify(openai_chat.budget_status(request.args.get("model")))


@app.route('/capture-screen', methods=['POST'])
def capture_screen():
    """Capture only the primary monitor and keep the PNG briefly in memory."""
    try:
        image = ImageGrab.grab(all_screens=False)
        image.thumbnail((2560, 1440), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        data_url = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
        screen_id = uuid.uuid4().hex
        with _screenshots_lock:
            _screenshots[screen_id] = {"created_at": time.time(), "data_url": data_url}
        return jsonify({"status": "success", "screen_id": screen_id})
    except Exception as exc:
        app.logger.error("Не удалось сделать снимок первого монитора: %s", exc, exc_info=True)
        return jsonify({"error": f"Не удалось сделать снимок первого монитора: {exc}"}), 500


def _number(value, default, low, high):
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return default


def _ai_stream_for(data):
    history = data.get("chat_history") or []
    image_data_url = _screen_data_url(data.get("screen_id"))
    if not history:
        raise ValueError("История чата не может быть пустой.")
    if data.get("screen_id") and not image_data_url:
        raise ValueError("Снимок экрана устарел или не найден. Сделайте новый снимок.")
    model = str(data.get("model") or "").strip() or providers.default_model(str(data.get("provider") or "gemini"))
    return model_fallbacks.stream_reply({
        "model": model,
        "fallback_enabled": bool(data.get("fallback_enabled", False)),
        "fallback_models": data.get("fallback_models") or model_fallbacks.DEFAULT_CHAIN,
        "system_prompt": str(data.get("system_prompt") or ""),
        "history": history,
        "image_data_url": image_data_url,
        "thinking": bool(data.get("thinking", False)),
        "timeout_s": _number(data.get("request_timeout_s"), 60, 5, 600),
        "persona_id": str(data.get("persona_id") or "default"),
        "previous_response_id": data.get("previous_response_id"),
        "previous_key_id": data.get("previous_key_id"),
        "cache_chat": bool(data.get("cache_chat", True)),
        "context_mode": str(data.get("context_mode") or "summarize"),
        "compact_threshold": int(_number(data.get("compact_threshold"), openai_chat.DEFAULT_COMPACT_THRESHOLD, 8000, 10**7)),
    })


@app.route('/api/ai/stream', methods=['POST'])
def ai_stream():
    """Stream newline-delimited JSON events from either AI provider."""
    data = request.get_json(silent=True) or {}

    @stream_with_context
    def generate():
        try:
            for event in _ai_stream_for(data):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as exc:
            app.logger.error("Ошибка потокового запроса ИИ: %s", exc, exc_info=True)
            yield json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False) + "\n"

    return Response(
        generate(),
        mimetype="application/x-ndjson",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.route('/api/ai/compact', methods=['POST'])
def ai_compact():
    """Create a compact factual summary of older local chat messages."""
    data = request.get_json(silent=True) or {}
    history = data.get("chat_history") or []
    if not history:
        return jsonify({"error": "Нет сообщений для сжатия."}), 400
    try:
        # The summariser follows the provider of the chat model.
        chat_model = str(data.get("model") or "").strip() or gemini_chat.DEFAULT_MODEL
        memory_model = providers.memory_model_for(chat_model)
        if providers.provider_for_model(memory_model) == "openai":
            summary = openai_chat.summarize_openai_history(history, memory_model)
        else:
            summary = gemini_chat.summarize_gemini_history(history, memory_model)
        return jsonify({"summary": summary})
    except Exception as exc:
        app.logger.error("Не удалось сжать историю: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500

@app.route('/ask-gemini', methods=['POST'])
def ask_gemini():
    if not gemini_chat.is_ready():
        return jsonify({"error": "Нет доступных ключей Gemini на сервере."}), 503
    try:
        data = request.get_json(silent=True) or {}
        system_prompt = data.get('system_prompt', '')
        chat_history = data.get('chat_history', [])
        model_tier = str(data.get('model_tier') or 'smart')
        model = {'smart': gemini_chat.DEFAULT_MODEL, 'dumb': gemini_chat.MEMORY_MODEL}.get(model_tier, model_tier)

        if not chat_history:
             return jsonify({"error": "История чата не может быть пустой."}), 400

        reply, error = gemini_chat.generate_gemini_response(system_prompt, chat_history, model)

        if error:
            return jsonify({"error": error}), 500
        return jsonify({"reply": reply})
    except Exception as e:
        app.logger.error(f"Ошибка в эндпоинте /ask-gemini: {e}", exc_info=True)
        return jsonify({"error": f"Внутренняя ошибка сервера: {e}"}), 500
    
@app.route('/get-personas', methods=['GET'])
def get_personas():
    """Отдает клиенту содержимое файла personas.json."""
    if not os.path.exists(PERSONAS_JSON_PATH):
        with _file_lock:
            _write_json_atomic(PERSONAS_JSON_PATH, [])
        return jsonify([])
    try:
        with open(PERSONAS_JSON_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    except (IOError, json.JSONDecodeError) as e:
        app.logger.error(f"Ошибка чтения personas.json: {e}")
        return jsonify({"error": "Не удалось прочитать файл персон"}), 500

@app.route('/save-persona', methods=['POST'])
def save_persona():
    """Сохраняет новую или обновляет существующую персону."""
    try:
        persona_data = request.get_json(silent=True)
        if not persona_data or 'id' not in persona_data:
            return jsonify({"error": "Некорректные данные персоны"}), 400

        persona_id = persona_data['id']

        with _file_lock:
            personas = []
            if os.path.exists(PERSONAS_JSON_PATH):
                with open(PERSONAS_JSON_PATH, 'r', encoding='utf-8') as f:
                    personas = json.load(f)

            persona_found = False
            for i, p in enumerate(personas):
                if p.get('id') == persona_id:
                    personas[i] = persona_data
                    persona_found = True
                    break

            if not persona_found:
                personas.append(persona_data)

            _write_json_atomic(PERSONAS_JSON_PATH, personas)

        app.logger.info(f"Персона '{persona_data.get('name')}' (ID: {persona_id}) была сохранена.")
        return jsonify({"status": "success", "persona": persona_data})

    except Exception as e:
        app.logger.error(f"Ошибка сохранения персоны: {e}", exc_info=True)
        return jsonify({"error": "Внутренняя ошибка сервера при сохранении"}), 500
    
@app.route('/create-character', methods=['POST'])
def create_character():
    """
    Создает нового персонажа: режет картинку, создает папку и обновляет JSON.
    """
    try:
        char_name_id = request.form.get('name')
        cut_y_raw = request.form.get('cutY')
        image_file = request.files.get('image')

        if not char_name_id or cut_y_raw is None or image_file is None:
            return jsonify({"error": "Не все данные были предоставлены."}), 400

        try:
            cut_y_percent = float(cut_y_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "Линия разреза должна быть числом."}), 400

        if not (0 < cut_y_percent < 100):
            return jsonify({"error": "Линия разреза должна быть в диапазоне от 0 до 100 (не включая края)."}), 400

        if not char_name_id.replace('_', '').isalnum() or ' ' in char_name_id:
             return jsonify({"error": "Имя должно содержать только латинские буквы, цифры и нижнее подчеркивание."}), 400
        
        char_dir = os.path.join(CHARACTERS_DIR, char_name_id)
        if os.path.exists(char_dir):
            return jsonify({"error": f"Персонаж с именем '{char_name_id}' уже существует."}), 400

        img = Image.open(image_file.stream)
        if img.format != 'PNG':
            return jsonify({"error": "Требуется изображение в формате PNG."}), 400

        width, height = img.size
        cut_y_pixels = int(height * (cut_y_percent / 100.0))

        head_img = img.crop((0, 0, width, cut_y_pixels))
        body_img = img.crop((0, cut_y_pixels, width, height))

        os.makedirs(char_dir)
        head_path_to_save = os.path.join(char_dir, 'head.png')
        body_path_to_save = os.path.join(char_dir, 'body.png')
        
        head_img.save(head_path_to_save, 'PNG')
        body_img.save(body_path_to_save, 'PNG')
        
        app.logger.info(f"Создана папка {char_dir} и сохранены части изображения.")

        new_character = {
            "id": char_name_id,
            "name": char_name_id.replace('_', ' ').title(),
            "images": {
                "head": f"static/characters/{char_name_id}/head.png",
                "body": f"static/characters/{char_name_id}/body.png"
            }
        }

        with _file_lock:
            with open(CHARACTERS_JSON_PATH, 'r', encoding='utf-8') as f:
                characters_data = json.load(f)
            characters_data.append(new_character)
            _write_json_atomic(CHARACTERS_JSON_PATH, characters_data)

        app.logger.info(f"Файл {CHARACTERS_JSON_PATH} обновлен.")

        return jsonify({"status": "success", "name": new_character["name"]})

    except Exception as e:
        app.logger.error(f"Ошибка при создании персонажа: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/synthesize', methods=['POST'])
def synthesize():
    """Synthesise speech: speed up first, then shift pitch by resampling."""
    try:
        data = request.get_json(silent=True) or {}
        text = data.get('text', '')
        lang = data.get('lang', 'ru')
        playback_speed = max(0.5, min(4.0, float(data.get('speed', 1.0))))
        pitch_change = max(0.5, min(4.0, float(data.get('pitch', 1.0))))

        if not text:
            return "No text provided", 400

        tts = gTTS(text=text, lang=lang, slow=False)
        mp3_fp = io.BytesIO()
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)

        audio = AudioSegment.from_file(mp3_fp, format="mp3")

        if abs(playback_speed - 1.0) > 0.01:
            processed_audio = speedup(audio, playback_speed=playback_speed)
        else:
            processed_audio = audio

        final_audio = processed_audio._spawn(processed_audio.raw_data, overrides={
            "frame_rate": int(processed_audio.frame_rate * pitch_change)
        })

        output_buffer = io.BytesIO()
        final_audio.export(output_buffer, format="mp3")
        output_buffer.seek(0)

        return send_file(
            output_buffer,
            mimetype="audio/mpeg",
            as_attachment=False,
            download_name="speech.mp3"
        )

    except Exception as e:
        app.logger.error(f"Error during synthesis: {e}", exc_info=True)
        return f"Failed to synthesize audio: {e}", 500

def _open_panel_when_ready(port):
    """Open the control panel as soon as the server accepts connections."""
    for _ in range(240):
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.25)
    webbrowser.open(f'http://127.0.0.1:{port}/control')


if __name__ == '__main__':
    # The Werkzeug debugger executes arbitrary code, so it stays off unless FLASK_DEBUG=1.
    debug_enabled = os.getenv('FLASK_DEBUG', '0') == '1'
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', '8765'))
    if os.getenv('OPEN_BROWSER', '0') == '1':
        threading.Thread(target=_open_panel_when_ready, args=(port,), daemon=True).start()
    # Polling must not block speech synthesis.
    app.run(host=host, port=port, debug=debug_enabled, threaded=True)
