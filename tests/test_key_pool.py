import json
import time
from types import SimpleNamespace

import httpx
import openai
import pytest
from google.genai import errors

import gemini_quota
import key_pool
import model_fallbacks
import providers

GENERIC = ('You exceeded your current quota, please check your plan and billing details. '
           'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.')
UNTRACKED = 'gemini-test-model'


def quota_err(model, scope='minute', retry='40s', value='20'):
    qid = {'day': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
           'minute': 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}[scope]
    return errors.APIError(429, {'error': {'code': 429, 'message': GENERIC, 'status': 'RESOURCE_EXHAUSTED', 'details': [
        {'@type': 'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [
            {'quotaMetric': 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
             'quotaId': qid, 'quotaDimensions': {'model': model, 'location': 'global'}, 'quotaValue': value}]},
        {'@type': 'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': retry}]}})


def openai_err(status, body):
    request = httpx.Request('POST', 'https://api.openai.com/v1/responses')
    response = httpx.Response(status, request=request, json=body)
    cls = {429: openai.RateLimitError, 401: openai.AuthenticationError}[status]
    return cls(body['error']['message'], response=response, body=body['error'])


@pytest.fixture
def pool(monkeypatch):
    def setup(*providers_list):
        keys = [{'id': f'k{i}', 'label': f'K{i}', 'key': f'secret-key-number-{i}', 'enabled': True, 'provider': p}
                for i, p in enumerate(providers_list, 1)]
        monkeypatch.setattr(key_pool, '_keys', keys)
        monkeypatch.setattr(key_pool, '_state', {k['id']: key_pool._blank_state() for k in keys})
        monkeypatch.setattr(key_pool, '_clients', {})
        monkeypatch.setattr(key_pool, '_cursor', 0)
        monkeypatch.setattr(key_pool, '_get_client', lambda entry: entry['id'])
        monkeypatch.setattr(key_pool.time, 'sleep', lambda _s: None)
        return keys
    return setup


def run(generator):
    events = list(generator)
    return ''.join(e['text'] for e in events if e['type'] == 'delta'), events


def replying(behaviour):
    """behaviour: key id -> exception to raise, or text to stream."""
    calls = []

    def fn(client, key_id):
        calls.append(key_id)
        outcome = behaviour[key_id]
        if isinstance(outcome, list):
            outcome = outcome.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        for word in outcome.split():
            yield {'type': 'delta', 'text': word + ' '}
        yield {'type': 'usage', 'input_tokens': 10, 'total_tokens': 15}
    return fn, calls


def test_minute_quota_moves_to_next_key_and_pauses_that_model(pool):
    pool('gemini', 'gemini')
    fn, calls = replying({'k1': quota_err(UNTRACKED, 'minute', '40s'), 'k2': 'Привет мир'})
    text, events = run(key_pool.stream_with_rotation(fn, UNTRACKED))
    assert text.strip() == 'Привет мир' and calls == ['k1', 'k2']
    assert any(e['type'] == 'notice' and 'минутная квота' in e['text'] for e in events)
    left = key_pool._state['k1']['model_cooldowns'][UNTRACKED]['until'] - time.time()
    assert 35 < left <= 40
    assert key_pool._state['k1']['cooldown_until'] == 0


def test_daily_quota_waits_until_pacific_midnight(pool):
    pool('gemini', 'gemini')
    fn, _ = replying({'k1': quota_err(UNTRACKED, 'day'), 'k2': 'ok'})
    run(key_pool.stream_with_rotation(fn, UNTRACKED))
    until = key_pool._state['k1']['model_cooldowns'][UNTRACKED]['until']
    assert until - time.time() > 60 and until == pytest.approx(key_pool._next_pacific_midnight_ts(), abs=5)


def test_zero_quota_is_reported_and_paused_for_half_an_hour(pool):
    pool('gemini', 'gemini')
    fn, _ = replying({'k1': quota_err(UNTRACKED, 'day', value='0'), 'k2': 'ok'})
    run(key_pool.stream_with_rotation(fn, UNTRACKED))
    entry = key_pool._state['k1']['model_cooldowns'][UNTRACKED]
    assert 'равна 0' in entry['reason'] and entry['until'] - time.time() > 25 * 60


def test_error_after_speech_started_is_not_retried(pool):
    pool('gemini', 'gemini')
    calls = []

    def fn(client, key_id):
        calls.append(key_id)
        yield {'type': 'delta', 'text': 'Начало '}
        raise errors.APIError(503, {'error': {'code': 503, 'message': 'overloaded', 'status': 'UNAVAILABLE'}})
    with pytest.raises(key_pool.PoolError, match='оборвался'):
        run(key_pool.stream_with_rotation(fn, UNTRACKED))
    assert calls == ['k1']


def test_server_error_repeats_same_key_first(pool):
    pool('gemini', 'gemini')
    overloaded = errors.APIError(503, {'error': {'code': 503, 'message': 'The model is overloaded.', 'status': 'UNAVAILABLE'}})
    fn, calls = replying({'k1': [overloaded, 'готово'], 'k2': 'другой'})
    text, _ = run(key_pool.stream_with_rotation(fn, UNTRACKED))
    assert text.strip() == 'готово' and calls == ['k1', 'k1']


def test_invalid_key_is_disabled(pool):
    pool('gemini', 'gemini')
    bad = errors.APIError(400, {'error': {'code': 400, 'message': 'API key not valid. Please pass a valid API key.',
                                          'status': 'INVALID_ARGUMENT', 'details': [{'reason': 'API_KEY_INVALID'}]}})
    fn, _ = replying({'k1': bad, 'k2': 'ok'})
    run(key_pool.stream_with_rotation(fn, UNTRACKED))
    assert key_pool._keys[0]['enabled'] is False


def test_empty_reply_is_an_error(pool):
    pool('gemini')
    fn, _ = replying({'k1': ''})
    with pytest.raises(key_pool.PoolError, match='пустой ответ'):
        run(key_pool.stream_with_rotation(fn, UNTRACKED))


def test_openai_without_credits_pauses_the_whole_key(pool):
    pool('openai', 'openai')
    no_credits = openai_err(429, {'error': {'message': 'You exceeded your current quota', 'type': 'insufficient_quota',
                                            'code': 'insufficient_quota'}})
    fn, calls = replying({'k1': no_credits, 'k2': 'ok'})
    run(key_pool.stream_with_rotation(fn, 'gpt-5.4-mini'))
    assert calls == ['k1', 'k2'] and key_pool._state['k1']['cooldown_until'] - time.time() > 25 * 60


def test_openai_rate_limit_uses_retry_hint(pool):
    pool('openai', 'openai')
    limited = openai_err(429, {'error': {'message': 'Rate limit reached. Please try again in 1m30s.', 'type': 'requests',
                                         'code': 'rate_limit_exceeded'}})
    fn, _ = replying({'k1': limited, 'k2': 'ok'})
    run(key_pool.stream_with_rotation(fn, 'gpt-5.4-mini'))
    left = key_pool._state['k1']['model_cooldowns']['gpt-5.4-mini']['until'] - time.time()
    assert 85 < left <= 90


def test_tracked_models_reserve_and_finish_in_shared_budget(pool, monkeypatch):
    pool('gemini')
    log = []
    monkeypatch.setattr(gemini_quota, 'has_free_quota', lambda model: True)
    monkeypatch.setattr(gemini_quota, 'reserve', lambda key, model, tokens=0: (log.append(('reserve', model, tokens)) or 'r1', None))
    monkeypatch.setattr(gemini_quota, 'finish', lambda key, model, rid, success=False, input_tokens=None, failure=None:
                        log.append(('finish', rid, success, input_tokens)))
    fn, _ = replying({'k1': 'ответ'})
    run(key_pool.stream_with_rotation(fn, 'gemini-3.6-flash', input_tokens_estimate=42))
    assert log == [('reserve', 'gemini-3.6-flash', 42), ('finish', 'r1', True, 10)]


def test_legacy_keys_file_is_migrated(tmp_path, monkeypatch):
    path = tmp_path / 'api_keys.json'
    path.write_text(json.dumps({'api_keys': ['gemini-secret-aaaaaaaa', 'gemini-secret-aaaaaaaa', 'gemini-secret-bbbbbbbb'],
                                'openai_api_key': 'sk-proj-cccccccccccccccc'}), encoding='utf-8')
    monkeypatch.setattr(key_pool, 'API_KEYS_FILE', str(path))
    monkeypatch.setattr(key_pool, '_state', {})
    keys = key_pool.load_keys()
    assert [(k['provider'], k['key'][-4:]) for k in keys] == [('gemini', 'aaaa'), ('gemini', 'bbbb'), ('openai', 'cccc')]
    assert list(json.loads(path.read_text(encoding='utf-8'))) == ['keys']


def test_key_editor_never_needs_or_returns_secrets(tmp_path, monkeypatch, pool):
    pool('gemini', 'openai')
    monkeypatch.setattr(key_pool, 'API_KEYS_FILE', str(tmp_path / 'api_keys.json'))
    status = key_pool.update_from_client([
        {'id': 'k1', 'label': 'Основной', 'provider': 'gemini', 'enabled': False},
        {'id': '', 'label': '', 'provider': 'gemini', 'key': 'AIza-new-secret-value-123'},
    ])
    saved = json.loads((tmp_path / 'api_keys.json').read_text(encoding='utf-8'))['keys']
    assert [k['key'] for k in saved] == ['secret-key-number-1', 'AIza-new-secret-value-123']
    assert saved[0]['enabled'] is False and saved[0]['label'] == 'Основной'
    dump = json.dumps(status)
    assert 'secret-key-number-1' not in dump and 'AIza-new-secret-value-123' not in dump
    with pytest.raises(ValueError):
        key_pool.update_from_client([{'id': '', 'provider': 'gemini', 'key': 'short'}])


def _request(**overrides):
    base = dict(model='gemini-a', fallback_enabled=True, fallback_models=['gemini-a', 'gemini-b'], system_prompt='',
                history=[{'role': 'user', 'parts': [{'text': 'hi'}]}], image_data_url=None, thinking=False,
                timeout_s=60, persona_id='p', previous_response_id=None, previous_key_id=None, cache_chat=True,
                context_mode='summarize', compact_threshold=30000)
    base.update(overrides)
    return base


def test_chain_moves_to_next_model_before_speech(monkeypatch):
    seen = []

    def fake(model, request, *, strict_budget, try_all_keys):
        seen.append((model, try_all_keys))
        if model == 'gemini-a':
            raise key_pool.PoolError('Модель gemini-a сейчас недоступна на всех ключах')
        yield {'type': 'delta', 'text': 'ответ'}
    monkeypatch.setattr(model_fallbacks, '_provider_stream', fake)
    text, events = run(model_fallbacks.stream_reply(_request()))
    assert text == 'ответ' and seen == [('gemini-a', True), ('gemini-b', True)]
    assert [e['model'] for e in events if e['type'] == 'model'] == ['gemini-a', 'gemini-b']


def test_chain_off_raises_the_single_model_error(monkeypatch):
    def fake(model, request, **_):
        raise key_pool.PoolError('нет ключей')
        yield
    monkeypatch.setattr(model_fallbacks, '_provider_stream', fake)
    with pytest.raises(key_pool.PoolError):
        run(model_fallbacks.stream_reply(_request(fallback_enabled=False)))


def test_chain_marks_free_gpt_models_as_strict(monkeypatch):
    flags = {}

    def fake(model, request, *, strict_budget, try_all_keys):
        flags[model] = strict_budget
        raise key_pool.PoolError('fail')
        yield
    monkeypatch.setattr(model_fallbacks, '_provider_stream', fake)
    with pytest.raises(RuntimeError, match='Все модели цепочки'):
        run(model_fallbacks.stream_reply(_request(fallback_models=['gpt-5.4', 'gemini-a', 'gpt-5.4-mini'])))
    assert flags == {'gpt-5.4': True, 'gemini-a': False, 'gpt-5.4-mini': True}


def test_provider_is_inferred_from_the_model_name():
    assert providers.provider_for_model('gpt-5.4-mini') == 'openai'
    assert providers.provider_for_model('gemini-3.6-flash') == 'gemini'
    assert model_fallbacks.parse_chain('gemini-3.6-flash\ngpt-5.4, gpt-5.4-mini') == ['gemini-3.6-flash', 'gpt-5.4', 'gpt-5.4-mini']
