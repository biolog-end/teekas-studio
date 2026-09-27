"""OpenAI Responses API streaming through the shared key pool and the openai_budget tracker."""

from __future__ import annotations

import hashlib
import logging
from typing import Iterable

import key_pool
import openai_models
import providers

DEFAULT_MODEL = openai_models.DEFAULT_MODEL
MEMORY_MODEL = openai_models.MEMORY_MODEL
DEFAULT_COMPACT_THRESHOLD = 30000
DEFAULT_TIMEOUT_S = 60
# A two-sentence reply from a reasoning model still costs hundreds of output tokens.
EXPECTED_OUTPUT_TOKENS = 1200


class OpenAIBudgetError(RuntimeError):
    """Raised before a request that would exceed the free daily allowance."""


def is_ready() -> bool:
    return key_pool.is_configured('openai')


def budget_status(model: str | None = None) -> dict:
    budget = providers.budget()
    if budget is None:
        return {"available": False, "error": "Пакет openai_budget не установлен в окружении приложения."}
    try:
        result = {"available": True, **budget.status()}
        result["selected_group"] = budget.group_for(model) if model else None
        return result
    except Exception as exc:
        logging.warning("Не удалось прочитать openai_budget: %s", exc)
        return {"available": False, "error": str(exc)}


def _message_text(message: dict) -> str:
    parts = message.get("parts") or []
    return str(parts[0].get("text") or "") if parts else ""


def _input_from_history(history: list[dict], image_data_url: str | None = None) -> list[dict]:
    result: list[dict] = []
    last_user_index = max((i for i, item in enumerate(history) if item.get("role") != "model"), default=-1)
    for index, message in enumerate(history):
        role = "assistant" if message.get("role") == "model" else "user"
        attach_image = bool(image_data_url and index == last_user_index and role == "user")
        if (message.get("meta") or {}).get("system") and not attach_image:
            role = "developer"
        text = _message_text(message)
        if attach_image:
            result.append({"role": role, "content": [
                {"type": "input_text", "text": text or "Что видно на изображении?"},
                {"type": "input_image", "image_url": image_data_url, "detail": "auto"},
            ]})
        else:
            result.append({"role": role, "content": text})
    return result


def _last_user_input(history: list[dict], image_data_url: str | None = None) -> list[dict]:
    for message in reversed(history):
        if message.get("role") != "model":
            return _input_from_history([message], image_data_url)
    return _input_from_history(history[-1:], image_data_url)


def _cache_key(persona_id: str) -> str:
    digest = hashlib.sha256((persona_id or "default").encode("utf-8")).hexdigest()[:24]
    return f"voice-app-{digest}"


def check_budget(model: str, system_prompt: str, history: list[dict], has_image: bool, strict: bool = False) -> None:
    """Refuse a request that would cross the free daily limit (openai_budget, shared by all projects).

    ``strict`` — used by the fallback chain: an unknown remainder also refuses the request.
    """
    budget = providers.budget()
    if budget is None:
        if strict:
            raise OpenAIBudgetError("Бесплатный остаток OpenAI неизвестен: openai_budget не установлен.")
        return
    text = system_prompt + "\n" + "\n".join(_message_text(item) for item in history)
    try:
        estimate = budget.estimate_tokens(text, images=1 if has_image else 0, expected_output=EXPECTED_OUTPUT_TOKENS)
        ok, info = budget.can_spend(model, estimate)
    except Exception as exc:
        logging.warning("openai_budget не смог проверить лимит: %s", exc)
        if strict:
            raise OpenAIBudgetError(f"Бесплатный остаток OpenAI не удалось проверить: {exc}") from exc
        return
    if not ok:
        raise OpenAIBudgetError(f"Запрос к OpenAI отменён: {info.get('reason') or 'лимит исчерпан'}")


def stream_openai_response(
    system_prompt: str,
    chat_history: list[dict],
    model: str = DEFAULT_MODEL,
    *,
    persona_id: str = "default",
    previous_response_id: str | None = None,
    previous_key_id: str | None = None,
    cache_chat: bool = True,
    context_mode: str = "summarize",
    compact_threshold: int = DEFAULT_COMPACT_THRESHOLD,
    image_data_url: str | None = None,
    thinking: bool = False,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    try_all_keys_on_error: bool = False,
    strict_budget: bool = False,
) -> Iterable[dict]:
    """Yield ``delta`` and pool ``notice`` events, then one ``done`` with the response id."""
    if not chat_history:
        raise ValueError("История чата пуста.")
    model = (model or DEFAULT_MODEL).strip()
    budget = providers.budget()
    # A chained response is still billed for the whole context, so estimate all of it.
    check_budget(model, system_prompt, chat_history, bool(image_data_url), strict=strict_budget)
    final = {}

    def request(client, key_id):
        # A stored response only exists in the project that created it.
        use_previous = bool(cache_chat and previous_response_id and key_id and key_id == previous_key_id)
        history = _last_user_input(chat_history, image_data_url) if use_previous \
            else _input_from_history(chat_history, image_data_url)
        params = {
            "model": model,
            "instructions": system_prompt or None,
            "input": history,
            "store": bool(cache_chat),
            "prompt_cache_key": _cache_key(persona_id) if cache_chat else None,
            "previous_response_id": previous_response_id if use_previous else None,
            "timeout": max(5.0, float(timeout_s)),
        }
        if thinking and openai_models.supports_reasoning(model):
            params["reasoning"] = {"effort": "high"}
        if cache_chat and context_mode == "summarize":
            params["context_management"] = [{
                "type": "compaction",
                "compact_threshold": max(8000, int(compact_threshold or DEFAULT_COMPACT_THRESHOLD)),
            }]
        params = {key: value for key, value in params.items() if value is not None}
        with client.responses.stream(**params) as stream:
            for event in stream:
                if event.type == "response.output_text.delta" and event.delta:
                    yield {"type": "delta", "text": event.delta}
            response = stream.get_final_response()
        if budget is not None:
            try:
                budget.record_response(model, response)
            except Exception as exc:
                logging.warning("Не удалось записать расход OpenAI: %s", exc)
        final.update(response_id=getattr(response, "id", None), model=getattr(response, "model", model), key_id=key_id)
        usage = getattr(response, "usage", None)
        yield {"type": "usage", "input_tokens": getattr(usage, "input_tokens", None),
               "total_tokens": getattr(usage, "total_tokens", None)}

    logging.info("Запрос к OpenAI '%s'...", model)
    yield from key_pool.stream_with_rotation(request, model, try_all_keys_on_error=try_all_keys_on_error)
    yield {"type": "done", **final}


def summarize_openai_history(history: list[dict], model: str = MEMORY_MODEL) -> str:
    transcript = "\n".join(
        f"{'Пользователь' if item.get('role') != 'model' else 'Ассистент'}: {_message_text(item)}"
        for item in history)
    summary_history = [{"role": "user", "parts": [{"text": "Сожми диалог, сохрани факты, договорённости, имена и незавершённые темы:\n" + transcript}]}]
    chunks = [event["text"] for event in stream_openai_response(
        "Верни краткую фактическую сводку без вступления.", summary_history, model,
        cache_chat=False, context_mode="truncate") if event.get("type") == "delta"]
    return "".join(chunks).strip()
