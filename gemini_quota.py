"""Adapter for the shared gemini_budget library; counters live outside this project.

Without the library the app still works: free models are simply not pre-checked.
"""

try:
    import gemini_budget as _budget
    from gemini_budget.catalog import DEFAULT_LIMITS, CHAT_MODEL_IDS, has_free_quota
    from gemini_budget.core import canonical_model
    AVAILABLE = True
except ImportError:
    _budget = None
    DEFAULT_LIMITS, CHAT_MODEL_IDS, AVAILABLE = {}, (), False

    def has_free_quota(model):
        return False

    def canonical_model(model):
        return (model or '').strip().removeprefix('models/')


def snapshots(keys):
    if not AVAILABLE:
        return {}
    rows = _budget.snapshots(keys)
    return {key: [row for row in values if row['model'] in CHAT_MODEL_IDS and has_free_quota(row['model'])]
            for key, values in rows.items()}


def reserve(key, model, input_tokens=0):
    return _budget.reserve(key, model, input_tokens)


def finish(key, model, reservation, success=False, input_tokens=None, failure=None):
    return _budget.finish(key, model, reservation, success, input_tokens, failure)
