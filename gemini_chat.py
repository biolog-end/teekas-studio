"""Gemini streaming through the shared key pool."""

import base64
import datetime
import logging

from google.genai import types

import gemini_models
import key_pool

DEFAULT_MODEL = gemini_models.DEFAULT_MODEL
MEMORY_MODEL = gemini_models.MEMORY_MODEL
DEFAULT_TIMEOUT_S = 60

# finish_reason values that mean a safety filter cut the reply, not the model finishing it.
SAFETY_FINISH_REASONS = ('SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'BLOCKLIST', 'SPII')


def is_ready():
    return key_pool.is_configured('gemini')


def build_config(system_prompt, model, thinking=False, timeout_s=DEFAULT_TIMEOUT_S):
    parts = {}
    if system_prompt:
        # The date goes last so the stable prompt prefix stays cacheable.
        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
        parts['system_instruction'] = [types.Part.from_text(text=f"{system_prompt}\n[Текущая дата: {now}]")]
    name = model.removeprefix('models/')
    if name.startswith('gemma-4-'):
        parts['thinking_config'] = types.ThinkingConfig(thinking_level='HIGH' if thinking else 'MINIMAL')
    elif thinking and gemini_models.supports_thinking(name):
        parts['thinking_config'] = (types.ThinkingConfig(thinking_level='HIGH') if name.startswith('gemini-3')
                                    else types.ThinkingConfig(thinking_budget=-1))
    # The avatar speaks as soon as the first sentence arrives: minimal thinking halves that wait.
    elif name.startswith('gemini-3') and 'flash' in name:
        parts['thinking_config'] = types.ThinkingConfig(thinking_level='MINIMAL')
    elif name.startswith('gemini-2.5-flash'):
        parts['thinking_config'] = types.ThinkingConfig(thinking_budget=0)
    parts['http_options'] = types.HttpOptions(timeout=int(max(5, timeout_s) * 1000),
                                              retry_options=types.HttpRetryOptions(attempts=1))
    return types.GenerateContentConfig(**parts)


def history_contents(chat_history, image_data_url=None):
    history = list(chat_history)
    # The API rejects a conversation that ends on the model's turn.
    if history and history[-1].get('role') == 'model':
        history.append({'role': 'user', 'parts': [{'text': '[собеседник молчит]'}]})
    last_user = max((i for i, item in enumerate(history) if item.get('role') != 'model'), default=-1)
    contents = []
    for index, message in enumerate(history):
        role = 'model' if message.get('role') == 'model' else 'user'
        text = str(((message.get('parts') or [{}])[0]).get('text') or '')
        if (message.get('meta') or {}).get('system'):
            text = '{Системный текст: ' + text + '}'
        parts = [types.Part.from_text(text=text)]
        if image_data_url and index == last_user:
            header, encoded = image_data_url.split(',', 1)
            mime_type = header.split(';', 1)[0].split(':', 1)[-1] or 'image/png'
            parts.append(types.Part.from_bytes(data=base64.b64decode(encoded), mime_type=mime_type))
        contents.append(types.Content(role=role, parts=parts))
    return contents


def estimate_input_tokens(system_prompt, chat_history, has_image=False):
    """Rough TPM pre-check; Google's prompt_token_count replaces it after the reply."""
    text = (system_prompt or '') + ''.join(str(((m.get('parts') or [{}])[0]).get('text') or '') for m in chat_history)
    return (len(text.encode('utf-8')) + 2) // 3 + (1024 if has_image else 0)


def stream_gemini_response(system_prompt, chat_history, model=DEFAULT_MODEL, *, image_data_url=None,
                           thinking=False, timeout_s=DEFAULT_TIMEOUT_S, try_all_keys_on_error=False):
    """Yield ``delta`` events, pool ``notice`` events and a final ``done``."""
    if not chat_history:
        raise ValueError('История чата пуста.')
    model = (model or DEFAULT_MODEL).strip().removeprefix('models/')
    retired = gemini_models.is_retired(model)
    if retired:
        raise ValueError(f"Модель '{model}' больше не поддерживается Google. {retired}")
    contents = history_contents(chat_history, image_data_url)
    config = build_config(system_prompt, model, thinking, timeout_s)

    def request(client, _key_id):
        usage, finish = None, None
        for chunk in client.models.generate_content_stream(model=model, contents=contents, config=config):
            usage = getattr(chunk, 'usage_metadata', None) or usage
            candidate = (getattr(chunk, 'candidates', None) or [None])[0]
            reason = getattr(getattr(candidate, 'finish_reason', None), 'name', None)
            finish = reason or finish
            text = chunk.text if candidate is not None else None
            if text:
                yield {'type': 'delta', 'text': text}
        if finish in SAFETY_FINISH_REASONS:
            raise RuntimeError(f'Заблокировано Gemini: {finish}.')
        yield {'type': 'usage', 'input_tokens': getattr(usage, 'prompt_token_count', None),
               'total_tokens': getattr(usage, 'total_token_count', None)}

    logging.info(f"Запрос к Gemini '{model}'...")
    yield from key_pool.stream_with_rotation(
        request, model, try_all_keys_on_error=try_all_keys_on_error,
        input_tokens_estimate=estimate_input_tokens(system_prompt, chat_history, bool(image_data_url)))
    yield {'type': 'done', 'model': model}


def generate_gemini_response(system_prompt, chat_history, model=DEFAULT_MODEL):
    """Non-streaming wrapper kept for the legacy /ask-gemini endpoint: (text, error)."""
    try:
        text = ''.join(event['text'] for event in stream_gemini_response(system_prompt, chat_history, model)
                       if event.get('type') == 'delta').strip()
        return (text, None) if text else (None, 'Модель вернула пустой текст.')
    except Exception as exc:
        return None, str(exc)


def summarize_gemini_history(history, model=MEMORY_MODEL):
    transcript = '\n'.join(
        f"{'Пользователь' if item.get('role') != 'model' else 'Ассистент'}: "
        f"{((item.get('parts') or [{}])[0].get('text') or '')}"
        for item in history)
    chunks = [event['text'] for event in stream_gemini_response(
        'Сожми диалог. Сохрани факты, договорённости, имена и незавершённые темы. '
        'Верни только краткую фактическую сводку.',
        [{'role': 'user', 'parts': [{'text': transcript}]}], model) if event.get('type') == 'delta']
    return ''.join(chunks).strip()
