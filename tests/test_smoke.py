import json
from types import SimpleNamespace

from PIL import Image

import ptt

# Prevent global keyboard hooks while importing the Flask app.
ptt.PttController.start = lambda self: None

import key_pool  # noqa: E402
import main  # noqa: E402
import openai_chat  # noqa: E402
import providers  # noqa: E402


def test_animation_events_are_ordered():
    main._animation_events.clear()
    main._animation_event_id = 0
    client = main.app.test_client()
    client.post('/trigger-animation', json={'job_type': 'summon'})
    client.post('/trigger-animation', json={'job_type': 'tts_append', 'text': 'Привет.'})
    payload = client.get('/animation-events?after=0').get_json()
    assert [event['id'] for event in payload['events']] == [1, 2]
    assert payload['events'][1]['data']['text'] == 'Привет.'


def test_primary_screen_capture_is_kept_in_memory(monkeypatch):
    monkeypatch.setattr(main.ImageGrab, 'grab', lambda all_screens=False: Image.new('RGB', (32, 20), 'black'))
    response = main.app.test_client().post('/capture-screen')
    payload = response.get_json()
    assert response.status_code == 200
    assert main._screen_data_url(payload['screen_id']).startswith('data:image/png;base64,')


def test_stream_endpoint_uses_ndjson(monkeypatch):
    monkeypatch.setattr(main, '_ai_stream_for', lambda _data: iter((
        {'type': 'delta', 'text': 'При'},
        {'type': 'delta', 'text': 'вет'},
        {'type': 'done', 'response_id': 'resp_test'},
    )))
    response = main.app.test_client().post('/api/ai/stream', json={'chat_history': [{'role': 'user'}]})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert ''.join(event.get('text', '') for event in events) == 'Привет'
    assert events[-1]['response_id'] == 'resp_test'


def test_openai_stream_enables_cache_and_records_usage(monkeypatch):
    captured = {}
    recorded = []
    final = SimpleNamespace(id='resp_123', model='gpt-5.4-mini', usage=SimpleNamespace(
        input_tokens=20, output_tokens=4, input_tokens_details=SimpleNamespace(cached_tokens=10)
    ))

    class FakeStream:
        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def __iter__(self):
            return iter((SimpleNamespace(type='response.output_text.delta', delta='Готово'),))
        def get_final_response(self): return final

    class FakeResponses:
        def stream(self, **kwargs):
            captured.update(kwargs)
            return FakeStream()

    class FakeBudget:
        @staticmethod
        def estimate_tokens(*_args, **_kwargs): return 100
        @staticmethod
        def can_spend(*_args, **_kwargs): return True, {}
        @staticmethod
        def record_response(model, response): recorded.append((model, response.id))

    keys = [{'id': 'oa1', 'label': 'OpenAI', 'key': 'sk-test-only-value', 'enabled': True, 'provider': 'openai'}]
    monkeypatch.setattr(key_pool, '_keys', keys)
    monkeypatch.setattr(key_pool, '_state', {'oa1': key_pool._blank_state()})
    monkeypatch.setattr(key_pool, '_get_client', lambda _entry: SimpleNamespace(responses=FakeResponses()))
    monkeypatch.setattr(providers, 'budget', lambda: FakeBudget())
    events = list(openai_chat.stream_openai_response(
        'rules', [{'role': 'user', 'parts': [{'text': 'Привет'}]}], 'gpt-5.4-mini',
        persona_id='persona-test', previous_response_id='resp_old', previous_key_id='oa1', cache_chat=True,
    ))
    assert captured['previous_response_id'] == 'resp_old'
    assert captured['prompt_cache_key'].startswith('voice-app-')
    assert captured['context_management'][0]['type'] == 'compaction'
    assert events[-1]['response_id'] == 'resp_123' and events[-1]['key_id'] == 'oa1'
    assert recorded == [('gpt-5.4-mini', 'resp_123')]

    captured.clear()
    list(openai_chat.stream_openai_response(
        'rules', [{'role': 'user', 'parts': [{'text': 'Привет'}]}], 'gpt-5.4-mini',
        previous_response_id='resp_old', previous_key_id='another-project', cache_chat=True,
    ))
    assert 'previous_response_id' not in captured


def test_hotkeys_are_toggle_actions():
    controller = ptt.PttController()
    controller._activate('microphone')
    assert controller.snapshot()['microphone_active'] is True
    assert controller.snapshot()['summoned'] is True
    controller._activate('microphone')
    assert controller.snapshot()['microphone_active'] is False

