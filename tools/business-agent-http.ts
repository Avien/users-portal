import type { IncomingMessage } from 'node:http';

// ─────────────────────────────────────────────────────────────────────────────
// Small HTTP-transport utilities shared by both the local dev server
// (tools/business-agent-server.ts, a raw node:http server) and the production
// serverless handler (api/business-agent.ts, a plain Vercel Node.js Function
// using the same IncomingMessage/ServerResponse types — no @vercel/node
// dependency needed). Kept separate from tools/business-agent-core.ts because
// this is transport-boundary concern, not agent domain logic.
// ─────────────────────────────────────────────────────────────────────────────

// Worst case: a 2000-char prompt + 6 history messages at 2000 chars each +
// JSON structural overhead is ~14-16KB. 32KB gives ~2x headroom without being a
// meaningfully exploitable allowance — nowhere near enough to threaten memory,
// unlike trusting a platform's much larger default (e.g. 100MB) unmodified.
export const MAX_BODY_BYTES = 32 * 1024;

export class BodyTooLargeError extends Error {}

// Reads the full request body up to maxBytes, rejecting as soon as the cap is
// exceeded rather than buffering an unbounded amount before ever validating
// anything. Deliberately does NOT call req.destroy() on overflow — req and res
// share the same underlying socket in node:http (and in Vercel's Node.js
// Function runtime, which uses the same primitives), so destroying the request
// mid-read tears down the connection the caller still needs to write a clean
// 413 response on, and the client sees a dropped connection instead (confirmed
// against a real server, not just this file's own unit tests, which mock the
// response and can't catch that class of bug). Once over the cap, this just
// stops accumulating and settles the promise once; the stream is left to drain
// on its own. Works identically against node:http's raw IncomingMessage and
// Vercel's request object (which extends the same type) — this is the whole
// reason it's a shared, transport-agnostic utility.
//
// Accumulates raw Buffer chunks and decodes UTF-8 exactly ONCE at the end, via
// Buffer.concat — deliberately NOT `body += chunk`, which implicitly calls
// chunk.toString('utf8') on every individual chunk. A multibyte character (e.g.
// Hebrew, emoji) split across two chunks by the network/proxy would decode as
// U+FFFD replacement characters on both sides of the split under that per-chunk
// approach — corrupting the prompt or breaking JSON.parse outright. The byte
// count against maxBytes is unaffected by this: chunk.length is already a byte
// length (Buffer, not string), same as before.
export function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true;
        reject(new BodyTooLargeError('Request body is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

// Accepts any Content-Type whose media type is exactly application/json,
// ignoring parameters — "application/json; charset=utf-8" is valid JSON, not a
// different content type, so exact string equality would wrongly reject it.
export function isJsonContentType(contentType: string | string[] | null | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!value) return false;
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
}
