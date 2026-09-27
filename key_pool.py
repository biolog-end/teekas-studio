"""Gemini and OpenAI API key pool with rotation on quota errors.

Keys switch only before the first streamed word: the avatar speaks while the reply
is still being generated.

Google quotas are per model and per project: keys from one project share a limit, so
rotation only helps across projects. OpenAI limits are per model; its free daily volume
is counted in tokens by openai_budget.
"""

import json
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone

import openai
from google import genai
from google.genai import errors as genai_errors

import gemini_quota
import providers

API_KEYS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'api_keys.json')

DEFAULT_MINUTE_COOLDOWN_S = 60
# Zero quota or missing model access needs a project change, not retries every minute.
# Saving the keys clears these pauses at once.
ZERO_QUOTA_COOLDOWN_S = 30 * 60
MODEL_ACCESS_COOLDOWN_S = 5 * 60
FALLBACK_DAILY_COOLDOWN_S = 3600
# 5xx means "model overloaded", not a key problem: wait and repeat before the next key.
SERVER_ERROR_RETRY_DELAYS = (2, 4, 8)
# OpenAI "no credits": re-check every half hour so a topped-up balance is picked up.
INSUFFICIENT_QUOTA_COOLDOWN_S = 30 * 60

_lock = threading.RLock()
_keys = []
_state = {}
_clients = {}
_cursor = 0
_fallback_client = None
_fallback_broken = False


class PoolError(RuntimeError):
    """Every usable key of the provider failed or none is available."""


# --------------------------------------------------------------------------
# Loading and saving
# --------------------------------------------------------------------------

def _blank_state():
    return {
        'cooldown_until': 0.0,
        'cooldown_reason': '',
        'model_cooldowns': {},
        'last_error': '',
        'minute_hits': deque(maxlen=1000),
        'day_stamp': '',
        'day_count': 0,
        'tokens_today': 0,
        'tokens_by_model': {},
        'success_count': 0,
        'fail_count': 0,
    }


def _clean_provider(value):
    value = str(value or '').strip().lower()
    return value if value in providers.PROVIDERS else 'gemini'


def _write_json(path, data):
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def _legacy_entries(data):
    """Legacy format: api_keys (Gemini) plus openai_api_key(s)."""
    entries = []
    gemini = [k for k in data.get('api_keys') or [] if isinstance(k, str) and k.strip()]
    openai_keys = data.get('openai_api_keys') or []
    if isinstance(openai_keys, str):
        openai_keys = [openai_keys]
    if data.get('openai_api_key'):
        openai_keys = [data['openai_api_key'], *openai_keys]
    for provider, values in (('gemini', gemini), ('openai', openai_keys)):
        for index, key in enumerate(dict.fromkeys(k.strip() for k in values if isinstance(k, str) and k.strip())):
            entries.append({'id': f'{provider}{index + 1}', 'label': f'{providers.LABELS[provider]} #{index + 1}',
                            'key': key, 'enabled': True, 'provider': provider})
    return entries


def load_keys():
    """Read keys from disk. Format: {"keys": [{id, label, key, enabled, provider}]}."""
    global _keys
    with _lock:
        try:
            with open(API_KEYS_FILE, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
        except FileNotFoundError:
            data = {}
        except (json.JSONDecodeError, OSError) as exc:
            logging.error(f"Не удалось прочитать {API_KEYS_FILE}: {exc}")
            data = {}
        data = data if isinstance(data, dict) else {}
        raw = data.get('keys')
        migrate = not isinstance(raw, list) and any(k in data for k in ('api_keys', 'openai_api_keys', 'openai_api_key'))
        if migrate:
            raw = _legacy_entries(data)
        cleaned = []
        for index, item in enumerate(raw or []):
            if not isinstance(item, dict) or not str(item.get('key') or '').strip():
                continue
            key_id = str(item.get('id') or f'key{index + 1}')
            cleaned.append({
                'id': key_id,
                'label': item.get('label') or f'Ключ {index + 1}',
                'key': str(item['key']).strip(),
                'enabled': bool(item.get('enabled', True)),
                'provider': _clean_provider(item.get('provider')),
            })
            _state.setdefault(key_id, _blank_state())
        _keys = cleaned
    if migrate:
        save_keys(cleaned)
        logging.info("api_keys.json переведён в новый формат пула ключей.")
    logging.info(f"Пул ключей: загружено {len(_keys)} шт.")
    return _keys


def save_keys(keys):
    """Persist keys, drop cached clients and give every key a fresh chance."""
    global _keys
    with _lock:
        normalized = [{
            'id': str(k['id']),
            'label': str(k.get('label') or ''),
            'key': str(k['key']).strip(),
            'enabled': bool(k.get('enabled', True)),
            'provider': _clean_provider(k.get('provider')),
        } for k in keys]
        try:
            _write_json(API_KEYS_FILE, {'keys': normalized})
        except OSError as exc:
            logging.error(f"Не удалось сохранить {API_KEYS_FILE}: {exc}")
            return False
        _keys = normalized
        _clients.clear()
        for k in normalized:
            st = _state.setdefault(k['id'], _blank_state())
            st['cooldown_until'] = 0.0
            st['cooldown_reason'] = ''
            st['model_cooldowns'] = {}
        return True


def update_from_client(items):
    """Apply the keys editor: existing secrets are referenced by id and never sent back."""
    with _lock:
        known = {k['id']: k for k in _keys}
    result, seen = [], set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            raise ValueError('Некорректная запись ключа.')
        key_id = str(item.get('id') or '').strip()
        secret = str(item.get('key') or '').strip()
        if key_id in known and not secret:
            secret = known[key_id]['key']
        if not secret:
            raise ValueError('У нового ключа нет значения.')
        if re.search(r'\s', secret) or len(secret) < 16:
            raise ValueError('Ключ выглядит неполным: проверьте, что он скопирован целиком.')
        if secret in seen:
            continue
        seen.add(secret)
        provider = _clean_provider(item.get('provider'))
        result.append({'id': key_id if key_id in known else f'{provider}-{uuid.uuid4().hex[:8]}',
                       'label': str(item.get('label') or '').strip()[:60] or f'{providers.LABELS[provider]} #{len(result) + 1}',
                       'key': secret, 'enabled': bool(item.get('enabled', True)), 'provider': provider})
    if not save_keys(result):
        raise OSError('Не удалось записать api_keys.json.')
    return get_status()


def import_from_env():
    """Pick up keys from the environment for providers that have none yet."""
    with _lock:
        present = {k['provider'] for k in _keys}
    env_sources = {
        'gemini': ('GEMINI_API_KEYS', 'GOOGLE_API_KEYS', 'GOOGLE_API_KEY'),
        'openai': ('OPENAI_API_KEYS', 'OPENAI_API_KEY'),
    }
    new_keys = []
    for provider, names in env_sources.items():
        if provider in present:
            continue
        raw = next((os.getenv(name, '') for name in names if os.getenv(name, '').strip()), '')
        parts = [p.strip() for p in re.split(r'[,\s]+', raw) if p.strip()]
        new_keys.extend({'id': f'env-{provider}{i + 1}', 'label': f'{providers.LABELS[provider]} из окружения #{i + 1}',
                         'key': p, 'enabled': True, 'provider': provider} for i, p in enumerate(parts))
    if not new_keys:
        return False
    with _lock:
        combined = list(_keys) + new_keys
    save_keys(combined)
    logging.info(f"Пул ключей: импортировано {len(new_keys)} шт. из переменных окружения.")
    return True


# --------------------------------------------------------------------------
# Quota error parsing
# --------------------------------------------------------------------------

def _pacific_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/Los_Angeles")
    except Exception:
        # tzdata may be missing on Windows.
        return timezone(timedelta(hours=-8))


def _day_stamp(provider):
    """OpenAI resets free tokens at 00:00 UTC, Google at Pacific midnight; never local time."""
    tz = timezone.utc if provider == 'openai' else _pacific_tz()
    return datetime.now(tz).strftime('%Y-%m-%d')


def _next_pacific_midnight_ts():
    tz = _pacific_tz()
    try:
        now = datetime.now(tz)
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=30, microsecond=0)
        return tomorrow.timestamp()
    except Exception:
        return time.time() + FALLBACK_DAILY_COOLDOWN_S


def _parse_duration(value):
    if isinstance(value, dict):
        try:
            return max(float(value.get('seconds', 0)) + float(value.get('nanos', 0)) / 1e9, 0)
        except (TypeError, ValueError):
            return None
    match = re.match(r'^\s*(\d+(?:\.\d+)?)\s*s?\s*$', str(value or ''))
    return float(match.group(1)) if match else None


def _gemini_error_items(err):
    payload = getattr(err, 'details', None)
    if isinstance(payload, dict) and isinstance(payload.get('error'), dict):
        payload = payload['error']
    if isinstance(payload, dict):
        payload = payload.get('details', [])
    return [item for item in payload or [] if isinstance(item, dict)] if isinstance(payload, list) else []


def _quota_details(err):
    """Google's quota report: model, metric, period, explicit value and RetryInfo.

    A missing quotaValue does not mean zero. A daily quota wins over a per-minute one.
    """
    report = {'model': None, 'scope': 'unknown', 'retry_s': None,
              'zero_limit': False, 'violations': [], 'reasons': []}
    for item in _gemini_error_items(err):
        reason = item.get('reason')
        if reason:
            report['reasons'].append(str(reason))
        violations = item.get('violations') or []
        metadata = item.get('metadata')
        if isinstance(metadata, dict) and any(k in metadata for k in ('quota_metric', 'quota_limit', 'quota_limit_value')):
            violation = {'quotaMetric': metadata.get('quota_metric'),
                         'quotaId': metadata.get('quota_limit'),
                         'quotaDimensions': {'model': metadata.get('model'), 'unit': metadata.get('quota_unit')}}
            if 'quota_limit_value' in metadata:
                violation['quotaValue'] = metadata['quota_limit_value']
            violations = [*violations, violation]
        for violation in violations:
            if not isinstance(violation, dict):
                continue
            clean = {k: violation[k] for k in ('quotaId', 'quotaMetric', 'quotaDimensions', 'quotaValue') if k in violation}
            report['violations'].append(clean)
            dims = violation.get('quotaDimensions') or {}
            if not isinstance(dims, dict):
                dims = {}
            report['model'] = report['model'] or dims.get('model')
            metric = ' '.join(str(violation.get(k) or '') for k in ('quotaId', 'quotaMetric')) + ' ' + str(dims.get('unit') or '')
            if re.search(r'per[ _]*day|/d(?:ay)?\b', metric, re.IGNORECASE):
                report['scope'] = 'day'
            elif report['scope'] == 'unknown' and re.search(r'per[ _]*minute|/min\b', metric, re.IGNORECASE):
                report['scope'] = 'minute'
            if 'quotaValue' in violation:
                try:
                    report['zero_limit'] |= float(violation['quotaValue']) == 0
                except (TypeError, ValueError):
                    pass
        if 'retryDelay' in item:
            delay = _parse_duration(item['retryDelay'])
            if delay is not None:
                report['retry_s'] = max(report['retry_s'] or 0, delay)

    # Older responses carry quotaId, limit and retryDelay only in the text.
    text = str(getattr(err, 'message', '') or err)
    if report['scope'] == 'unknown':
        if re.search(r'per\s*day|PerDay', text, re.IGNORECASE):
            report['scope'] = 'day'
        elif re.search(r'per\s*minute|PerMinute', text, re.IGNORECASE):
            report['scope'] = 'minute'
    report['zero_limit'] |= bool(re.search(r'\blimit\s*[:=]\s*0(?:\.0+)?(?=\s|[,;]|\.?(?:\s|$))', text, re.IGNORECASE))
    if report['retry_s'] is None:
        match = re.search(r'retry\w*[\'"]?\s*(?:[:=]|in)\s*[\'"]?(\d+(?:\.\d+)?)\s*s', text, re.IGNORECASE)
        if match:
            report['retry_s'] = float(match.group(1))
    if report['model'] is None:
        match = re.search(r'model[\'"]?\s*:\s*[\'"]?([\w.\-]+)', text)
        if match:
            report['model'] = match.group(1)
    return report


def _parse_quota_error(err, report=None):
    """Which Gemini quota a 429 hit and how long to wait: (model | None, until_ts, reason)."""
    report = report if report is not None else _quota_details(err)
    model, scope, retry_s = report['model'], report['scope'], report['retry_s']
    if report['zero_limit']:
        return model, time.time() + ZERO_QUOTA_COOLDOWN_S, (
            'квота модели для этого проекта равна 0; проверьте доступ и тариф в AI Studio. '
            'Автоматическая перепроверка через 30 мин; сохранение ключей снимает паузу')
    matching = [v for v in report['violations'] if scope == 'unknown' or re.search(
        r'per[ _]*day|/d(?:ay)?\b' if scope == 'day' else r'per[ _]*minute|/min\b',
        str(v.get('quotaId') or '') + ' ' + str(v.get('quotaMetric') or '') + ' ' + str(v.get('quotaDimensions') or ''), re.IGNORECASE)]
    metrics = ' '.join(str(v.get('quotaMetric') or v.get('quotaId') or '') for v in matching)
    if not metrics:
        metrics = str(getattr(err, 'message', '') or '')
    tokens = bool(re.search(r'token', metrics, re.IGNORECASE))
    requests = bool(re.search(r'request', metrics, re.IGNORECASE))
    unit = 'токенов' if tokens and not requests else 'запросов' if requests and not tokens else ''
    if scope == 'day':
        abbreviation = 'TPD' if unit == 'токенов' else 'RPD' if unit == 'запросов' else 'тип метрики не указан'
        return model, _next_pacific_midnight_ts(), f'исчерпана суточная квота ({abbreviation}); сброс в полночь Pacific'
    if scope == 'unknown' and retry_s is None:
        return model, 0, 'Google вернул 429 без типа квоты и срока повтора; локальная пауза не назначена'
    wait = max(retry_s, 1.0) if retry_s is not None else DEFAULT_MINUTE_COOLDOWN_S
    if scope == 'minute':
        abbreviation = 'TPM' if unit == 'токенов' else 'RPM' if unit == 'запросов' else 'тип метрики не указан'
        reason = f'исчерпана минутная квота ({abbreviation})'
    else:
        reason = 'Google вернул 429, но не указал тип квоты'
    return model, time.time() + wait, f'{reason}; повтор через {wait:g} с'


def _openai_wait_seconds(exc):
    """retry-after header or "Please try again in 1.5s / 20s / 1m30s" text."""
    headers = getattr(getattr(exc, 'response', None), 'headers', None)
    raw = headers.get('retry-after') if headers else None
    if raw and str(raw).strip().replace('.', '', 1).isdigit():
        return float(raw)
    text = str(getattr(exc, 'message', '') or exc)
    match = re.search(r'try again in\s*(?:(\d+)m)?\s*(\d+(?:\.\d+)?)\s*(ms|s)\b', text, re.IGNORECASE)
    if match:
        minutes = int(match.group(1) or 0)
        value = float(match.group(2))
        seconds = value / 1000.0 if match.group(3).lower() == 'ms' else value
        return minutes * 60 + seconds
    return None


def _fmt_wait(seconds):
    seconds = max(int(seconds), 0)
    if seconds >= 3600:
        return f"{seconds // 3600} ч {(seconds % 3600) // 60} мин"
    if seconds >= 90:
        return f"{seconds // 60} мин"
    return f"{seconds} с"


def _looks_like_bad_key(code, message):
    if code not in (400, 401, 403):
        return False
    text = (message or '').lower()
    markers = ('api key not valid', 'api_key_invalid', 'invalid api key',
               'api key expired', 'api key was reported as leaked')
    return any(m in text for m in markers)


def _failure(code, message, kind='other', model=None, until=0.0, reason=''):
    """kind: 'quota' wait (key or model), 'bad_key' disable, 'model_unavailable' try another
    project, 'server' repeat, 'other' return the error at once."""
    return {'code': code, 'message': message, 'kind': kind,
            'model': model, 'until': until, 'reason': reason}


def _classify_gemini(exc, model):
    if not isinstance(exc, genai_errors.APIError):
        return None
    code = getattr(exc, 'code', None)
    message = getattr(exc, 'message', None) or str(exc)
    items = _gemini_error_items(exc)

    def failure_result(*args):
        failure = _failure(code, message, *args)
        failure['status'] = getattr(exc, 'status', None)
        failure['api_details'] = items
        return failure
    if code == 429:
        report = _quota_details(exc)
        err_model, until, reason = _parse_quota_error(exc, report)
        # Google may name an internal alias; the requested model is what must be paused.
        failure = failure_result('quota', model or err_model, until, reason)
        failure['report'] = report
        return failure
    reasons = {str(item.get('reason') or '') for item in items}
    if _looks_like_bad_key(code, message) or (code in (400, 401, 403) and reasons & {'API_KEY_INVALID', 'API_KEY_EXPIRED'}):
        return failure_result('bad_key')
    model_error = reasons & {'MODEL_NOT_FOUND', 'MODEL_ACCESS_DENIED', 'MODEL_NOT_AVAILABLE'} or re.search(
        r'(?:\bmodels/[^\s]+|\bmodel\b)[^\n]*(?:not found|not available|no longer available|not supported|does not exist|access denied|permission denied)',
        message, re.IGNORECASE)
    if code in (403, 404) and model and model_error:
        explanation = 'модель недоступна этому проекту'
        if 'new users' in message.lower():
            explanation += '; Google ограничивает её для новых пользователей/проектов — выберите новую модель'
        return failure_result('model_unavailable', model, time.time() + MODEL_ACCESS_COOLDOWN_S,
                              f'{explanation}: {message}. Перепроверка через 5 мин')
    if code in (500, 502, 503, 504):
        return failure_result('server')
    return failure_result()


def _classify_openai(exc, model):
    if isinstance(exc, openai.APIConnectionError):
        return _failure(None, str(exc), 'server')
    if not isinstance(exc, openai.APIStatusError):
        return None
    code = getattr(exc, 'status_code', None)
    message = getattr(exc, 'message', None) or str(exc)
    err_code = str(getattr(exc, 'code', '') or '')
    err_type = str(getattr(exc, 'type', '') or '')
    if code == 429:
        if err_type == 'insufficient_quota' or err_code in ('insufficient_quota', 'credit_balance_exhausted') \
                or 'insufficient_quota' in message:
            # No credits or the free daily volume is gone: this is about the key, not the model.
            return _failure(code, message, 'quota', None, time.time() + INSUFFICIENT_QUOTA_COOLDOWN_S,
                            'нет кредитов (insufficient_quota) — пополните баланс на '
                            'platform.openai.com/settings/organization/billing или включите '
                            '«share traffic with OpenAI» ради бесплатного дневного лимита')
        wait = _openai_wait_seconds(exc) or DEFAULT_MINUTE_COOLDOWN_S
        return _failure(code, message, 'quota', model, time.time() + max(wait, 1.0),
                        f'лимит запросов (RPM/TPM), повтор через {_fmt_wait(wait)}')
    if code == 401:
        return _failure(code, message, 'bad_key')
    if code is not None and code >= 500:
        return _failure(code, message, 'server')
    return _failure(code, message)


def _classify(exc, provider, model):
    if provider == 'openai':
        return _classify_openai(exc, model)
    return _classify_gemini(exc, model)


_HINTS = {
    'gemini': {
        400: "Неверный запрос.",
        403: "Доступ запрещён: ключ не подходит или у него нет прав.",
        404: "Модель или ресурс не найдены — проверьте имя модели.",
        429: "Квоты API исчерпаны.",
        500: "Внутренняя ошибка сервера Gemini.",
        503: "Сервис Gemini временно недоступен.",
        504: "Gemini не успел ответить до срока ожидания. Попробуйте меньший контекст или следующий ключ/модель.",
    },
    'openai': {
        400: "Неверный запрос (например, модель не принимает этот параметр).",
        403: "Доступ запрещён: регион или права ключа.",
        404: "Модель не найдена или недоступна для этого ключа.",
        429: "Лимиты OpenAI исчерпаны.",
        500: "Внутренняя ошибка сервера OpenAI.",
        503: "Сервис OpenAI временно недоступен.",
    },
}


def _describe_failure(failure, provider):
    code = failure['code']
    detail = failure.get('reason') or _HINTS.get(provider, {}).get(code, '')
    return f"Ошибка {providers.LABELS[provider]} {code}: {failure['message']}{(' ' + detail) if detail else ''}"


# --------------------------------------------------------------------------
# Key state
# --------------------------------------------------------------------------

def _provider_of(key_id):
    return next((k['provider'] for k in _keys if k['id'] == key_id), 'gemini')


def _roll_day(st, provider):
    today = _day_stamp(provider)
    if st['day_stamp'] != today:
        st['day_stamp'] = today
        st['day_count'] = 0
        st['tokens_today'] = 0
        st['tokens_by_model'] = {}


def _record_request(key_id):
    st = _state[key_id]
    st['minute_hits'].append(time.time())
    _roll_day(st, _provider_of(key_id))
    st['day_count'] += 1


def _record_usage(key_id, model, tokens):
    if not tokens:
        return
    st = _state[key_id]
    _roll_day(st, _provider_of(key_id))
    st['tokens_today'] += int(tokens)
    if model:
        st['tokens_by_model'][model] = st['tokens_by_model'].get(model, 0) + int(tokens)


def _requests_last_minute(key_id):
    st = _state[key_id]
    cutoff = time.time() - 60
    while st['minute_hits'] and st['minute_hits'][0] < cutoff:
        st['minute_hits'].popleft()
    return len(st['minute_hits'])


def _get_client(entry):
    client = _clients.get(entry['id'])
    if client is None:
        if entry['provider'] == 'openai':
            # max_retries=0: the SDK would otherwise hide 429/5xx from the pool.
            client = openai.OpenAI(api_key=entry['key'], max_retries=0)
        else:
            client = genai.Client(api_key=entry['key'])
        _clients[entry['id']] = client
    return client


def mask_key(key):
    if not key:
        return ''
    if len(key) <= 12:
        return key[:3] + '…'
    return f"{key[:6]}…{key[-4:]}"


def get_status():
    """Pool state for the UI. Secrets never leave the server."""
    with _lock:
        now = time.time()
        quota_error = ''
        try:
            shared_usage = gemini_quota.snapshots([k for k in _keys if k['provider'] == 'gemini'])
        except Exception as exc:
            shared_usage = {}
            quota_error = f'Не удалось прочитать общий учёт Gemini: {exc}'
        items = []
        for k in _keys:
            st = _state.setdefault(k['id'], _blank_state())
            _roll_day(st, k['provider'])
            cooling = st['cooldown_until'] > now
            item = {
                'id': k['id'], 'label': k.get('label', ''), 'masked': mask_key(k['key']),
                'enabled': bool(k.get('enabled', True)), 'provider': k['provider'],
                'cooling_down': cooling,
                'cooldown_left_s': int(st['cooldown_until'] - now) if cooling else 0,
                'cooldown_reason': st['cooldown_reason'] if cooling else '',
                'model_cooldowns': [{'model': m, 'left_s': int(v['until'] - now), 'reason': v['reason']}
                                    for m, v in st['model_cooldowns'].items() if v['until'] > now],
                'last_error': st['last_error'],
                'requests_last_minute': _requests_last_minute(k['id']),
                'requests_today': st['day_count'],
                'tokens_today': st['tokens_today'],
                'success_count': st['success_count'],
                'fail_count': st['fail_count'],
            }
            if k['provider'] == 'gemini':
                item['gemini_usage'] = shared_usage.get(k['id'], [])
                for row in item['gemini_usage']:
                    if row['blocked']:
                        item['model_cooldowns'].append({'model': row['model'], 'left_s': row['left_s'], 'reason': row['reason']})
            items.append(item)
        usable = [i for i in items if i['enabled'] and not i['cooling_down']]
        by_provider = {p: {'total': 0, 'available': 0} for p in providers.PROVIDERS}
        for item in items:
            by_provider[item['provider']]['total'] += 1
        for item in usable:
            by_provider[item['provider']]['available'] += 1
        return {
            'keys': items, 'total': len(items), 'available': len(usable), 'providers': by_provider,
            'using_fallback': not _keys, 'gemini_quota_available': gemini_quota.AVAILABLE,
            'gemini_quota_error': quota_error, 'openai_budget_available': providers.budget() is not None,
        }


def _model_blocked(st, model, now):
    entry = st['model_cooldowns'].get(model) if model else None
    return bool(entry and entry['until'] > now)


def _usable_order(model=None, provider='gemini'):
    """Keys of the provider in round-robin order, skipping paused keys and models."""
    now = time.time()
    ordered = []
    total = len(_keys)
    for offset in range(total):
        entry = _keys[(_cursor + offset) % total]
        if entry['provider'] != provider or not entry.get('enabled', True):
            continue
        st = _state[entry['id']]
        if st['cooldown_until'] > now or _model_blocked(st, model, now):
            continue
        ordered.append(entry)
    return ordered


def _all_busy_message(model, provider):
    now = time.time()
    label = providers.LABELS[provider]
    with _lock:
        mine = [k for k in _keys if k['provider'] == provider]
        enabled = [k for k in mine if k.get('enabled', True)]
        if not mine:
            return f"Нет ключей {label}. Добавьте их в разделе «Ключи и лимиты»."
        if not enabled:
            return f"Все ключи {label} выключены. Включите хотя бы один в разделе «Ключи и лимиты»."
        blockers = []
        for k in enabled:
            st = _state[k['id']]
            if st['cooldown_until'] > now:
                blockers.append((st['cooldown_until'] - now, st['cooldown_reason'], False))
                continue
            mc = st['model_cooldowns'].get(model) if model else None
            if mc:
                blockers.append((mc['until'] - now, mc['reason'], True))
    if not blockers:
        return f"Ключи {label} сейчас недоступны."
    wait, reason, model_specific = min(blockers, key=lambda b: b[0])
    if model_specific:
        return (f"Модель {model} сейчас недоступна на всех ключах {label} ({len(enabled)}): {reason}. "
                f"Ближайшая повторная попытка через {_fmt_wait(wait)} — или выберите другую модель.")
    return f"Все ключи {label} ({len(enabled)}) на паузе: {reason}. Ближайший освободится через {_fmt_wait(wait)}."


def _get_fallback_client():
    """Gemini client from Application Default Credentials when the pool has no Gemini keys."""
    global _fallback_client, _fallback_broken
    if _fallback_client is not None or _fallback_broken:
        return _fallback_client
    try:
        import google.auth
        google.auth.default()
        _fallback_client = genai.Client()
    except Exception:
        _fallback_broken = True
        _fallback_client = None
    return _fallback_client


def get_any_client(provider='gemini'):
    with _lock:
        for entry in _keys:
            if entry['provider'] == provider and entry.get('enabled', True):
                return _get_client(entry)
    return _get_fallback_client() if provider == 'gemini' else None


def is_configured(provider=None):
    with _lock:
        if any(k.get('enabled', True) and (provider is None or k['provider'] == provider) for k in _keys):
            return True
    if provider in (None, 'gemini'):
        return _get_fallback_client() is not None
    return False


# --------------------------------------------------------------------------
# Streaming entry point
# --------------------------------------------------------------------------

def _close(iterator):
    close = getattr(iterator, 'close', None)
    if close:
        try:
            close()
        except Exception:
            pass


def stream_with_rotation(fn, model, *, try_all_keys_on_error=False, input_tokens_estimate=0):
    """Yield the events of ``fn(client, key_id)``, switching keys until the first text arrives.

    ``fn`` yields ``{'type': 'delta', 'text': ...}`` events, may yield one
    ``{'type': 'usage', 'input_tokens': ..., 'total_tokens': ...}`` (consumed here) and
    anything else, which is passed through. Key problems are reported as ``notice``
    events. Once text has been spoken the reply cannot move to another key, so later
    errors are raised as they are.
    """
    global _cursor
    provider = providers.provider_for_model(model)
    with _lock:
        has_pool = any(k['provider'] == provider for k in _keys)
        candidates = _usable_order(model, provider) if has_pool else []

    if not has_pool:
        client = _get_fallback_client() if provider == 'gemini' else None
        if client is None:
            raise PoolError(_all_busy_message(model, provider))
        emitted = False
        try:
            for event in fn(client, None):
                if event.get('type') == 'usage':
                    continue
                emitted |= event.get('type') == 'delta' and bool(event.get('text'))
                yield event
        except Exception as exc:
            failure = None if emitted else _classify(exc, provider, model)
            if failure is None:
                raise
            raise PoolError(_describe_failure(failure, provider)) from exc
        if not emitted:
            raise PoolError(f'Модель {model} вернула пустой ответ.')
        return

    if not candidates:
        raise PoolError(_all_busy_message(model, provider))

    errors_seen = []
    retry_delays = list(SERVER_ERROR_RETRY_DELAYS)
    tracked = provider == 'gemini' and gemini_quota.has_free_quota(gemini_quota.canonical_model(model))
    for entry in candidates:
        key_id, label, secret = entry['id'], entry['label'], entry['key']
        while True:
            reservation = None
            if tracked:
                try:
                    reservation, quota_error = gemini_quota.reserve(secret, model, input_tokens_estimate)
                except Exception as exc:
                    raise PoolError(f'Общий учёт Gemini недоступен: {exc}') from exc
                if quota_error:
                    message = f'{label}: {quota_error}'
                    errors_seen.append(message)
                    yield {'type': 'notice', 'text': message}
                    break
            emitted, usage, iterator = False, {}, None
            try:
                with _lock:
                    client = _get_client(entry)
                    if provider != 'gemini':
                        _record_request(key_id)
                iterator = fn(client, key_id)
                for event in iterator:
                    if event.get('type') == 'usage':
                        usage = event
                        continue
                    emitted |= event.get('type') == 'delta' and bool(event.get('text'))
                    yield event
            except GeneratorExit:
                # The listener went away; whatever was streamed is already billed.
                _close(iterator)
                if tracked:
                    gemini_quota.finish(secret, model, reservation, success=emitted)
                raise
            except Exception as exc:
                _close(iterator)
                failure = _classify(exc, provider, model)
                if tracked:
                    safe = dict(failure, reason=failure.get('reason', '').replace(secret, '[КЛЮЧ]')) if failure and not emitted else None
                    gemini_quota.finish(secret, model, reservation, success=emitted, failure=safe)
                description = (_describe_failure(failure, provider) if failure else str(exc)).replace(secret, '[КЛЮЧ]')
                with _lock:
                    st = _state[key_id]
                    st['fail_count'] += 1
                    st['last_error'] = description[:2000]
                if emitted:
                    raise PoolError(f'Ответ оборвался: {description}') from exc
                logging.warning("Ответ API на ключе '%s': %s", label, description)

                if failure is None:
                    if try_all_keys_on_error:
                        errors_seen.append(f'{label}: {description}')
                        yield {'type': 'notice', 'text': f'{label}: {description}. Пробую следующий ключ.'}
                        break
                    raise PoolError(description) from exc

                if failure['kind'] in ('quota', 'model_unavailable'):
                    target = failure['model']
                    with _lock:
                        if target and not tracked and failure['until'] > time.time():
                            st['model_cooldowns'][target] = {'until': failure['until'], 'reason': failure['reason']}
                        elif not target and failure['until'] > time.time():
                            st['cooldown_until'] = failure['until']
                            st['cooldown_reason'] = failure['reason']
                    errors_seen.append(f'{label}: {description}')
                    yield {'type': 'notice', 'text': f'{label}: {failure["reason"]}. Беру следующий ключ.'}
                    break

                if failure['kind'] == 'bad_key':
                    with _lock:
                        entry['enabled'] = False
                        st['cooldown_reason'] = 'ключ отклонён'
                    logging.error(f"Ключ '{label}' недействителен — выключаю его.")
                    errors_seen.append(f'{label}: {description}')
                    yield {'type': 'notice', 'text': f'{label}: ключ отклонён и выключен.'}
                    break

                if failure['kind'] == 'server':
                    if not try_all_keys_on_error and retry_delays:
                        wait = retry_delays.pop(0)
                        yield {'type': 'notice', 'text': f'Сервер {providers.LABELS[provider]} ответил {failure["code"]}. Повтор через {wait} с.'}
                        time.sleep(wait)
                        continue
                    errors_seen.append(f'{label}: {description}')
                    break

                # A malformed request is not fixed by another project.
                if try_all_keys_on_error:
                    errors_seen.append(f'{label}: {description}')
                    break
                raise PoolError(description) from exc

            if not emitted:
                if tracked:
                    gemini_quota.finish(secret, model, reservation, success=False)
                with _lock:
                    _state[key_id]['fail_count'] += 1
                    _state[key_id]['last_error'] = 'API не вернул готового текстового ответа.'
                if try_all_keys_on_error:
                    errors_seen.append(f'{label}: пустой ответ')
                    break
                raise PoolError(f'Модель {model} вернула пустой ответ.')

            if tracked:
                gemini_quota.finish(secret, model, reservation, success=True, input_tokens=usage.get('input_tokens'))
            with _lock:
                st = _state[key_id]
                st['success_count'] += 1
                st['last_error'] = ''
                if provider == 'gemini':
                    _record_request(key_id)
                _record_usage(key_id, model, usage.get('total_tokens'))
                # The next request starts from the next key to spread the load.
                for index, k in enumerate(_keys):
                    if k['id'] == key_id:
                        _cursor = (index + 1) % len(_keys)
                        break
            return

    detail = '; '.join(errors_seen) if errors_seen else 'причина неизвестна'
    raise PoolError(f"Все доступные ключи {providers.LABELS[provider]} ({len(candidates)}) не сработали. {detail}")
