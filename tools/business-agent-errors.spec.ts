import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { mapErrorToResponse } from './business-agent-errors.ts';
import { OrdersSnapshotError, RequestValidationError, AgentMaxTurnsExceededError } from './business-agent-core.ts';
import { BodyTooLargeError } from './business-agent-http.ts';

// Builds a real Anthropic.APIError subclass instance the way the SDK itself
// constructs one from an HTTP response — not a hand-rolled fake — so these
// tests exercise the actual class hierarchy mapErrorToResponse switches on.
function apiError(status: number, type: string, message: string) {
  // generate() falls back to APIConnectionError whenever `headers` is falsy,
  // regardless of status — a real (even empty) Headers object is required for
  // it to actually dispatch to the status-specific subclass.
  return Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, message, new Headers());
}

describe('mapErrorToResponse', () => {
  it('maps RequestValidationError to a 400 carrying its own (already-safe) message', () => {
    const { status, body } = mapErrorToResponse(new RequestValidationError('"prompt" (non-empty string) is required.'));
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'invalid_request', message: '"prompt" (non-empty string) is required.' });
  });

  it('maps BodyTooLargeError to a 413', () => {
    const { status, body } = mapErrorToResponse(new BodyTooLargeError('Request body is too large.'));
    expect(status).toBe(413);
    expect(body).toEqual({ error: 'payload_too_large', message: 'Request body is too large.' });
  });

  it('maps our own timeout (Anthropic.APIUserAbortError, thrown when the shared AbortSignal fires) to a sanitized 504', () => {
    const { status, body } = mapErrorToResponse(new Anthropic.APIUserAbortError());
    expect(status).toBe(504);
    expect(body).toEqual({ error: 'timeout', message: 'The request took too long to complete.' });
  });

  it('maps Anthropic.RateLimitError to a sanitized 429, never exposing the provider message', () => {
    const err = apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit.');
    const { status, body } = mapErrorToResponse(err);
    expect(status).toBe(429);
    expect(body).toEqual({ error: 'rate_limited', message: 'Too many requests right now — please try again shortly.' });
    expect(JSON.stringify(body)).not.toContain('rate limit');
  });

  it('maps OrdersSnapshotError to a sanitized 503, never exposing the dev-facing detail', () => {
    const err = new OrdersSnapshotError(
      'Orders data source unavailable at http://localhost:3000/api/orders-snapshot — is "npm run mock:ws" running? (fetch failed)'
    );
    const { status, body } = mapErrorToResponse(err);
    expect(status).toBe(503);
    expect(body).toEqual({ error: 'service_unavailable', message: 'Unable to retrieve current business data.' });
    expect(JSON.stringify(body)).not.toContain('mock:ws');
    expect(JSON.stringify(body)).not.toContain('localhost:3000');
  });

  // The actual regression: the real Anthropic response observed for an
  // exhausted prepaid balance is HTTP 400 with error.type "invalid_request_error"
  // — i.e. a plain BadRequestError, NOT a distinct "billing" error class and NOT
  // a 403/PermissionDeniedError. A sanitizer designed only around a specific
  // billing_error type or 403 would miss this exact case and let it fall through
  // to the generic 500 "unexpected internal error" bucket — wrong status, wrong
  // classification, and (if ever changed to include err.message) a leak of the
  // real observed text: '{"type":"error","error":{"type":"invalid_request_error",
  // "message":"Your credit balance is too low to access the Anthropic API. Please
  // go to Plans & Billing to upgrade or purchase credits."}}'.
  it('maps the real observed insufficient-credit shape (400 invalid_request_error) to a sanitized 503, not 500 and not a leak', () => {
    const err = apiError(
      400,
      'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
    );
    expect(err).toBeInstanceOf(Anthropic.BadRequestError);

    const { status, body } = mapErrorToResponse(err);

    expect(status).toBe(503);
    expect(body).toEqual({ error: 'service_unavailable', message: 'The business agent is temporarily unavailable.' });
    expect(JSON.stringify(body)).not.toContain('credit');
    expect(JSON.stringify(body)).not.toContain('Billing');
    expect(JSON.stringify(body)).not.toContain('Anthropic');
  });

  it('maps AgentMaxTurnsExceededError to a sanitized 500, never presenting it as a successful answer, and never exposing "MAX_TURNS" wording', () => {
    const err = new AgentMaxTurnsExceededError('Agent did not produce a final answer within MAX_TURNS=8 turns.');
    const { status, body } = mapErrorToResponse(err);
    expect(status).toBe(500);
    expect(body).toEqual({
      error: 'agent_incomplete',
      message: 'The business agent could not complete this request. Try rephrasing your question.',
    });
    expect(JSON.stringify(body)).not.toContain('MAX_TURNS');
  });

  it.each([
    ['AuthenticationError (401)', () => apiError(401, 'authentication_error', 'invalid x-api-key')],
    ['PermissionDeniedError (403)', () => apiError(403, 'permission_error', 'no access to this model')],
    ['NotFoundError (404)', () => apiError(404, 'not_found_error', 'model not found')],
    ['UnprocessableEntityError (422)', () => apiError(422, 'invalid_request_error', 'bad schema')],
    ['InternalServerError (500)', () => apiError(500, 'api_error', 'internal error')],
    ['overloaded (529)', () => apiError(529, 'overloaded_error', 'Overloaded')],
    ['APIConnectionError (network failure before any response)', () => new Anthropic.APIConnectionError({ message: 'fetch failed' })],
  ])('maps every other Anthropic/provider API error (%s) to the same generic sanitized 503', (_label, build) => {
    const { status, body } = mapErrorToResponse(build());
    expect(status).toBe(503);
    expect(body).toEqual({ error: 'service_unavailable', message: 'The business agent is temporarily unavailable.' });
  });

  it('maps an unclassified/non-provider error to a generic 500, never echoing err.message', () => {
    const { status, body } = mapErrorToResponse(new Error('TypeError: Cannot read properties of undefined'));
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'internal_error', message: 'An unexpected error occurred.' });
  });

  it('maps a thrown non-Error value to the same generic 500, without crashing', () => {
    const { status, body } = mapErrorToResponse('a raw string throw');
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'internal_error', message: 'An unexpected error occurred.' });
  });
});
