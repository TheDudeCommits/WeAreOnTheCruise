/** Title: animated brush logo over the living 3D showcase, "press any key". */
import { h } from '../core/dom';
import { keycap, padButton } from '../core/prompts';

function letters(text: string, start: number): { el: HTMLElement; count: number } {
  const line = h('span', 'cr-logo__line');
  let i = start;
  for (const word of text.split(' ')) {
    const w = h('span', 'cr-logo__word');
    for (const ch of word) {
      const s = h('span', 'cr-logo__ch', ch);
      s.style.setProperty('--i', String(i++));
      w.append(s);
    }
    line.append(w);
  }
  return { el: line, count: i - start };
}

export function buildLogo(compact = false): HTMLElement {
  const l1 = letters('We are on', 0);
  const l2 = letters('The Cruise', l1.count);
  l1.el.classList.add('is-l1');
  l2.el.classList.add('is-l2');
  const title = h('h1', 'cr-logo__title', l1.el, l2.el);
  title.setAttribute('aria-label', 'We Are On The Cruise');
  const emblem = h('img', 'cr-logo__emblem');
  emblem.src = '/ui/emblem.svg';
  emblem.alt = '';
  emblem.draggable = false;
  const logo = h('div', `cr-logo${compact ? ' is-compact' : ''}`,
    h('div', 'cr-logo__blot'),
    emblem,
    title,
    h('div', 'cr-logo__swash'),
    h('div', 'cr-logo__sub', h('span', '', 'A Brightwater Adventure')),
    h('div', 'cr-logo__shine'),
  );
  logo.style.setProperty('--n', String(l1.count + l2.count));
  return logo;
}

export class TitleScreen {
  readonly el: HTMLElement;
  private readonly logo: HTMLElement;

  constructor(private readonly go: () => void) {
    this.logo = buildLogo();
    const promptLine = h('div', 'cr-title__prompt',
      h('span', 'cr-title__press', 'Press any key'),
      h('span', 'cr-title__inputs',
        keycap('ANY KEY'), h('span', 'cr-title__dot', '·'), h('span', 'cr-title__mouse', 'CLICK'), h('span', 'cr-title__dot', '·'), padButton('A')),
    );
    const credits = h('a', 'cr-title__credits', 'Credits');
    credits.href = '/credits.html';
    credits.target = '_blank';
    credits.rel = 'noopener';
    credits.addEventListener('pointerdown', (e) => e.stopPropagation());
    credits.addEventListener('click', (e) => e.stopPropagation());
    this.el = h('section', 'cr-screen cr-title',
      h('div', 'cr-title__vignette'),
      h('div', 'cr-title__logo', this.logo),
      promptLine,
      h('footer', 'cr-title__foot', h('span', 'cr-title__tag', 'An original naval adventure on the Brightwater'), credits),
    );
    this.el.hidden = true;
    this.el.addEventListener('pointerdown', (e) => { if (e.button === 0) this.go(); });
  }

  show(): void {
    this.el.hidden = false;
    // Restart the intro every time the title appears.
    this.el.classList.remove('is-intro');
    void this.el.offsetWidth;
    this.el.classList.add('is-intro');
  }

  hide(): void { this.el.hidden = true; }

  onKey(e: KeyboardEvent): boolean {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.code === 'Tab' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'CapsLock') return false;
    this.go();
    return true;
  }
}
