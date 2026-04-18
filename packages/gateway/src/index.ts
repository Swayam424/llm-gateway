import 'dotenv/config';
import express, { Request, Response } from 'express';
import axios from 'axios';
import path from 'path';
import { RoundRobinRouter } from './router';
import { BoundedQueue } from './queue';
import { getStreamAdapter } from './stream';
import { ChatCompletionRequest, MetricSnapshot, WorkerConfig } from './types';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const router = new RoundRobinRouter([
  {
    id: 'worker-local-1',
    baseUrl: 'http://localhost:11434',
    model: 'tinyllama',
    type: 'ollama'
  },
  {
    id: 'worker-groq-1',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-8b-instant',
    type: 'groq',
    apiKey: process.env.GROQ_API_KEY
  }
]);

const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  latencies: [] as number[]
};

const queue = new BoundedQueue(3, 20);
const MAX_RETRIES = 2;

async function callWorker(worker: WorkerConfig, body: ChatCompletionRequest): Promise<string> {
  if (worker.type === 'ollama') {
    const res = await axios.post(
      `${worker.baseUrl}/api/chat`,
      {
        model: worker.model,
        messages: body.messages,
        stream: false,
        options: { temperature: body.temperature ?? 0.7, num_predict: body.max_tokens ?? 512 }
      },
      { timeout: 30000 }
    );
    return res.data.message?.content ?? '';
  } else {
    const res = await axios.post(
      `${worker.baseUrl}/chat/completions`,
      {
        model: worker.model,
        messages: body.messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 512
      },
      {
        timeout: 30000,
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }
      }
    );
    return res.data.choices[0]?.message?.content ?? '';
  }
}

async function forwardRequest(body: ChatCompletionRequest, res: Response, attempt: number = 0): Promise<void> {
  if (attempt >= MAX_RETRIES) {
    metrics.failedRequests++;
    res.status(503).json({ error: 'All workers failed' });
    return;
  }

  let worker;
  try {
    worker = router.next(body.model);
  } catch (e: any) {
    metrics.failedRequests++;
    res.status(503).json({ error: e.message });
    return;
  }

  const start = Date.now();

  try {
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const adapter = getStreamAdapter(worker.type);
      await adapter.stream(worker, body, res);
      metrics.successfulRequests++;
      metrics.latencies.push(Date.now() - start);
      res.end();
    } else {
      const content = await callWorker(worker, body);
      metrics.successfulRequests++;
      metrics.latencies.push(Date.now() - start);
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        model: body.model,
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', index: 0 }]
      });
    }
  } catch (err: any) {
    console.log(`Worker ${worker.id} error:`, err?.response?.data ?? err?.message);
    router.markUnhealthy(worker.id);
    console.log(`Worker ${worker.id} failed. Retrying attempt ${attempt + 1}`);
    await forwardRequest(body, res, attempt + 1);
  }
}

setInterval(async () => {
  for (const state of router.getAll()) {
    try {
      if (state.config.type === 'ollama') {
        await axios.get(`${state.config.baseUrl}/api/tags`, { timeout: 3000 });
      } else {
        await axios.get(`https://api.groq.com/openai/v1/models`, {
          timeout: 5000,
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
        });
      }
      router.markHealthy(state.config.id);
    } catch (err: any) {
      console.log(`Health check failed for ${state.config.id}:`, err?.response?.status, err?.message);
      router.markUnhealthy(state.config.id);
    }
  }
}, 10000);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', workers: router.getAll() });
});

app.get('/metrics', (req: Request, res: Response) => {
  const avg = metrics.latencies.length
    ? Math.round(metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length)
    : 0;
  const snapshot: MetricSnapshot = {
    totalRequests: metrics.totalRequests,
    successfulRequests: metrics.successfulRequests,
    failedRequests: metrics.failedRequests,
    avgLatencyMs: avg
  };
  res.json({ metrics: snapshot, workers: router.getAll(), queue: queue.stats() });
});

app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  metrics.totalRequests++;
  try {
    await queue.add(() => forwardRequest(req.body, res));
  } catch {
    metrics.failedRequests++;
    res.status(503).json({ error: 'Gateway queue full. Try again later.' });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Gateway running on port ${PORT}`));