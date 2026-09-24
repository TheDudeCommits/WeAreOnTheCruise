/** WANTED poster (harbor best bounty, results screen). Original design: Admiralty notice, bounty in plain numbers. */
import type { ShipDef } from '../../game/types';
import { h, TextCell } from '../core/dom';
import { thumbFor } from '../screens/shipStats';

export class WantedPoster {
  readonly el: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly name: TextCell;
  private readonly epithet: TextCell;
  private readonly label: TextCell;
  readonly amount: TextCell;
  private readonly note: TextCell;
  private readonly stamp: HTMLElement;
  private readonly stampText: TextCell;

  constructor(cls = '') {
    this.img = h('img', 'cr-wanted__img');
    this.img.alt = '';
    this.img.draggable = false;
    const name = h('div', 'cr-wanted__name');
    const epithet = h('div', 'cr-wanted__epithet');
    const label = h('span', 'cr-wanted__label');
    const amount = h('span', 'cr-wanted__amount');
    const note = h('div', 'cr-wanted__note');
    const stampText = h('span', '');
    this.stamp = h('div', 'cr-wanted__stamp', stampText);
    this.el = h('div', `cr-wanted ${cls}`.trim(),
      h('div', 'cr-wanted__paper',
        h('div', 'cr-wanted__head', 'Wanted'),
        h('div', 'cr-wanted__photo', this.img, h('div', 'cr-wanted__photo-grain')),
        name,
        epithet,
        h('div', 'cr-wanted__rule'),
        h('div', 'cr-wanted__bounty', label, amount),
        note,
        h('div', 'cr-wanted__foot', 'By order of the Admiralty'),
      ),
      this.stamp,
    );
    this.name = new TextCell(name);
    this.epithet = new TextCell(epithet);
    this.label = new TextCell(label);
    this.amount = new TextCell(amount);
    this.note = new TextCell(note);
    this.stampText = new TextCell(stampText);
    this.stamp.hidden = true;
  }

  setShip(ship: ShipDef): void {
    const src = thumbFor(ship);
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.name.set(ship.name);
    this.epithet.set(`“${ship.epithet}”`);
  }

  setBounty(label: string, amount: string, note = ''): void {
    this.label.set(label);
    this.amount.set(amount);
    this.note.set(note);
  }

  setStamp(text: string | null, tone: 'red' | 'gold' | 'ink' = 'red'): void {
    this.stamp.hidden = !text;
    this.stamp.dataset.tone = tone;
    if (text) this.stampText.set(text);
  }
}
