# Claude Code Project Brief: Uni API Bridge — Umbrel Community App

## Goal

Build a **private Umbrel Community App Store** containing a single app called **Uni API Bridge**. This app runs as a Docker container on an Umbrel home server and does two things:

1. **Translation Proxy:** Exposes an OpenAI-compatible API endpoint (`/v1/chat/completions`) on the local network so that other apps (specifically OpenClaw) can use it as if it were an OpenAI provider. Under the hood, it translates requests to a university's custom AI Toolbox API and streams back translated responses.
2. **Simple Web UI:** Serves a minimal web interface with a connection status indicator and a basic chat window for testing the university API directly.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Umbrel Home Server                                      │
│                                                          │
│  ┌────────────┐     ┌─────────────────────┐              │
│  │  OpenClaw   │────▶│  Uni API Bridge     │              │
│  │  (existing) │     │  (this new app)     │              │
│  └────────────┘     │                     │              │
│                      │  - /v1/chat/        │              │
│                      │    completions      │──────▶ University AI API
│                      │    (OpenAI format)  │       (external, internet)
│                      │                     │              │
│                      │  - Web UI (:3000)   │              │
│                      │    status + chat    │              │
│                      └─────────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

**OpenClaw sees this app as just another OpenAI-compatible provider.** No changes to OpenClaw are needed.

---

## Repository Structure (Umbrel Community App Store)

The repository must follow the Umbrel Community App Store template format:
- Reference: https://github.com/getumbrel/umbrel-community-app-store
- Official app packaging guide: https://github.com/getumbrel/umbrel-apps (README)

### Required structure:

```
uni-api-bridge-store/                    # repository root
├── umbrel-app-store.yml                 # app store manifest
├── unibridge-app/                       # app folder (prefixed with store ID)
│   ├── umbrel-app.yml                   # app manifest for Umbrel UI
│   ├── docker-compose.yml               # Docker services definition
│   ├── Dockerfile                       # builds the proxy + UI container
│   ├── exports.sh                       # (optional) export env vars for other apps
│   ├── package.json                     # Node.js dependencies
│   ├── server.js                        # main proxy + API server
│   ├── public/                          # static web UI files
│   │   └── index.html                   # single-page chat UI
│   └── .env.example                     # example environment variables
└── .gitignore
```

### umbrel-app-store.yml

```yaml
id: unibridge
name: Uni API Bridge Store
```

### umbrel-app.yml (key fields)

```yaml
manifestVersion: 1
id: unibridge-app
name: Uni API Bridge
tagline: Translate university AI API to OpenAI-compatible format
icon: https://raw.githubusercontent.com/<user>/<repo>/main/unibridge-app/icon.svg
category: ai
version: "1.0.0"
port: 3000
description: >-
  A translation proxy that exposes your university's AI Toolbox as an
  OpenAI-compatible API endpoint. Allows OpenClaw and other tools to use
  your university's free AI models seamlessly.
developer: "<your name>"
website: ""
submitter: "<your name>"
submission: ""
repo: "https://github.com/<user>/<repo>"
support: "https://github.com/<user>/<repo>/issues"
gallery: []
releaseNotes: "Initial release"
dependencies: []
path: ""
deterministicPassword: false
torOnly: false
```

---

## The Translation Proxy (server.js)

### What it must do

The server should:

1. **Listen on port 3000** (Umbrel convention — single port for both UI and API)
2. **Serve the web UI** at `/` (static HTML)
3. **Expose `/v1/chat/completions`** accepting OpenAI-format requests
4. **Expose `/v1/models`** returning a list of available models (so OpenClaw can discover them)
5. **Expose `/api/status`** for the UI to check connectivity to the university API
6. **Translate requests** from OpenAI format → university format
7. **Translate streaming responses** from university format → OpenAI SSE format
8. Read config from environment variables (never hardcode secrets)

### Environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `UNI_API_URL` | Base URL of university AI Toolbox | `https://ai.university.edu` |
| `UNI_API_KEY` | Bearer token for university API | `eyJhbG...` |
| `PORT` | Server port (default 3000) | `3000` |

These should be set via the `docker-compose.yml` environment section using Umbrel's `${APP_DATA_DIR}` pattern or directly.

### Security requirements

- The API key must ONLY be stored in environment variables or a mounted `.env` file
- The `/v1/chat/completions` endpoint should only be accessible from the local Docker network (not exposed to the internet)
- The web UI is protected by Umbrel's built-in app proxy authentication (users must log into Umbrel first)
- Never log the API key or bearer token

---

## University AI Toolbox API Specification

This is the COMPLETE API spec for the university's AI service that the proxy must translate to/from.

### Authentication
- Bearer token required in `Authorization` header
- Returns 401 if missing or invalid

### Endpoint: POST `/api/v1/chat/send`

Send a message. Responses are **streamed line-by-line** (not SSE, not a JSON array — each line is a standalone JSON object).

**Request body** (`application/json`):

```json
{
  "thread": null,
  "prompt": "Your message here",
  "customInstructions": "Optional system-level instructions",
  "hideCustomInstructions": true,
  "model": "gpt-4o"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `thread` | `string \| null` | Thread ID to continue conversation. `null` for new conversation. |
| `prompt` | `string` | The user message |
| `customInstructions` | `string` | Optional system instructions |
| `hideCustomInstructions` | `boolean` | Whether to hide instructions from history |
| `model` | `string` | Model to use. Default `o4-mini`. Others: `gpt-4o`, etc. |

**Response 200** — Streamed JSON objects, one per line:

Each line is a JSON object with a `type` field:

**`type: "start"`**
```json
{
  "type": "start",
  "role": "assistant",
  "thread": {
    "id": "GnhZ3PEFcuCl-Q0",
    "dateCreated": "2024-07-17",
    "lastReply": "2024-07-17",
    "deletionTimeLeft": "2024-07-17"
  },
  "conversationThread": "GnhZ3PEFcuCl-Q0"
}
```

**`type: "chunk"`**
```json
{"type": "chunk", "content": " Keep"}
{"type": "chunk", "content": " learning"}
```

**`type: "done"`**
```json
{
  "type": "done",
  "response": "Full assembled response text here",
  "conversationThread": "GnhZ3PEFcuCl-Q0",
  "thread": { "id": "...", "dateCreated": "...", "lastReply": "...", "deletionTimeLeft": "..." },
  "promptTokens": 26,
  "responseTokens": 39,
  "totalTokens": 65,
  "title": "Auto-generated conversation title"
}
```

**Response 401** — Access token missing or invalid

**Response error:**
```json
{
  "code": "chatbot.sendRequest.error",
  "message": "There was an error with your request. Please try again.",
  "error": true
}
```

### Endpoint: GET `/api/v1/chat/{id}`

Retrieve conversation history by thread ID.

**Response 200** — Array of message objects:
```json
[
  { "role": "user", "content": "Hello" },
  { "role": "assistant", "content": "Hi there!" }
]
```

### Endpoint: DELETE `/api/v1/chat/{id}`

Delete a conversation thread by ID.

---

## Translation Logic

### Request translation: OpenAI → University

**Incoming OpenAI format:**
```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi!" },
    { "role": "user", "content": "How are you?" }
  ],
  "stream": true
}
```

**Must translate to university format:**
```json
{
  "thread": null,
  "prompt": "How are you?",
  "customInstructions": "You are a helpful assistant.",
  "hideCustomInstructions": true,
  "model": "gpt-4o"
}
```

Translation rules:
- Extract the **last `user` message** as `prompt`
- Extract any `system` message as `customInstructions`
- The `model` field maps directly
- Set `thread` to `null` (we don't persist university threads across OpenAI-style calls)
- Ignore conversation history in `messages` (the university API doesn't accept it in this format). This is a known limitation — document it.

### Response translation: University → OpenAI SSE

**University streams** line-by-line JSON objects. **OpenAI expects** SSE format (`data: {...}\n\n`).

Map university `type: "start"` → OpenAI initial chunk:
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

```

Map university `type: "chunk"` → OpenAI content chunk:
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" Keep"},"finish_reason":null}]}

```

Map university `type: "done"` → OpenAI final chunk + done signal:
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":26,"completion_tokens":39,"total_tokens":65}}

data: [DONE]

```

Also support `"stream": false` (non-streaming) by collecting all chunks and returning a single OpenAI completion response.

### `/v1/models` endpoint

Return a hardcoded (or configurable) list of models in OpenAI format:

```json
{
  "object": "list",
  "data": [
    { "id": "gpt-4o", "object": "model", "owned_by": "uni-proxy" },
    { "id": "o4-mini", "object": "model", "owned_by": "uni-proxy" }
  ]
}
```

---

## Web UI (public/index.html)

A single HTML file (self-contained CSS and JS) with:

1. **Status indicator** at the top:
   - Green dot + "Connected" if `/api/status` returns OK
   - Red dot + "Disconnected" if it fails
   - Polls every 30 seconds

2. **Chat window:**
   - Message history display area (scrollable)
   - Single text input + send button at the bottom
   - Messages sent via the proxy's `/v1/chat/completions` endpoint (so it tests the full translation pipeline)
   - Streaming responses render token-by-token
   - Simple, clean design (dark theme preferred to match Umbrel aesthetic)

3. **No external dependencies** — pure HTML/CSS/JS, no frameworks

---

## Docker Configuration

### Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### docker-compose.yml

Must follow Umbrel conventions:

```yaml
version: "3.7"

services:
  app_proxy:
    environment:
      APP_HOST: unibridge-app_server_1
      APP_PORT: 3000
    image: getumbrel/umbrel-app-proxy:v1.0.1
    restart: on-failure
    networks:
      default:
        ipv4_address: $APP_PROXY_IP

  server:
    build: .
    restart: on-failure
    environment:
      UNI_API_URL: ${UNI_API_URL:-}
      UNI_API_KEY: ${UNI_API_KEY:-}
      PORT: 3000
    volumes:
      - ${APP_DATA_DIR}/data:/data
    networks:
      default:
        ipv4_address: $APP_IP
```

Note: `APP_PROXY_IP`, `APP_IP`, and `APP_DATA_DIR` are provided by Umbrel at runtime.

---

## Integration with OpenClaw

Once the Umbrel app is running, the user configures OpenClaw to use it by:

1. Adding `UNI_OPENAI_API_KEY` (can be any dummy value, the proxy handles real auth) to OpenClaw's `.env`
2. Adding a provider in `openclaw.json` pointing to the proxy's internal Docker network address or `localhost:3000`

Example OpenClaw provider config (using env var substitution):
```json
{
  "models": {
    "providers": {
      "uni-proxy": {
        "type": "openai",
        "apiKey": "${UNI_OPENAI_API_KEY}",
        "baseURL": "http://<app-ip>:3000/v1"
      }
    }
  }
}
```

The proxy should accept ANY value for the `Authorization` header on the `/v1/chat/completions` endpoint (or optionally validate a configurable token). The real university API key is stored only inside the proxy's own environment.

---

## Security Checklist

- [ ] University API key stored ONLY in environment variables
- [ ] API key never logged, never sent to clients, never exposed in UI
- [ ] `/v1/chat/completions` accessible only on Docker internal network
- [ ] Web UI protected by Umbrel's app proxy authentication
- [ ] `.env` file in `.gitignore`
- [ ] `.env.example` with placeholder values committed instead
- [ ] No hardcoded secrets anywhere in codebase

---

## Getting Started (for Claude Code)

1. Create the full repository structure as described above
2. Implement `server.js` with Express or native Node.js http
3. Implement the translation logic with proper error handling
4. Create the web UI
5. Test locally with `docker compose up`
6. Ensure the repo can be added as a Community App Store in Umbrel UI

Start by creating all files. Focus on getting the translation proxy working correctly first, then the UI.
