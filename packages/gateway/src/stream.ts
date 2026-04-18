import { Response } from 'express';
import axios from 'axios';
import { WorkerConfig, ChatCompletionRequest } from './types';

interface StreamAdapter {
  stream(worker: WorkerConfig, body: ChatCompletionRequest, res: Response): Promise<void>;
}

class OllamaStreamAdapter implements StreamAdapter {
  async stream(worker: WorkerConfig, body: ChatCompletionRequest, res: Response): Promise<void> {
    const ollamaRes = await axios.post(
      `${worker.baseUrl}/api/chat`,
      {
        model: worker.model,
        messages: body.messages,
        stream: true,
        options: {
          temperature: body.temperature ?? 0.7,
          num_predict: body.max_tokens ?? 512
        }
      },
      { responseType: 'stream', timeout: 60000 }
    );

    await new Promise<void>((resolve, reject) => {
      ollamaRes.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const token = parsed.message?.content ?? '';
            const done = parsed.done ?? false;
            res.write(`data: ${JSON.stringify({
              choices: [{ delta: { content: token }, finish_reason: done ? 'stop' : null }]
            })}\n\n`);
            if (done) { res.write('data: [DONE]\n\n'); resolve(); }
          } catch { /* skip */ }
        }
      });
      ollamaRes.data.on('error', reject);
    });
  }
}

class GroqStreamAdapter implements StreamAdapter {
  async stream(worker: WorkerConfig, body: ChatCompletionRequest, res: Response): Promise<void> {
    const groqRes = await axios.post(
      `${worker.baseUrl}/chat/completions`,
      {
        model: worker.model,
        messages: body.messages,
        stream: true,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 512
      },
      {
        responseType: 'stream',
        timeout: 60000,
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await new Promise<void>((resolve, reject) => {
      groqRes.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); resolve(); return; }
          try {
            const parsed = JSON.parse(data);
            res.write(`data: ${JSON.stringify({
              choices: [{
                delta: { content: parsed.choices?.[0]?.delta?.content ?? '' },
                finish_reason: parsed.choices?.[0]?.finish_reason ?? null
              }]
            })}\n\n`);
          } catch { /* skip */ }
        }
      });
      groqRes.data.on('error', reject);
    });
  }
}

export function getStreamAdapter(type: 'ollama' | 'groq'): StreamAdapter {
  return type === 'ollama' ? new OllamaStreamAdapter() : new GroqStreamAdapter();
}