"""Fallback model chain: every reply starts again from the first model."""

import logging
import re

import gemini_chat
import openai_chat
import openai_models
import providers

DEFAULT_CHAIN = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gpt-5.4', 'gpt-5.4-mini']


def parse_chain(value):
    """A list, or names separated by lines/commas; order and repeats are kept."""
    if isinstance(value, str):
        value = re.split(r'[\s,;]+', value.strip()) if value.strip() else []
    if not isinstance(value, list):
        raise ValueError('Цепочка моделей должна быть списком.')
    result = []
    for item in value:
        if not isinstance(item, str) or not re.fullmatch(r'[a-zA-Z0-9._:/-]+', item.strip()):
            raise ValueError('Некорректное имя модели в цепочке.')
        result.append(item.strip())
    return result


def _provider_stream(model, request, *, strict_budget, try_all_keys):
    if providers.provider_for_model(model) == 'openai':
        return openai_chat.stream_openai_response(
            request['system_prompt'], request['history'], model,
            persona_id=request['persona_id'],
            previous_response_id=request['previous_response_id'],
            previous_key_id=request['previous_key_id'],
            cache_chat=request['cache_chat'],
            context_mode=request['context_mode'],
            compact_threshold=request['compact_threshold'],
            image_data_url=request['image_data_url'],
            thinking=request['thinking'],
            timeout_s=request['timeout_s'],
            try_all_keys_on_error=try_all_keys,
            strict_budget=strict_budget,
        )
    return gemini_chat.stream_gemini_response(
        request['system_prompt'], request['history'], model,
        image_data_url=request['image_data_url'],
        thinking=request['thinking'],
        timeout_s=request['timeout_s'],
        try_all_keys_on_error=try_all_keys,
    )


def stream_reply(request):
    """Yield events of the first model that answers.

    With the chain off only ``request['model']`` is used and its error is raised as is.
    A model that already started speaking is never replaced mid-reply.
    """
    enabled = request['fallback_enabled']
    chain = parse_chain(request['fallback_models']) if enabled else [request['model']]
    if not chain:
        raise ValueError('Цепочка моделей пуста. Добавьте модель в настройках.')
    errors = []
    for position, model in enumerate(chain, 1):
        yield {'type': 'model', 'model': model, 'position': position, 'total': len(chain)}
        emitted = False
        try:
            free_openai = enabled and providers.provider_for_model(model) == 'openai' \
                and openai_models.free_tier_group(model) is not None
            for event in _provider_stream(model, request, strict_budget=free_openai, try_all_keys=enabled):
                emitted |= event.get('type') == 'delta' and bool(event.get('text'))
                yield event
            return
        except Exception as exc:
            if emitted or not enabled:
                raise
            logging.warning('Модель %s из цепочки не ответила: %s', model, exc)
            errors.append(f'{model}: {exc}')
            yield {'type': 'notice', 'text': f'{model}: {exc}. '
                   + ('Пробую следующую модель.' if position < len(chain) else 'Цепочка закончилась.')}
    raise RuntimeError('Все модели цепочки не сработали. ' + '; '.join(errors))
