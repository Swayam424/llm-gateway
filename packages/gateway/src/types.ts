export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface WorkerConfig {
  id: string;
  baseUrl: string;
  model: string;
  type: 'ollama' | 'groq';
  apiKey?: string;
}

export interface MetricSnapshot {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
}