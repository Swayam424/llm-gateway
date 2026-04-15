import { WorkerConfig } from './types';

export interface WorkerState {
  config: WorkerConfig;
  healthy: boolean;
  lastChecked: number;
  failCount: number;
  retryAfter: number;
  requestsHandled: number;
}

export class RoundRobinRouter {
  private workers: WorkerState[];
  private counter: number = 0;

  constructor(configs: WorkerConfig[]) {
    this.workers = configs.map(c => ({
      config: c,
      healthy: true,
      lastChecked: Date.now(),
      failCount: 0,
      retryAfter: 0,
      requestsHandled: 0
    }));
  }

next(model: string): WorkerConfig {
  const now = Date.now();
  const available = this.workers.filter(w => {
    if (w.config.model !== model) return false;
    if (now >= w.retryAfter) { 
      w.healthy = true;
      return true; 
    }
    if (w.healthy) return true;
    return false;
  });
  if (available.length === 0) throw new Error(`No healthy workers for model: ${model}`);
  const worker = available[this.counter % available.length];
  this.counter++;
  worker.requestsHandled++;
  return worker.config;
}

  markUnhealthy(id: string): void {
    const w = this.workers.find(w => w.config.id === id);
    if (!w) return;
    w.healthy = false;
    w.failCount++;
    const backoff = Math.min(5000 * Math.pow(2, w.failCount - 1), 60000);
    w.retryAfter = Date.now() + backoff;
    w.lastChecked = Date.now();
    console.log(`Worker ${id} unhealthy. Retry in ${backoff / 1000}s`);
  }

  markHealthy(id: string): void {
    const w = this.workers.find(w => w.config.id === id);
    if (!w) return;
    w.healthy = true;
    w.failCount = 0;
    w.retryAfter = 0;
    w.lastChecked = Date.now();
  }

  getAll() {
    return this.workers.map(w => ({
      config: {
        id: w.config.id,
        baseUrl: w.config.baseUrl,
        model: w.config.model,
        type: w.config.type
      },
      healthy: w.healthy,
      lastChecked: w.lastChecked,
      failCount: w.failCount,
      retryAfter: w.retryAfter,
      requestsHandled: w.requestsHandled
    }));
  }
}