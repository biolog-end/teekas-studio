# Teekas Studio

**English** | [Русский](README.ru.md)

A local 2D avatar for streamers. Your character lives in OBS as a transparent browser
source, talks with Gemini or OpenAI in real time, reacts with emotions and soundboard
effects, and is driven from a web control panel or global hotkeys (Stream Deck
friendly). The interface is in Russian; section names below are given in both languages.

## Features

- **Talking avatar** — a head/body cut-out that moves with the voice. Eight motion
  styles, from a soft jelly deformer to dynamic body rotation.
- **Live AI replies** — the reply is spoken sentence by sentence while it is still
  streaming, so the character starts talking before the whole answer is written.
- **Emotions** — the model inserts `emotion(...)` commands, and the avatar answers with
  anime-style marks around its head (sparkles, anger vein, sweat drop, rain cloud,
  thought bubble…) and matching body acting.
- **Soundboard** — `soundboard(...)` commands or panel buttons play effects over the
  speech, each with its own full-screen animation.
- **Voice and screen** — talk to the character through the microphone (browser speech
  recognition), or send it a screenshot of your primary monitor to comment on.
- **Several API keys** — keys rotate automatically when a quota runs out, and a
  fallback model chain keeps the stream from going silent.
- **Character workshop** — upload a PNG, set the neck line, and the image is split into
  head and body.
- **Scene editor** — drag the character on a 16:9 preview, resize or flip it, and place
  the subtitles. Positions are stored in percent, so they survive resolution changes.
- Light and dark themes.

## Requirements

- Windows 10/11. Global hotkeys, the launcher and screen capture are built for Windows.
- Python 3.10 or newer.
- [FFmpeg](https://ffmpeg.org/) in `PATH`, used to change voice speed and pitch.
- Google Chrome or Microsoft Edge, for speech recognition in the panel.
- A Gemini API key ([Google AI Studio](https://aistudio.google.com/apikey)), an OpenAI
  API key, or both.

## Quick start

1. Clone the repository.
2. Run **`Teekas Studio.bat`**. On the first run it installs the dependencies from
   `requirements.txt`. Then it starts the server and opens the control panel as soon
   as it is ready. If the studio is already running, it only opens the panel.
3. Open **Keys and limits** («Ключи и лимиты») in the panel and add your API keys.
4. Press **Summon character** («Призвать персонажа») and write or say something.

Keep the console window open while you stream: closing it stops the server.

Manual start:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python main.py
```

| Page | URL |
| --- | --- |
| Control panel | `http://127.0.0.1:8765/control` |
| OBS view | `http://127.0.0.1:8765/animation` |
| Character workshop | `http://127.0.0.1:8765/creator` |

## OBS setup

1. Add a **Browser Source** with the URL `http://127.0.0.1:8765/animation`.
2. Set its size to your canvas size, for example 1920×1080. The page is transparent.
3. Tick **Control audio via OBS** if you want the voice and effects in the stream mix.
4. Place the character and the subtitles in **Voice and look** («Голос и образ»).

## AI keys and models

- **Keys** are stored locally in `api_keys.json`. The browser only ever receives a
  masked value. See `api_keys.example.json` for the format. On the first run, keys from
  the `GEMINI_API_KEYS`, `GOOGLE_API_KEYS`, `GOOGLE_API_KEY`, `OPENAI_API_KEYS` or
  `OPENAI_API_KEY` environment variables are imported.
- **Rotation.** Requests go round-robin.
  - After a Gemini `429`, the key rests for that model: until Pacific midnight for a
    daily quota, for the `retryDelay` given for a per-minute one, and 30 minutes when
    the quota is zero.
  - OpenAI "no credits" pauses the whole key; other rate limits follow `retry-after`.
  - A rejected key is disabled, and `5xx` errors are retried after 2, 4 and 8 seconds.
  - A key is only switched before the first word of a reply is spoken.
  - Google counts quotas per project, not per key: rotation helps only across different
    projects.
- **Fallback chain** (**Character and AI**, «Характер и ИИ»): every reply starts from the first model.
  If it is unavailable on every key, the next one answers. Default:
  `gemini-3.6-flash → gemini-3.5-flash → gemini-3.5-flash-lite → gpt-5.4 → gpt-5.4-mini`.
- **Thinking.** It is off by default: Gemini Flash models then use minimal thinking, so
  the first sentence arrives about twice as fast. Turn on **Think before answering**
  («Размышлять перед ответом») for deeper replies.
- **Memory.** Long conversations are either summarised, trimmed or kept whole,
  depending on the persona settings.
- **Quota trackers** (optional). If the `gemini_budget` and `openai_budget` packages are
  installed, Gemini requests are reserved against the free daily quota, OpenAI requests
  are checked against the free daily token budget, and the panel shows what is left.
  Without them everything still works, just without the pre-checks.

## Emotions and sound effects

The model writes commands right inside its reply. They are cut out of the speech and
fire at the matching moment:

```text
emotion(surprised) Seriously? soundboard(vine_boom) emotion(excited) That's the best news today!
```

| Emotion | Command | Look |
| --- | --- | --- |
| Calm | `emotion(neutral)` | a soft settle |
| Delight | `emotion(excited)` | sparkles and hops |
| Fun | `emotion(bouncy)` | music notes and a springy sway |
| Anger | `emotion(tense)` | anger vein, steam, trembling |
| Embarrassment | `emotion(wobbly)` | sweat drop and a spiral |
| Sadness | `emotion(sad)` | rain cloud over the head |
| Surprise | `emotion(surprised)` | a jolt and a big "!" |
| Tenderness | `emotion(love)` | floating hearts |
| Thinking | `emotion(thinking)` | thought bubble |

Sound effects: `bad_to_the_bone`, `social_credit`, `discord_call`, `falling_pipe`,
`to_be_continued`, `vine_boom`, `answer_42`. They are listed in
`static/special_effects.json`. The files `to-be-continued.mp3`, `vine-boom.mp3` and
`42.mp3` are not included: put your own files with these names into `static/sfx/`.
Until then those effects only show their animation. For the Falling Pipe effect you can
drop pipe images into `static/img/pipes/`.

The rules for the model are added to every request automatically. You can read them in
**Character and AI → Emotion and sound rules** («Правила эмоций и звуковых эффектов»).

## Hotkeys

| Action | Default |
| --- | --- |
| Microphone on/off | `Ctrl+Alt+M` |
| Summon / dismiss the character | `Ctrl+Alt+B` |
| Send a screenshot of the primary monitor | `Ctrl+Alt+S` |

Change them in **Hotkeys** («Горячие клавиши»). A chord needs two modifiers (Ctrl, Alt,
Shift, Win) and one regular key; F-keys are not accepted. The hotkeys work in any app
while the server is running; the panel tab must stay open, but it can be in the
background. The browser asks for microphone access once.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8765` | Server port |
| `HOST` | `0.0.0.0` | Listen address; set `127.0.0.1` to keep the studio off your local network |
| `OPEN_BROWSER` | `0` | `1` opens the panel once the server is up (the launcher sets it) |
| `MAX_UPLOAD_MB` | `16` | Upload limit for the character workshop |
| `FLASK_DEBUG` | `0` | `1` enables the Flask debugger; never expose it to a network |

Persona settings live in `static/personas.json`, the current OBS scene in
`scene_config.json`, and the hotkeys in `ptt_config.json`. The app creates all of them.

## Project layout

```text
main.py              Flask server: pages, avatar events, speech synthesis, APIs
key_pool.py          API key rotation and quota error handling
model_fallbacks.py   Fallback model chain
gemini_chat.py       Gemini streaming
openai_chat.py       OpenAI Responses API streaming
gemini_models.py     Model catalogues and provider detection
openai_models.py
providers.py
ptt.py               Global hotkeys
scene.py             OBS scene settings validation
static/js/           Panel, OBS renderer (p5.js), effects, character motion
templates/           Control panel, OBS view, character workshop
tests/               Python and Node tests
```

## Tests

```powershell
python -m pytest
node tests/test_character_motion.js
node tests/test_scene_config.js
```

## Notes

- `api_keys.json` keeps keys in plain text on your machine. Do not share or commit it.
- The bundled sound effects are widely shared meme sounds and belong to their
  respective owners.
