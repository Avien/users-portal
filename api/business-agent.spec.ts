import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import handler, { client } from './business-agent.ts';

// Fake req/res built on a real PassThrough (so readRequestBody's req.on('data'/
// 'end'/'error') and req.destroy() all behave exactly as they would against a
// real IncomingMessage) plus a minimal ServerResponse double that just records
// what was sent, since these tests only assert on the final HTTP contract.
function fakeRequest(body: string, { method = 'POST', contentType = 'application/json' as string | undefined } = {}) {
  const req = new PassThrough() as unknown as IncomingMessage;
  (req as unknown as { method: string }).method = method;
  (req as unknown as { headers: Record<string, string> }).headers = contentType ? { 'content-type': contentType } : {};
  (req as unknown as PassThrough).write(body);
  (req as unknown as PassThrough).end();
  return req;
}

function fakeResponse() {
  const res = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      Object.assign(this.headers, headers ?? {});
    },
    end(data?: string) {
      this.body = data;
    },
  };
  return res as unknown as ServerResponse & typeof res;
}

const USAGE = (inputTokens: number, outputTokens: number) => ({
  input_tokens: inputTokens,
  output_tokens: outputTokens,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
});

const SNAPSHOT_URL = 'http://localhost:3000/api/orders-snapshot';

function stubOrdersSnapshot(snapshot: { orders: unknown[]; arrivals: Record<number, number> } = { orders: [], arrivals: {} }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== SNAPSHOT_URL) throw new Error(`unexpected fetch url in test: ${url}`);
      return { ok: true, json: async () => snapshot };
    })
  );
}

describe('POST /api/business-agent (production serverless handler)', () => {
  beforeEach(() => {
    stubOrdersSnapshot();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['BUSINESS_AGENT_ALLOWED_ORIGINS'];
    delete process.env['BUSINESS_AGENT_USAGE_LOG'];
  });

  it('handles a successful request end-to-end, returning exactly {answer, trace, turns} — no usage key', async () => {
    client.messages.stream = vi.fn().mockReturnValue({
      finalMessage: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Avi Cohen has spent $200.40.', citations: [] }],
        usage: USAGE(50, 20),
        model: 'claude-sonnet-5',
      }),
    }) as unknown as Anthropic['messages']['stream'];

    const req = fakeRequest(JSON.stringify({ prompt: 'How much has Avi Cohen spent?' }));
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body!);
    expect(parsed).toEqual({ answer: 'Avi Cohen has spent $200.40.', trace: [], turns: 1 });
    expect(parsed.usage).toBeUndefined();
    expect(res.body).not.toContain('usage'); // string-level check too — usage never serialized at all
  });

  it('one HTTP Ask results in exactly one coherent agent run, even though that run makes several Anthropic calls', async () => {
    const responses = [
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'searchUsers', input: {} }],
        usage: USAGE(50, 10),
        model: 'claude-sonnet-5',
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done', citations: [] }],
        usage: USAGE(60, 15),
        model: 'claude-sonnet-5',
      },
    ];
    const streamMock = vi.fn().mockImplementation(() => {
      const response = responses[streamMock.mock.calls.length - 1];
      return { finalMessage: async () => response };
    });
    client.messages.stream = streamMock as unknown as Anthropic['messages']['stream'];

    const req = fakeRequest(JSON.stringify({ prompt: 'Which users need attention?' }));
    const res = fakeResponse();

    await handler(req, res);

    expect(streamMock).toHaveBeenCalledTimes(2); // the one run made two Anthropic calls...
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body!);
    expect(parsed.turns).toBe(2); // ...surfaced as one coherent two-turn result, not two separate responses
    expect(parsed.answer).toBe('done');
  });

  it('rejects a missing prompt with a 400 and a safe message', async () => {
    const req = fakeRequest(JSON.stringify({}));
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!)).toEqual({ error: 'invalid_request', message: '"prompt" (non-empty string) is required.' });
  });

  it('rejects an oversized prompt with a 400', async () => {
    const req = fakeRequest(JSON.stringify({ prompt: 'x'.repeat(2001) }));
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!).error).toBe('invalid_request');
  });

  it('rejects an oversized body with a 413, without ever reaching Anthropic', async () => {
    const streamMock = vi.fn();
    client.messages.stream = streamMock as unknown as Anthropic['messages']['stream'];
    const req = fakeRequest(JSON.stringify({ prompt: 'x'.repeat(40_000) })); // well past MAX_BODY_BYTES (32KB)
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body!).error).toBe('payload_too_large');
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with a 400, not a 500, and never echoes the parser error text', async () => {
    const req = fakeRequest('{not valid json');
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body!);
    expect(body).toEqual({ error: 'invalid_request', message: 'Request body must be valid JSON.' });
  });

  it('rejects a non-JSON Content-Type with a 400', async () => {
    const req = fakeRequest(JSON.stringify({ prompt: 'q' }), { contentType: 'text/plain' });
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!).error).toBe('invalid_request');
  });

  it('accepts application/json with parameters (e.g. charset), not just an exact match', async () => {
    client.messages.stream = vi.fn().mockReturnValue({
      finalMessage: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok', citations: [] }],
        usage: USAGE(1, 1),
        model: 'claude-sonnet-5',
      }),
    }) as unknown as Anthropic['messages']['stream'];
    const req = fakeRequest(JSON.stringify({ prompt: 'q' }), { contentType: 'application/json; charset=utf-8' });
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('bounds and sanitizes history through the handler exactly as sanitizeHistory does standalone', async () => {
    // messages is a single mutable array runAgent keeps pushing to across turns
    // (see the core spec's identical note) — snapshot it at call time, not after
    // handler() resolves, or this would also see the assistant reply pushed
    // back on afterward.
    const capturedMessages: unknown[][] = [];
    const streamMock = vi.fn().mockImplementation((params: { messages: unknown[] }) => {
      capturedMessages.push([...params.messages]);
      return {
        finalMessage: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'ok', citations: [] }],
          usage: USAGE(1, 1),
          model: 'claude-sonnet-5',
        }),
      };
    });
    client.messages.stream = streamMock as unknown as Anthropic['messages']['stream'];

    const req = fakeRequest(
      JSON.stringify({
        prompt: 'q',
        history: [
          { role: 'user', content: 'earlier question' },
          { role: 'system', content: 'discarded — invalid role' },
        ],
      })
    );
    const res = fakeResponse();

    await handler(req, res);

    expect(capturedMessages[0]).toEqual([
      { role: 'user', content: 'earlier question' },
      { role: 'user', content: 'q' },
    ]);
  });

  it('maps an Anthropic rate-limit failure to a sanitized 429', async () => {
    client.messages.stream = vi.fn().mockReturnValue({
      finalMessage: async () => {
        throw Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
      },
    }) as unknown as Anthropic['messages']['stream'];

    const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body!).error).toBe('rate_limited');
    expect(res.body).not.toContain('slow down');
  });

  it('maps the real observed insufficient-credit shape (400 invalid_request_error) to a sanitized 503, never leaking billing text', async () => {
    client.messages.stream = vi.fn().mockReturnValue({
      finalMessage: async () => {
        throw Anthropic.APIError.generate(
          400,
          { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
          'Your credit balance is too low to access the Anthropic API.',
          new Headers()
        );
      },
    }) as unknown as Anthropic['messages']['stream'];

    const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body!)).toEqual({ error: 'service_unavailable', message: 'The business agent is temporarily unavailable.' });
    expect(res.body).not.toContain('credit');
  });

  it('maps a timeout (shared AbortSignal firing) to a sanitized 504', async () => {
    client.messages.stream = vi.fn().mockReturnValue({
      finalMessage: async () => {
        throw new Anthropic.APIUserAbortError();
      },
    }) as unknown as Anthropic['messages']['stream'];

    const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(504);
    expect(JSON.parse(res.body!)).toEqual({ error: 'timeout', message: 'The request took too long to complete.' });
  });

  it('maps an Orders backend failure to a sanitized 503, never leaking the dev-facing detail', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
    const res = fakeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body!)).toEqual({ error: 'service_unavailable', message: 'Unable to retrieve current business data.' });
    expect(res.body).not.toContain('mock:ws');
  }, 10_000); // this path exercises fetchOrdersSnapshot's real retry backoff (250ms + 500ms)

  describe('CORS', () => {
    it('grants the header to an explicitly allowed origin', async () => {
      process.env['BUSINESS_AGENT_ALLOWED_ORIGINS'] = 'https://users-portal-angular.vercel.app,https://users-portal-vue.vercel.app';
      client.messages.stream = vi.fn().mockReturnValue({
        finalMessage: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'ok', citations: [] }],
          usage: USAGE(1, 1),
          model: 'claude-sonnet-5',
        }),
      }) as unknown as Anthropic['messages']['stream'];

      const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
      (req as unknown as { headers: Record<string, string> }).headers.origin = 'https://users-portal-angular.vercel.app';
      const res = fakeResponse();

      await handler(req, res);

      expect(res.headers['access-control-allow-origin']).toBe('https://users-portal-angular.vercel.app');
    });

    it('does not grant the header to a non-listed origin', async () => {
      process.env['BUSINESS_AGENT_ALLOWED_ORIGINS'] = 'https://users-portal-angular.vercel.app';
      client.messages.stream = vi.fn().mockReturnValue({
        finalMessage: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'ok', citations: [] }],
          usage: USAGE(1, 1),
          model: 'claude-sonnet-5',
        }),
      }) as unknown as Anthropic['messages']['stream'];

      const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
      (req as unknown as { headers: Record<string, string> }).headers.origin = 'https://evil.example.com';
      const res = fakeResponse();

      await handler(req, res);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('fails closed (no header at all) when BUSINESS_AGENT_ALLOWED_ORIGINS is unset, unlike the shared dev-only cors.mjs default of "*"', async () => {
      delete process.env['BUSINESS_AGENT_ALLOWED_ORIGINS'];
      client.messages.stream = vi.fn().mockReturnValue({
        finalMessage: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'ok', citations: [] }],
          usage: USAGE(1, 1),
          model: 'claude-sonnet-5',
        }),
      }) as unknown as Anthropic['messages']['stream'];

      const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
      (req as unknown as { headers: Record<string, string> }).headers.origin = 'https://anything.example.com';
      const res = fakeResponse();

      await handler(req, res);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('never logs usage/cost telemetry unless BUSINESS_AGENT_USAGE_LOG=1 is explicitly set', async () => {
    delete process.env['BUSINESS_AGENT_USAGE_LOG'];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    client.messages.stream = vi.fn().mockReturnValue({
      finalMessage: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok', citations: [] }],
        usage: USAGE(1, 1),
        model: 'claude-sonnet-5',
      }),
    }) as unknown as Anthropic['messages']['stream'];

    const req = fakeRequest(JSON.stringify({ prompt: 'q' }));
    const res = fakeResponse();

    await handler(req, res);

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[Business Agent Usage]'));
    logSpy.mockRestore();
  });
});
