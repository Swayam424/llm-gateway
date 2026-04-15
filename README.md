# Distributed AI Inference Gateway

A production-grade distributed inference gateway that routes LLM requests across multiple workers with automatic failover, health monitoring, and a live dashboard.

## Features

- OpenAI-compatible API (`/v1/chat/completions`)
- Multi-worker routing with model affinity
- Exponential backoff and automatic failover
- Bounded request queue with concurrency limits
- Live metrics dashboard
- Supports local (Ollama) and cloud (Groq) workers

## Architecture
## Setup

1. Install [Ollama](https://ollama.com) and pull a model:
```bash
ollama pull tinyllama
```

2. Get a free API key from [Groq](https://console.groq.com)

3. Create `.env` in `packages/gateway`:
4. Install and run:
```bash
npm install
cd packages/gateway
npx ts-node src/index.ts
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible inference |
| `/health` | GET | Worker health status |
| `/metrics` | GET | Request metrics + queue stats |
| `/` | GET | Live dashboard |

## Workers

| Worker | Model | Type |
|--------|-------|------|
| worker-local-1 | tinyllama | Ollama (local) |
| worker-groq-1 | llama-3.1-8b-instant | Groq (cloud) |