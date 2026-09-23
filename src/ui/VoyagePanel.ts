import type { CrewPreset, WorldState, VoyageBuildId, VoyageState } from "../core/contracts";
import {
  VOYAGE_CONTRACTS,
  VOYAGE_BUILDS,
  VOYAGE_UPGRADES,
  HARBOR_REFITS,
  CREW_PRESETS,
} from "../content/voyages";

export type VoyageAction =
  | { type: "start"; contractId: string; buildId: VoyageBuildId }
  | { type: "route"; routeId: string }
  | { type: "reward"; upgradeId: string }
  | { type: "collect" }
  | { type: "extract" }
  | { type: "harbor" }
  | { type: "refit"; refitId: string }
  | { type: "crew"; preset: CrewPreset }
  | {
      type: "resolve";
      shipId: string;
      resolution: "salvage" | "spare" | "sink";
    };

const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

/** Reward selection advances the next leg while retaining the completed encounter. */
export function voyageStageLabel(voyage: VoyageState): string {
  if (voyage.result?.outcome === "extracted") {
    const completedLeg = voyage.encounter?.completed
      ? voyage.encounter.id.match(/:leg-(\d+)$/)?.[1]
      : undefined;
    return completedLeg
      ? `EXTRACTED AFTER LEG ${completedLeg} OF ${voyage.totalLegs}`
      : "VOYAGE EXTRACTED";
  }
  if (voyage.result?.outcome === "completed") return `ALL ${voyage.totalLegs} LEGS COMPLETE`;
  return `LEG ${voyage.leg} / ${voyage.totalLegs}`;
}

/** State-driven port/route/reward views. All progression mutations belong to the simulation. */
export class VoyagePanel {
  readonly element: HTMLElement;
  private state?: WorldState;
  private key = "";
  private contractId: string = VOYAGE_CONTRACTS[0].id;
  private buildId: VoyageBuildId = "precision";
  private open = false;
  private forced = false;
  private busy = false;
  private dismissedPhase = "";
  private hideAtIntro = true;
  constructor(
    host: HTMLElement,
    private readonly act?: (action: VoyageAction) => void | Promise<void>,
    private readonly onBlocking?: (blocked: boolean) => void,
    private readonly onShipSelect?: () => void,
  ) {
    this.element = document.createElement("section");
    this.element.className = "voyage-panel";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "Voyage chart and harbor");
    this.element.setAttribute("role", "dialog");
    this.element.addEventListener("click", this.onClick);
    host.append(this.element);
  }
  get isOpen(): boolean {
    return this.open;
  }
  setIntroHidden(hidden: boolean): void {
    this.hideAtIntro = hidden;
    this.key = "";
    if (this.state) this.update(this.state);
  }
  show(): void {
    this.dismissedPhase = "";
    this.forced = true;
    this.key = "";
    if (this.state) this.update(this.state);
  }
  close(): void {
    this.dismissedPhase = `${this.state?.voyage?.id}:${this.state?.voyage?.phase}:${this.state?.voyage?.leg}`;
    this.forced = false;
    this.open = false;
    this.element.hidden = true;
    this.onBlocking?.(false);
  }
  update(state: WorldState): void {
    this.state = state;
    const voyage = state.voyage;
    const phaseKey = `${voyage?.id}:${voyage?.phase}:${voyage?.leg}`;
    const isAutomatic = Boolean(
      voyage &&
        ["route", "reward", "complete", "failed"].includes(voyage.phase),
    );
    const shouldOpen =
      !this.hideAtIntro &&
      Boolean(voyage) &&
      (this.forced || (isAutomatic && phaseKey !== this.dismissedPhase));
    if (shouldOpen !== this.open) {
      this.open = shouldOpen;
      this.element.hidden = !shouldOpen;
      this.onBlocking?.(shouldOpen);
    }
    if (!shouldOpen || !voyage) return;
    const player = state.ships.find((ship) => ship.id === state.playerId);
    const key = JSON.stringify([
      voyage.id,
      voyage.phase,
      voyage.leg,
      voyage.unbankedCoins,
      voyage.result,
      voyage.rewardChoices,
      voyage.upgrades,
      voyage.encounter?.completed,
      state.progression?.bankedCoins,
      state.progression?.refits,
      player?.crewPreset,
      this.contractId,
      this.buildId,
    ]);
    if (key === this.key) return;
    this.key = key;
    const progress = state.progression;
    const bank = progress?.bankedCoins ?? 0;
    const phase = voyage.phase;
    let body = "";
    if (phase === "harbor") {
      body = `<div class="chart-section-heading"><span>01 · ACCEPT A CONTRACT</span><small>Three encounters. Choose your risk.</small></div><div class="contract-grid">${VOYAGE_CONTRACTS.map((entry) => `<button type="button" class="chart-choice ${entry.id === this.contractId ? "is-selected" : ""}" data-contract="${entry.id}" aria-pressed="${entry.id === this.contractId}"><small>${entry.legs} LEGS · ${entry.reward} BONUS ON FULL COMPLETION</small><strong>${entry.name}</strong><span>${entry.description}</span></button>`).join("")}</div>
        <div class="chart-section-heading"><span>02 · PREPARE YOUR CREW</span><small>Each build has a cost.</small></div><div class="build-grid">${VOYAGE_BUILDS.map((entry) => `<button type="button" class="chart-choice ${entry.id === this.buildId ? "is-selected" : ""}" data-build="${entry.id}" aria-pressed="${entry.id === this.buildId}"><strong>${entry.name}</strong><span>${entry.description}</span></button>`).join("")}</div>
        <details class="refit-list"><summary>HARBOR REFITS <span>${bank} BANKED COINS AVAILABLE</span></summary>${HARBOR_REFITS.map(
          (entry) => {
            const owned = (progress?.refits[entry.id] ?? 0) >= entry.maxLevel;
            return `<div><span><b>${entry.name}${owned ? " · FITTED" : ""}</b><small>${entry.description}</small></span><button type="button" data-refit="${entry.id}" ${owned || bank < entry.cost ? "disabled" : ""}>${owned ? "FITTED" : `${entry.cost} ◈`}</button></div>`;
          },
        ).join("")}</details>
        <footer><button type="button" class="quiet-button" data-voyage="ship">CHANGE VESSEL</button><button type="button" class="primary-button" data-voyage="start">ACCEPT CONTRACT <span>→</span></button></footer>`;
    } else if (phase === "route") {
      body = `<p class="chart-lede">${voyage.leg === 1 ? "Your voyage begins here. Choose the water you want to sail." : "The crew is ready. Push on for the contract or bank your spoils."}</p><div class="route-grid">${voyage.routes.map((entry) => `<button type="button" class="chart-choice route-choice" data-route="${entry.id}"><small>${entry.risk === "dangerous" ? "◆ DANGEROUS WATER" : "◇ MEASURED PASSAGE"} · ${entry.weather.toUpperCase()}</small><strong>${entry.name}</strong><span>${entry.description}</span><b class="route-reward">${entry.reward} COINS IF WON <i>SAIL THIS ROUTE →</i></b></button>`).join("")}</div>${this.extraction(voyage.extractionReady, voyage.unbankedCoins)}`;
    } else if (phase === "reward") {
      body = `<p class="chart-lede">The encounter is won. Choose one ship upgrade for the rest of this voyage.</p><div class="reward-grid">${voyage.rewardChoices
        .map((id) => VOYAGE_UPGRADES.find((entry) => entry.id === id))
        .filter((entry) => Boolean(entry))
        .map(
          (entry) =>
            `<button type="button" class="chart-choice" data-reward="${entry!.id}"><small>VOYAGE UPGRADE</small><strong>${entry!.name}</strong><span>${entry!.description}</span><b class="route-reward">TAKE UPGRADE →</b></button>`,
        )
        .join(
          "",
        )}</div>${this.extraction(voyage.extractionReady, voyage.unbankedCoins)}`;
    } else if (phase === "complete" || phase === "failed") {
      const result = voyage.result;
      body = `<div class="voyage-result"><span>${result?.outcome === "completed" ? "CONTRACT FULFILLED" : result?.outcome === "extracted" ? "SPOILS SECURED" : "THE SEA TAKES ITS DUE"}</span><strong>${result?.coins ?? 0}<small> COINS BANKED</small></strong><p>${result?.outcome === "lost" ? "Previously banked coins and permanent harbor refits are safe. Temporary voyage upgrades end here. Refit and sail again." : "Coins are banked and permanent harbor refits stay fitted. Temporary voyage upgrades end here. Choose a new contract at the harbor."}</p></div><footer><span>${progress?.completedVoyages ?? 0} CONTRACTS COMPLETED</span><button type="button" class="primary-button" data-voyage="harbor">RETURN TO HARBOR →</button></footer>`;
    } else {
      body = `<p class="chart-lede">${escapeHtml(voyage.encounter?.objective ?? state.objective)}</p><div class="crew-panel"><div class="chart-section-heading"><span>CREW STATIONS</span><small>10 hands. Every assignment changes the ship.</small></div>${(
        Object.keys(CREW_PRESETS) as CrewPreset[]
      )
        .map((preset) => {
          const crew = CREW_PRESETS[preset];
          return `<button type="button" class="crew-order ${player?.crewPreset === preset ? "is-selected" : ""}" data-crew="${preset}"><b>${preset.toUpperCase()}</b><span>${crew.helm} helm · ${crew.guns} guns · ${crew.repair} repair · ${crew.special} special</span></button>`;
        })
        .join(
          "",
        )}</div><footer><span>${voyage.unbankedCoins} UNBANKED COINS AT RISK</span>${voyage.encounter?.completed ? '<button type="button" class="primary-button" data-voyage="collect">COLLECT REWARDS →</button>' : '<button type="button" class="primary-button" data-voyage="close">BACK TO THE HELM →</button>'}</footer>`;
    }
    const activeButton =
      document.activeElement instanceof HTMLButtonElement &&
      this.element.contains(document.activeElement)
        ? document.activeElement
        : undefined;
    const activeIdentity = activeButton
      ? Object.entries(activeButton.dataset).find(([key]) =>
          [
            "contract",
            "build",
            "refit",
            "crew",
            "route",
            "reward",
            "voyage",
          ].includes(key),
        )
      : undefined;
    this.element.innerHTML = `<header><div><p class="eyebrow">${phase === "harbor" ? "DAWN HARBOR · CAPTAIN’S CHART" : `VOYAGE LOG · ${voyageStageLabel(voyage)}`}</p><h2>${phase === "harbor" ? "A new horizon." : phase === "route" ? "Choose your passage." : phase === "reward" ? "Make this ship yours." : phase === "complete" ? "Welcome home, Captain." : phase === "failed" ? "Another tide will turn." : "All hands to stations."}</h2></div><button type="button" class="panel-close" data-voyage="close" aria-label="Close voyage chart">×</button></header>${body}<p class="panel-feedback" role="status"></p>`;
    if (activeIdentity) {
      const [key, value] = activeIdentity;
      this.element
        .querySelector<HTMLButtonElement>(
          `[data-${key}="${CSS.escape(value ?? "")}"]`,
        )
        ?.focus({ preventScroll: true });
    }
  }
  private extraction(ready: boolean, coins: number): string {
    return `<p class="voyage-risk-rule">Defeat loses unbanked coins. Extracting banks them and ends this voyage. Temporary voyage upgrades end; permanent harbor refits stay fitted.</p><footer><span>${coins} UNBANKED COINS AT RISK</span>${ready ? '<button type="button" class="quiet-button" data-voyage="extract">EXTRACT & BANK SPOILS</button>' : "<small>Complete an encounter to unlock extraction.</small>"}</footer>`;
  }
  private readonly onClick = async (event: MouseEvent): Promise<void> => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button",
    );
    if (!button || this.busy) return;
    if (button.dataset.contract) {
      this.contractId = button.dataset.contract;
      this.key = "";
      if (this.state) this.update(this.state);
      return;
    }
    if (button.dataset.build) {
      this.buildId = button.dataset.build as VoyageBuildId;
      this.key = "";
      if (this.state) this.update(this.state);
      return;
    }
    if (button.dataset.voyage === "close") {
      this.close();
      return;
    }
    if (button.dataset.voyage === "ship") {
      this.close();
      this.onShipSelect?.();
      return;
    }
    let action: VoyageAction | undefined;
    if (button.dataset.voyage === "start")
      action = {
        type: "start",
        contractId: this.contractId,
        buildId: this.buildId,
      };
    if (button.dataset.voyage === "harbor") action = { type: "harbor" };
    if (button.dataset.voyage === "extract") action = { type: "extract" };
    if (button.dataset.voyage === "collect") action = { type: "collect" };
    if (button.dataset.route)
      action = { type: "route", routeId: button.dataset.route };
    if (button.dataset.reward)
      action = { type: "reward", upgradeId: button.dataset.reward };
    if (button.dataset.refit)
      action = { type: "refit", refitId: button.dataset.refit };
    if (button.dataset.crew)
      action = { type: "crew", preset: button.dataset.crew as CrewPreset };
    if (!action) return;
    this.busy = true;
    try {
      await this.act?.(action);
      if (
        ["route", "harbor", "start", "reward", "extract", "collect"].includes(
          action.type,
        )
      ) {
        this.forced = action.type === "harbor";
        this.dismissedPhase = "";
      }
      if (action.type === "route") this.close();
      this.key = "";
    } catch (error) {
      const feedback = this.element.querySelector(".panel-feedback");
      if (feedback)
        feedback.textContent =
          error instanceof Error
            ? error.message
            : "That order could not be completed.";
    } finally {
      this.busy = false;
    }
  };
}
