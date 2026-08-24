// Pure formatting/exit-code logic for tools/pr-review-agent.mjs, split out so it
// can be unit tested without executing the script's side effects (git diff,
// live Anthropic API call, ANTHROPIC_API_KEY check).
//
// Truncation safety: if the diff had to be cut down to MAX_DIFF_CHARS, the model
// only ever saw part of the PR, so its own verdict text (even a clean "no issues
// found") cannot be trusted as authoritative for the whole PR. In that case this
// ALWAYS prepends an explicit "review incomplete" notice and ALWAYS returns a
// non-zero exit code, regardless of what the model said — never a silent/green
// result on a truncated diff.
//
// Empty-output safety: a required gate must not pass just because the model (or
// a transport hiccup) produced no text at all — an empty/whitespace-only review
// is treated the same way, forced non-zero, never silently green.
export function formatReviewOutput({ review, truncated, maxDiffChars, marker }) {
  const hasReview = review.trim().length > 0;
  const incompleteNotice = truncated
    ? `⚠️ **Review INCOMPLETE — diff truncated at ${maxDiffChars.toLocaleString()} characters.** ` +
      `This PR's diff exceeds the reviewer's size limit; only the first ${maxDiffChars.toLocaleString()} ` +
      `character(s) were reviewed below. This is NOT a pass/fail verdict on the full PR — re-review ` +
      `manually or split the PR into smaller changes.\n\n`
    : !hasReview
      ? `⚠️ **Review INCOMPLETE — the reviewer produced no output.** This is NOT a pass/fail verdict ` +
        `on this PR — re-run the review manually.\n\n`
      : '';
  const body = hasReview ? review : '_No review produced._';
  const output = `${marker}\n${incompleteNotice}${body}\n`;
  const exitCode = !hasReview || truncated || /⚠️/.test(review) ? 1 : 0;
  return { output, exitCode };
}
