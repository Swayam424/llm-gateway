type Task = () => Promise<void>;

export class BoundedQueue {
  private concurrency: number;
  private maxSize: number;
  private running: number = 0;
  private queue: Array<{ task: Task; resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(concurrency: number, maxSize: number) {
    this.concurrency = concurrency;
    this.maxSize = maxSize;
  }

  async add(task: Task): Promise<void> {
    if (this.queue.length >= this.maxSize) {
      throw new Error('Queue full');
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.running++;
    try {
      await item.task();
      item.resolve();
    } catch (e: any) {
      item.reject(e);
    } finally {
      this.running--;
      this.process();
    }
  }

  stats() {
    return { running: this.running, queued: this.queue.length };
  }
}