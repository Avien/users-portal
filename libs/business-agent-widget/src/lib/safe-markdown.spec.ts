// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildSafeMarkdownFragment } from './safe-markdown';

function render(text: string): HTMLDivElement {
  const container = document.createElement('div');
  container.appendChild(buildSafeMarkdownFragment(text));
  return container;
}

describe('buildSafeMarkdownFragment', () => {
  it('renders plain text with no markdown as a single text node', () => {
    const el = render('Dana Levi has spent $238.75.');
    expect(el.textContent).toBe('Dana Levi has spent $238.75.');
    expect(el.children).toHaveLength(0);
  });

  it('renders **bold** as a <strong> element', () => {
    const el = render('Total: **$655.00**');
    const strong = el.querySelector('strong');
    expect(strong?.textContent).toBe('$655.00');
    expect(el.textContent).toBe('Total: $655.00');
  });

  it('renders *italic* as an <em> element', () => {
    const el = render('That order is *unusually* large.');
    const em = el.querySelector('em');
    expect(em?.textContent).toBe('unusually');
  });

  it('renders `inline code` as a <code> element', () => {
    const el = render('Call `getUserOrders` for the details.');
    const code = el.querySelector('code');
    expect(code?.textContent).toBe('getUserOrders');
  });

  it('renders bold, italic, and code together in one line, in order', () => {
    const el = render('Use **bold**, *italic*, and `code` together.');
    const children = Array.from(el.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE
    ) as Element[];
    expect(children.map((c) => c.tagName)).toEqual(['STRONG', 'EM', 'CODE']);
    expect(children.map((c) => c.textContent)).toEqual(['bold', 'italic', 'code']);
  });

  it('renders a "- " unordered list as <ul><li>', () => {
    const el = render('Top orders:\n- Order #101: $655.00\n- Order #99: $410.00');
    const ul = el.querySelector('ul');
    const items = Array.from(ul?.querySelectorAll('li') ?? []);
    expect(items.map((li) => li.textContent)).toEqual(['Order #101: $655.00', 'Order #99: $410.00']);
  });

  it('renders a "* " unordered list the same as "- "', () => {
    const el = render('* first\n* second');
    const items = Array.from(el.querySelectorAll('ul > li'));
    expect(items.map((li) => li.textContent)).toEqual(['first', 'second']);
  });

  it('renders a "1. " ordered list as <ol><li>, without a start attribute when it begins at 1', () => {
    const el = render('1. first\n2. second');
    const ol = el.querySelector('ol') as HTMLOListElement;
    expect(ol.hasAttribute('start')).toBe(false);
    expect(Array.from(ol.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['first', 'second']);
  });

  it('honors a non-1 starting number via the start attribute', () => {
    const el = render('5. five\n6. six');
    const ol = el.querySelector('ol') as HTMLOListElement;
    expect(ol.start).toBe(5);
  });

  it('supports inline formatting inside list items', () => {
    const el = render('- **Dana Levi**: `getUserOrders` shows *3* orders');
    const li = el.querySelector('li') as HTMLLIElement;
    expect(li.querySelector('strong')?.textContent).toBe('Dana Levi');
    expect(li.querySelector('code')?.textContent).toBe('getUserOrders');
    expect(li.querySelector('em')?.textContent).toBe('3');
  });

  it('renders text before/after a list as plain content around the <ul>', () => {
    const el = render('Intro line\n- one\n- two\nOutro line');
    const nodeSummary = Array.from(el.childNodes).map((n) =>
      n.nodeType === Node.TEXT_NODE ? n.textContent : (n as Element).tagName
    );
    expect(nodeSummary).toEqual(['Intro line', 'UL', 'Outro line']);
    const ul = el.querySelector('ul');
    expect(Array.from(ul?.querySelectorAll('li') ?? []).map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  describe('malformed/ambiguous syntax stays inert text (no element created)', () => {
    it('an unterminated ** stays literal', () => {
      const el = render('**bold without a closing marker');
      expect(el.querySelector('strong')).toBeNull();
      expect(el.textContent).toBe('**bold without a closing marker');
    });

    it('a single stray "*" used for multiplication does not become italic', () => {
      const el = render('The total is 3 * 4 = 12, roughly.');
      expect(el.querySelector('em')).toBeNull();
      expect(el.textContent).toBe('The total is 3 * 4 = 12, roughly.');
    });

    it('an unterminated ` stays literal', () => {
      const el = render('a stray ` backtick with no partner');
      expect(el.querySelector('code')).toBeNull();
      expect(el.textContent).toBe('a stray ` backtick with no partner');
    });

    it('a "-" that is not at the start of a line is not treated as a list', () => {
      const el = render('Revenue is up - way up - this quarter.');
      expect(el.querySelector('ul')).toBeNull();
      expect(el.textContent).toBe('Revenue is up - way up - this quarter.');
    });
  });

  describe('XSS: HTML/script content never becomes markup, only inert text', () => {
    it('a raw <script> tag is never parsed into an element', () => {
      const el = render('<script>window.__pwned = true;</script>');
      expect(el.querySelector('script')).toBeNull();
      expect(el.textContent).toBe('<script>window.__pwned = true;</script>');
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    it('an <img onerror=...> payload is never parsed into an element, even inside bold', () => {
      const el = render('**<img src=x onerror="window.__pwned = true">**');
      expect(el.querySelector('img')).toBeNull();
      const strong = el.querySelector('strong');
      expect(strong?.textContent).toBe('<img src=x onerror="window.__pwned = true">');
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    it('an <img onerror=...> payload inside a list item is never parsed into an element', () => {
      const el = render('- <img src=x onerror="window.__pwned = true">');
      expect(el.querySelector('img')).toBeNull();
      const li = el.querySelector('li');
      expect(li?.textContent).toBe('<img src=x onerror="window.__pwned = true">');
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    it('a javascript: URL payload stays inert text — link syntax is not implemented at all', () => {
      const el = render('[click me](javascript:window.__pwned=true)');
      expect(el.querySelector('a')).toBeNull();
      expect(el.textContent).toBe('[click me](javascript:window.__pwned=true)');
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    it('an event-handler-attribute-shaped payload inside inline code stays inert text', () => {
      const el = render('`" onmouseover="window.__pwned=true" x="`');
      const code = el.querySelector('code');
      expect(code?.textContent).toBe('" onmouseover="window.__pwned=true" x="');
      // The payload is text content of a <code> element, never an attribute on
      // any real element — nothing in the fragment carries an onmouseover.
      expect(el.querySelector('[onmouseover]')).toBeNull();
    });

    it('HTML tags embedded in otherwise-plain text never become elements', () => {
      const el = render('Plain text with <b onclick="window.__pwned=true">fake bold</b> inline.');
      expect(el.querySelector('b')).toBeNull();
      expect(el.querySelector('[onclick]')).toBeNull();
      expect(el.textContent).toBe('Plain text with <b onclick="window.__pwned=true">fake bold</b> inline.');
    });
  });
});
