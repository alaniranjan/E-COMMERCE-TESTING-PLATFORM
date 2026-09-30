import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

type Handler = (req: RecordedRequest) => { status?: number; body: unknown; delayMs?: number; raw?: string };

/**
 * Minimal stand-in for Ollama's REST API so OllamaProvider can be tested deterministically:
 * request shape, error mapping and timeouts, without a model.
 */
export class FakeOllama {
  readonly requests: RecordedRequest[] = [];
  private handlers = new Map<string, Handler>();
  private server = http.createServer((req, res) => this.handle(req, res));

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  on(path: string, handler: Handler): this {
    this.handlers.set(path, handler);
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.handlers.clear();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      const recorded = { method: req.method ?? '', path: req.url ?? '', body: data ? JSON.parse(data) : {} };
      this.requests.push(recorded);
      const handler = this.handlers.get(recorded.path);
      const out = handler ? handler(recorded) : { status: 404, body: { error: `no fake handler for ${recorded.path}` } };
      if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
      if (res.destroyed) return;
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(out.raw ?? JSON.stringify(out.body));
    });
  }
}

export const chatReply = (content: string, extra: Record<string, unknown> = {}) => ({
  body: { model: 'fake', message: { role: 'assistant', content }, done: true, done_reason: 'stop', prompt_eval_count: 42, eval_count: 7, ...extra },
});
