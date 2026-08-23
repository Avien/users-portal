import { describe, it, expect } from 'vitest';
import { formatReviewOutput } from './pr-review-format.mjs';

const MARKER = '<!-- architecture-review-bot -->';

describe('formatReviewOutput', () => {
  it('passes a clean, non-truncated review straight through with exit 0', () => {
    const { output, exitCode } = formatReviewOutput({
      review: '✅ No architecture drift found.',
      truncated: false,
      maxDiffChars: 300_000,
      marker: MARKER,
    });
    expect(exitCode).toBe(0);
    expect(output).toBe(`${MARKER}\n✅ No architecture drift found.\n`);
  });

  it('exits non-zero for a non-truncated review that itself reports drift', () => {
    const { output, exitCode } = formatReviewOutput({
      review: '⚠️ 1 issue(s) found:\n- **foo.ts:1** — bad import.',
      truncated: false,
      maxDiffChars: 300_000,
      marker: MARKER,
    });
    expect(exitCode).toBe(1);
    expect(output).toContain('⚠️ 1 issue(s) found');
  });

  it('forces exit 1 and prepends an incomplete notice even when the truncated review looks clean', () => {
    const { output, exitCode } = formatReviewOutput({
      review: '✅ No architecture drift found.',
      truncated: true,
      maxDiffChars: 300_000,
      marker: MARKER,
    });
    expect(exitCode).toBe(1);
    expect(output).toContain('Review INCOMPLETE');
    expect(output).toContain('300,000');
    // the underlying (unreliable) model verdict is still preserved for context
    expect(output).toContain('✅ No architecture drift found.');
  });

  it('still forces exit 1 on truncation when the review itself also reports drift', () => {
    const { exitCode } = formatReviewOutput({
      review: '⚠️ 2 issue(s) found:\n- **bar.ts:2** — boundary violation.',
      truncated: true,
      maxDiffChars: 300_000,
      marker: MARKER,
    });
    expect(exitCode).toBe(1);
  });

  it('falls back to a placeholder body and forces exit 1 when the model produced no text', () => {
    const { output, exitCode } = formatReviewOutput({
      review: '',
      truncated: false,
      maxDiffChars: 300_000,
      marker: MARKER,
    });
    expect(exitCode).toBe(1);
    expect(output).toContain('Review INCOMPLETE');
    expect(output).toContain('_No review produced._');
  });

  it('treats a whitespace-only review the same as empty — placeholder body, exit 1', () => {
    const { output, exitCode } = formatReviewOutput({
      review: '   \n\t  ',
      truncated: false,
      maxDiffChars: 300_000,
      marker: MARKER,
    });
    expect(exitCode).toBe(1);
    expect(output).toContain('Review INCOMPLETE');
    expect(output).toContain('_No review produced._');
    // the raw whitespace itself must not leak into the rendered body
    expect(output).not.toContain('   \n\t  ');
  });

  it('truncation notice takes priority over the empty-review notice when both apply', () => {
    const { output, exitCode } = formatReviewOutput({
      review: '',
      truncated: true,
      maxDiffChars: 300_000,
      marker: MARKER,
    });
    expect(exitCode).toBe(1);
    expect(output).toContain('diff truncated');
    expect(output).not.toContain('the reviewer produced no output');
  });
});
