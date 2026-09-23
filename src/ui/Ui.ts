/**
 * Game UI (UI-owned; the UiSystem surface is contract). Stub: minimal title, harbor, HUD, level-up cards,
 * pause and results so the loop is playable. The UI agent replaces this with the real screens.
 */
import { CONTENT } from '../game/content';
import { SEA_IDS, SHIP_IDS, type ShipId } from '../game/ids';
import type { AppScreen } from '../render/frame';
import type { UiCallbacks, UiFrame, UiSystem } from './contracts';

export class Ui implements UiSystem {
  private root!: HTMLElement;
  private cb!: UiCallbacks;
  private screen: AppScreen = 'boot';
  private readonly el = {
    title: document.createElement('div'), harbor: document.createElement('div'), hud: document.createElement('div'),
    cards: document.createElement('div'), pause: document.createElement('div'), results: document.createElement('div'),
  };
  private cardsKey = '';
  private harborKey = '';
  private paused = false;

  get blockingInput(): boolean { return this.paused || this.el.cards.childElementCount > 0 && this.screen === 'run' && !this.el.cards.hidden; }

  mount(root: HTMLElement, callbacks: UiCallbacks): void {
    this.root = root; this.cb = callbacks;
    const layer = document.createElement('div');
    layer.className = 'ui-layer';
    for (const [name, node] of Object.entries(this.el)) { node.className = `ui-${name}`; node.hidden = true; layer.append(node); }
    root.append(layer);
    this.el.title.innerHTML = `<div class="ui-panel"><h1>WE ARE ON THE CRUISE</h1><p>A Brightwater adventure</p><button data-go>Set sail ▸</button></div>`;
    this.el.title.querySelector('[data-go]')!.addEventListener('click', () => { this.cb.onUserGesture(); this.cb.onGoToHarbor(); });
    this.el.pause.innerHTML = `<div class="ui-panel"><h2>Paused</h2><button data-resume>Resume</button> <button data-retire>Retire</button></div>`;
    this.el.pause.querySelector('[data-resume]')!.addEventListener('click', () => this.setPaused(false));
    this.el.pause.querySelector('[data-retire]')!.addEventListener('click', () => { this.setPaused(false); this.cb.onRetire(); });
    window.addEventListener('keydown', this.onKey);
    root.addEventListener('pointerdown', () => this.cb.onUserGesture());
  }

  setScreen(screen: AppScreen): void {
    this.screen = screen;
    this.el.title.hidden = screen !== 'title';
    this.el.harbor.hidden = screen !== 'harbor';
    this.el.hud.hidden = screen !== 'run';
    this.el.results.hidden = screen !== 'results';
    this.el.cards.hidden = screen !== 'run';
    if (screen !== 'run') this.setPaused(false);
    this.harborKey = '';
  }

  update(f: UiFrame): void {
    if (this.screen === 'harbor') this.renderHarbor(f);
    if (this.screen === 'run' && f.run) this.renderRun(f);
    if (this.screen === 'results' && f.result) {
      const r = f.result;
      const key = `${r.outcome}:${r.time}`;
      if (this.el.results.dataset.key !== key) {
        this.el.results.dataset.key = key;
        this.el.results.innerHTML = `<div class="ui-panel"><h2>${r.outcome === 'victory' ? 'Victory!' : r.outcome === 'retired' ? 'Retired' : 'Sunk'}</h2>
          <p>Survived ${fmt(r.time)} · Level ${r.level} · ${r.stats.kills} ships sunk</p><p>Bounty ◈ ${r.stats.bounty.toLocaleString()} · +${r.doubloonsEarned} doubloons</p>
          <p>${r.newUnlocks.join('<br>')}</p><button data-back>Return to harbor</button></div>`;
        this.el.results.querySelector('[data-back]')!.addEventListener('click', () => this.cb.onReturnToHarbor());
      }
    }
  }

  private renderHarbor(f: UiFrame): void {
    const key = `${f.selectedShip}:${f.profile.doubloons}:${f.profile.unlockedShips.join()}`;
    if (key === this.harborKey) return;
    this.harborKey = key;
    const ships = SHIP_IDS.map((id) => {
      const def = CONTENT.ships[id];
      const unlocked = f.profile.unlockedShips.includes(id);
      const lock = def.unlock.kind === 'doubloons' ? `◈ ${def.unlock.cost}` : def.unlock.kind === 'achievement' ? def.unlock.text : '';
      return `<button class="ui-ship ${id === f.selectedShip ? 'is-selected' : ''}" data-ship="${id}" ${unlocked || def.unlock.kind === 'doubloons' ? '' : 'disabled'}>${def.name}<small>${unlocked ? def.epithet : lock}</small></button>`;
    }).join('');
    const seas = SEA_IDS.filter((id) => f.profile.unlockedSeas.includes(id)).map((id) => `<button data-sea="${id}">Sail ${CONTENT.seas[id].name} ▸</button>`).join(' ');
    this.el.harbor.innerHTML = `<div class="ui-panel"><h2>Harbor</h2><p>◈ ${f.profile.doubloons} doubloons</p><div class="ui-ships">${ships}</div><p>${seas}</p></div>`;
    this.el.harbor.querySelectorAll<HTMLButtonElement>('[data-ship]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.ship as ShipId;
      if (f.profile.unlockedShips.includes(id)) this.cb.onSelectShip(id); else this.cb.onUnlockShip(id);
    }));
    this.el.harbor.querySelectorAll<HTMLButtonElement>('[data-sea]').forEach((b) => b.addEventListener('click', () => this.cb.onStartRun(f.selectedShip, b.dataset.sea as never)));
  }

  private renderRun(f: UiFrame): void {
    const run = f.run!;
    const p = run.player;
    const boss = run.bosses[0];
    this.el.hud.innerHTML = `<div class="ui-xp"><i style="width:${(p.xp / p.xpToNext) * 100}%"></i></div>
      <div class="ui-top">LV ${p.level} · ${fmt(run.time)} · ☠ ${run.stats.kills} · ◈ ${run.stats.doubloons}</div>
      ${boss ? `<div class="ui-boss">${CONTENT.bosses[boss.defId].name}<i style="width:${(boss.hp / boss.maxHp) * 100}%"></i></div>` : ''}
      <div class="ui-hull">HULL ${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}<i style="width:${(p.hp / p.maxHp) * 100}%"></i></div>
      <div class="ui-weapons">${p.weapons.map((w) => `<span>${CONTENT.weapons[w.id].name} ${w.overdrive ? '★' : w.level}</span>`).join('')}</div>`;
    const offers = run.status === 'levelup' ? run.offers : null;
    const key = offers ? offers.map((o) => o.title).join('|') : '';
    if (key !== this.cardsKey) {
      this.cardsKey = key;
      this.el.cards.innerHTML = offers ? `<div class="ui-panel"><h2>Level ${p.level}!</h2>${offers.map((o, i) => `<button class="ui-card rarity-${o.rarity}" data-card="${i}"><b>${i + 1}. ${o.title}</b><small>${o.text}</small></button>`).join('')}${run.rerolls > 0 ? `<button data-reroll>Reroll (${run.rerolls})</button>` : ''}</div>` : '';
      this.el.cards.querySelectorAll<HTMLButtonElement>('[data-card]').forEach((b) => b.addEventListener('click', () => this.cb.onChooseCard(Number(b.dataset.card))));
      this.el.cards.querySelector('[data-reroll]')?.addEventListener('click', () => this.cb.onReroll());
    }
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.el.pause.hidden = !paused;
    this.cb?.onPause(paused);
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (this.screen !== 'run') return;
    if (event.code === 'Escape' || event.code === 'KeyP') { this.setPaused(!this.paused); return; }
    const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
    if (index >= 0 && this.cardsKey) this.cb.onChooseCard(index);
    if (event.code === 'KeyX' && this.cardsKey) this.cb.onReroll();
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.querySelector('.ui-layer')?.remove();
  }
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
