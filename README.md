# Uni API Bridge — Umbrel Community App Store

A translation proxy that exposes your university's AI Toolbox as an OpenAI-compatible API endpoint. Allows OpenClaw and other tools to use your university's AI models seamlessly.

## Installation

Add this repository as a Community App Store in your Umbrel dashboard, then install "Uni API Bridge" from the store.

## Configuration

Set these environment variables in your app's configuration:

| Variable | Description |
|----------|-------------|
| `UNI_API_URL` | Base URL of your university AI Toolbox (e.g. `https://ai.university.edu`) |
| `UNI_API_KEY` | Bearer token for the university API |

## Features

- **OpenAI-compatible API** at `/v1/chat/completions` (streaming and non-streaming)
- **Model discovery** at `/v1/models`
- **Web UI** with connection status and test chat
- Works with OpenClaw and any OpenAI-compatible client

## Using with OpenClaw

Point OpenClaw at `http://<app-ip>:3000/v1` as an OpenAI provider. Use any dummy API key — the real authentication is handled internally by the proxy.
