/** A panel that scrolls: fade masks top/bottom while there is more to see (classes can-up / can-down on the element). */
export class ScrollFade {
  constructor(readonly el: HTMLElement) {
    el.addEventListener('scroll', () => this.refresh(), { passive: true });
  }

  /** Re-reads the scroll state (on scroll, and after the content or size changes). */
  refresh(): void {
    const el = this.el;
    const up = el.scrollTop > 2;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    if (el.classList.contains('can-up') !== up) el.classList.toggle('can-up', up);
    if (el.classList.contains('can-down') !== down) el.classList.toggle('can-down', down);
  }

  /** Keyboard / pad scrolling when there is nothing to focus inside. Returns whether it moved. */
  nudge(dir: 1 | -1, step = 90): boolean {
    const before = this.el.scrollTop;
    this.el.scrollTop += dir * step;
    this.refresh();
    return this.el.scrollTop !== before;
  }
}
