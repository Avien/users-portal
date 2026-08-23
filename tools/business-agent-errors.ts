import Anthropic from '@anthropic-ai/sdk';
// Extensionless relative imports — this file is bundled by Vercel's builder as
// part of api/business-agent.ts's dependency graph; see the comment there for
// why (a real Preview deployment failure, not a style choice).
import { OrdersSnapshotError, RequestValidationError, AgentMaxTurnsExceededError } from './business-agent-core';
import { BodyTooLargeError } from './business-agent-http';

// ─────────────────────────────────────────────────────────────────────────────
// Maps any error thrown while handling a /api/business-agent request to a
// stable, sanitized HTTP response — shared by both adapters so the browser
// never receives raw provider text, a stack trace, an internal URL, or
// unnecessary provider request metadata regardless of which one served the
// request. Callers are expected to still console.error the raw `err` themselves
// server-side before calling this — detailed diagnostics stay in server logs
// only, never in the returned body.
//
// Anthropic SDK error hierarchy (verified against the installed
// @anthropic-ai/sdk, not assumed): every non-2xx response — including the real
// insufficient-credit case, which is HTTP 400 with error.type
// "invalid_request_error", i.e. a plain BadRequestError, NOT a distinct
// "billing" error class or a 403 — throws a subclass of Anthropic.APIError.
// RateLimitError (429) and APIUserAbortError (thrown when our own AbortSignal
// fires) are the only two cases that need distinct handling; every other
// APIError subclass (BadRequestError, AuthenticationError, PermissionDeniedError,
// NotFoundError, ConflictError, UnprocessableEntityError, InternalServerError,
// APIConnectionError, APIConnectionTimeoutError) is deliberately bucketed
// together as one generic "service unavailable" — the specific provider-side
// reason is never useful to a browser caller and always safe to hide.
// ─────────────────────────────────────────────────────────────────────────────

export interface SanitizedErrorResponse {
  status: number;
  body: { error: string; message: string };
}

export function mapErrorToResponse(err: unknown): SanitizedErrorResponse {
  if (err instanceof RequestValidationError) {
    return { status: 400, body: { error: 'invalid_request', message: err.message } };
  }
  if (err instanceof BodyTooLargeError) {
    return { status: 413, body: { error: 'payload_too_large', message: err.message } };
  }
  // Our own AGENT_TIMEOUT_MS AbortSignal firing — the SDK wraps this as
  // APIUserAbortError (verified: lib/MessageStream.js throws it on abort),
  // not the raw DOM AbortError, so this must be checked before the generic
  // APIError fallback below (APIUserAbortError extends APIError).
  if (err instanceof Anthropic.APIUserAbortError) {
    return { status: 504, body: { error: 'timeout', message: 'The request took too long to complete.' } };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      status: 429,
      body: { error: 'rate_limited', message: 'Too many requests right now — please try again shortly.' },
    };
  }
  if (err instanceof OrdersSnapshotError) {
    return { status: 503, body: { error: 'service_unavailable', message: 'Unable to retrieve current business data.' } };
  }
  // MAX_TURNS exhausted without a final answer — a genuine failure to
  // complete the request, not a business answer to hand back as a 200.
  // Deliberately doesn't mention "MAX_TURNS" or turn counts to the caller.
  if (err instanceof AgentMaxTurnsExceededError) {
    return {
      status: 500,
      body: { error: 'agent_incomplete', message: 'The business agent could not complete this request. Try rephrasing your question.' },
    };
  }
  // Every other Anthropic/provider API failure, including the real observed
  // insufficient-credit case (400 invalid_request_error) — see the module
  // comment above. Deliberately generic: no provider name, no status, no
  // upstream message.
  if (err instanceof Anthropic.APIError) {
    return {
      status: 503,
      body: { error: 'service_unavailable', message: 'The business agent is temporarily unavailable.' },
    };
  }
  return { status: 500, body: { error: 'internal_error', message: 'An unexpected error occurred.' } };
}
