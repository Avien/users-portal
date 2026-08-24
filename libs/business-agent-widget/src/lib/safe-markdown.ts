// Small, hand-rolled, allow-listed Markdown-lite renderer for Claude's answer
// text (see business-agent-widget.ts's renderTranscript). Deliberately NOT a
// general Markdown implementation and NOT an npm dependency:
//
// - The supported subset is intentionally tiny — bold, italic, inline code,
//   and unordered/ordered lists — because that's all the product asked for,
//   and every additional construct (links, images, headings, HTML blocks,
//   fenced code) is either irrelevant to a short business answer or is
//   itself a fresh XSS surface (an <a href> or <img src> built from
//   model-controlled text is exactly the kind of thing this file exists to
//   avoid). Not implementing link/image syntax at all means there is no
//   javascript:/data: URL path through this renderer, by construction.
// - No dependency: a full Markdown library is a large addition (parser +
//   its own security surface, e.g. historical DOMPurify/marked XSS CVEs
//   from mishandled edge cases) to pull in for four inline constructs and
//   two list types. Hand-rolling ~80 lines that are exhaustively unit
//   tested is less risk here, not more, for a scope this narrow.
//
// SAFETY INVARIANT: nothing in this file ever touches innerHTML/outerHTML or
// parses `text` as markup. Every DOM node is built with document.createElement
// + .textContent (which assigns a single Text node's data verbatim — it is
// never re-parsed as HTML, so literal "<script>", "<img onerror=...>",
// "javascript:", or malformed markdown syntax can only ever end up as inert
// character data, never as an executing element/attribute). See
// safe-markdown.spec.ts for the XSS regression suite.

const UL_LINE = /^ {0,3}[-*]\s+(.*)$/;
const OL_LINE = /^ {0,3}(\d+)\.\s+(.*)$/;

// Ordered by specificity: inline code first (its content is never itself
// re-scanned for bold/italic), then bold (**) before italic (*) so "**x**"
// is never misread as italic-of-"*x*". The (?=\S)/(?<=\S) flanking guards on
// every alternative require a non-space character on both inner edges — this
// is what stops a stray single "*" (e.g. "3 * 4 = 12") from pairing with an
// unrelated later "*" elsewhere in the same answer and swallowing everything
// between them as a bogus italic span; a real emphasis marker in prose is
// essentially always tight against its content ("*maybe*", not "* maybe *").
const INLINE_PATTERN =
  /`(?=\S)([^`]+?)(?<=\S)`|\*\*(?=\S)([^*]+?)(?<=\S)\*\*|\*(?=\S)([^*]+?)(?<=\S)\*/g;

// Appends `text`'s inline formatting (code/bold/italic) as safe child nodes
// of `container` — text between/around matches becomes plain Text nodes.
// Unmatched/malformed syntax (an unterminated "**", a lone "*") simply never
// matches this regex and falls through as ordinary literal text, which is
// exactly the desired "malformed Markdown stays inert" behavior — there is
// no separate error path to get wrong.
function appendInline(container: Node, text: string): void {
  INLINE_PATTERN.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const [, codeContent, boldContent, italicContent] = match;
    if (codeContent !== undefined) {
      const code = document.createElement('code');
      code.textContent = codeContent;
      container.appendChild(code);
    } else if (boldContent !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = boldContent;
      container.appendChild(strong);
    } else {
      const em = document.createElement('em');
      em.textContent = italicContent;
      container.appendChild(em);
    }
    lastIndex = INLINE_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

// Builds a safe DOM fragment for `text`, recognizing only line-leading list
// markers ("- "/"* " for <ul>, "1. " for <ol>) as block structure — every
// other line (including one that merely contains a stray "-" or "*" NOT at
// the start of the line) is plain inline-parsed text. Consecutive list-item
// lines of either unordered marker collapse into one <ul> (this renderer
// doesn't distinguish "-" from "*" as separate list identities — a
// deliberate simplification, not a spec-compliance goal); consecutive
// ordered lines collapse into one <ol>, honoring a non-1 starting number via
// the `start` attribute. Runs of non-list lines are rejoined with "\n" and
// appended as sibling inline content — the container's own
// `white-space: pre-wrap` (business-agent-widget.ts) is what turns that
// preserved "\n" back into a visual line break, so no <br> element is needed.
export function buildSafeMarkdownFragment(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    appendInline(fragment, paragraphLines.join('\n'));
    paragraphLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const ulMatch = UL_LINE.exec(line);
    if (ulMatch) {
      flushParagraph();
      const list = document.createElement('ul');
      while (i < lines.length) {
        const m = UL_LINE.exec(lines[i]);
        if (!m) break;
        const li = document.createElement('li');
        appendInline(li, m[1]);
        list.appendChild(li);
        i += 1;
      }
      fragment.appendChild(list);
      continue;
    }

    const olMatch = OL_LINE.exec(line);
    if (olMatch) {
      flushParagraph();
      const list = document.createElement('ol');
      const firstNumber = Number(olMatch[1]);
      if (Number.isFinite(firstNumber) && firstNumber !== 1) list.start = firstNumber;
      while (i < lines.length) {
        const m = OL_LINE.exec(lines[i]);
        if (!m) break;
        const li = document.createElement('li');
        appendInline(li, m[2]);
        list.appendChild(li);
        i += 1;
      }
      fragment.appendChild(list);
      continue;
    }

    paragraphLines.push(line);
    i += 1;
  }
  flushParagraph();
  return fragment;
}
