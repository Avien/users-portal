import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readRequestBody, isJsonContentType, BodyTooLargeError, MAX_BODY_BYTES } from './business-agent-http.ts';

// Real PassThrough (not a mock) so readRequestBody's req.on('data'/'end'/'error')
// behaves exactly as it would against a real IncomingMessage — same rationale as
// api/business-agent.spec.ts's fakeRequest, but writes are driven chunk-by-chunk
// here so boundary/error timing can be controlled precisely, which that file's
// end-to-end tests don't need to isolate.
function fakeReq(): { req: IncomingMessage; stream: PassThrough } {
  const stream = new PassThrough();
  return { req: stream as unknown as IncomingMessage, stream };
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('readRequestBody', () => {
  it('resolves with the full body when under maxBytes', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 100);
    stream.write('hello');
    stream.end();
    await expect(promise).resolves.toBe('hello');
  });

  it('resolves with an empty string for an empty body', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 100);
    stream.end();
    await expect(promise).resolves.toBe('');
  });

  it('resolves when the body is exactly maxBytes (boundary is inclusive)', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 5);
    stream.write('12345');
    stream.end();
    await expect(promise).resolves.toBe('12345');
  });

  it('rejects with BodyTooLargeError once the body exceeds maxBytes in a single chunk', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 5);
    stream.write('123456');
    await expect(promise).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('rejects when the overflow only happens across multiple chunks, not the first', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 10);
    stream.write('12345'); // 5 bytes — under cap, must not reject yet
    await nextTick();
    stream.write('678901'); // +6 = 11 bytes — now over cap
    await expect(promise).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('stops accumulating and settles only once after the cap is exceeded, ignoring further data', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 5);
    promise.catch(() => {}); // eager handler — settles before the awaited assertion attaches its own
    stream.write('123456'); // over cap — settles the promise
    await nextTick();
    // Further writes/end after settling must not throw, hang, or change the outcome.
    stream.write('more data that must be ignored');
    stream.end();
    await expect(promise).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('rejects with the underlying error when the request errors mid-read', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 100);
    const boom = new Error('socket hang up');
    stream.emit('error', boom);
    await expect(promise).rejects.toBe(boom);
  });

  it('ignores a later error once already settled by a size-cap rejection', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 5);
    promise.catch(() => {}); // eager handler — settles before the awaited assertion attaches its own
    stream.write('123456'); // settles via BodyTooLargeError
    await nextTick();
    stream.emit('error', new Error('must be ignored — already settled'));
    await expect(promise).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('ignores a late error after a clean end() has already resolved', async () => {
    const { req, stream } = fakeReq();
    const promise = readRequestBody(req, 100);
    stream.write('hello');
    stream.end();
    await expect(promise).resolves.toBe('hello');
    // Emitting after resolution must not produce an unhandled rejection.
    expect(() => stream.emit('error', new Error('too late'))).not.toThrow();
  });

  describe('multibyte UTF-8 characters split across chunk boundaries', () => {
    // Node delivers each stream.write() as its own 'data' event (separated by a
    // tick so they don't coalesce into one chunk) — exactly the shape a real
    // client's multi-KB non-ASCII request body takes through a real socket/proxy.
    // Decoding each chunk independently (e.g. `body += chunk`, which implicitly
    // calls chunk.toString('utf8') per chunk) turns half of a split multibyte
    // sequence into U+FFFD replacement characters on both sides of the split.

    it('reassembles a 2-byte Hebrew character split across chunks', async () => {
      const { req, stream } = fakeReq();
      const promise = readRequestBody(req, 1000);
      const payload = Buffer.from('{"prompt":"שלום"}', 'utf8');
      // Split inside the first character's 2-byte UTF-8 sequence (א/ש etc. all
      // encode as 0xD7 0x9X) — one byte in each chunk.
      const splitIndex = payload.indexOf(Buffer.from('ש', 'utf8')) + 1;
      stream.write(payload.subarray(0, splitIndex));
      await nextTick();
      stream.write(payload.subarray(splitIndex));
      stream.end();

      const body = await promise;
      expect(JSON.parse(body)).toEqual({ prompt: 'שלום' });
    });

    it('reassembles a 4-byte emoji code point split across chunks', async () => {
      const { req, stream } = fakeReq();
      const promise = readRequestBody(req, 1000);
      const payload = Buffer.from('{"prompt":"😀"}', 'utf8');
      const emojiStart = payload.indexOf(Buffer.from('😀', 'utf8'));
      // Split in the middle of the 4-byte sequence (2 bytes in each chunk).
      const splitIndex = emojiStart + 2;
      stream.write(payload.subarray(0, splitIndex));
      await nextTick();
      stream.write(payload.subarray(splitIndex));
      stream.end();

      const body = await promise;
      expect(JSON.parse(body)).toEqual({ prompt: '😀' });
    });

    it('reassembles a multibyte character split three ways across three chunks', async () => {
      const { req, stream } = fakeReq();
      const promise = readRequestBody(req, 1000);
      const payload = Buffer.from('{"prompt":"😀"}', 'utf8');
      const emojiStart = payload.indexOf(Buffer.from('😀', 'utf8'));
      stream.write(payload.subarray(0, emojiStart + 1));
      await nextTick();
      stream.write(payload.subarray(emojiStart + 1, emojiStart + 3));
      await nextTick();
      stream.write(payload.subarray(emojiStart + 3));
      stream.end();

      const body = await promise;
      expect(JSON.parse(body)).toEqual({ prompt: '😀' });
    });

    it('still enforces MAX_BODY_BYTES as a byte limit (not a JS string-length limit) for multibyte payloads', async () => {
      const { req, stream } = fakeReq();
      // Each 😀 is 4 UTF-8 bytes but 2 UTF-16 code units — a string-length-based
      // cap would wrongly allow roughly 2x this payload through.
      const payload = Buffer.from('😀'.repeat(10), 'utf8'); // 40 bytes
      const promise = readRequestBody(req, 39);
      stream.write(payload);
      await expect(promise).rejects.toBeInstanceOf(BodyTooLargeError);
    });
  });
});

describe('isJsonContentType', () => {
  it('accepts exact application/json', () => {
    expect(isJsonContentType('application/json')).toBe(true);
  });

  it('accepts application/json with parameters (e.g. charset)', () => {
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isJsonContentType('Application/JSON')).toBe(true);
  });

  it('rejects a different content type', () => {
    expect(isJsonContentType('text/plain')).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isJsonContentType(null)).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isJsonContentType('')).toBe(false);
  });

  it('uses the first value when given an array header (Node\'s duplicate-header shape)', () => {
    expect(isJsonContentType(['application/json', 'text/plain'])).toBe(true);
    expect(isJsonContentType(['text/plain', 'application/json'])).toBe(false);
  });
});

describe('MAX_BODY_BYTES', () => {
  it('is 32KB', () => {
    expect(MAX_BODY_BYTES).toBe(32 * 1024);
  });
});
