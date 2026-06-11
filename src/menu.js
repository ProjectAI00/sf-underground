export class Menu {
  constructor({
    circuits = [],
    getBest = () => null,
    campaign = null, // { missions: [{id, title, taunt}], getProgress: () => nextUnbeatenIndex }
    onStartRace = () => {},
    onStartCampaign = () => {},
    onFreeRoam = () => {},
    onResume = () => {},
    onRestartRace = () => {},
    onQuitToMenu = () => {},
  } = {}) {
    this.circuits = circuits;
    this.getBest = getBest;
    this.campaign = campaign;
    this.callbacks = {
      onStartRace,
      onStartCampaign,
      onFreeRoam,
      onResume,
      onRestartRace,
      onQuitToMenu,
    };

    this.mode = "main";
    this.isShown = false;
    this.loading = false;
    this.inRace = false;
    this.selection = 0;
    this.items = [];

    this.root = document.createElement("div");
    this.root.className = "sf-menu sf-menu--hidden";
    this.root.setAttribute("aria-hidden", "true");

    this.mainView = document.createElement("section");
    this.mainView.className = "sf-menu__view sf-menu__main";
    this.mainView.setAttribute("aria-label", "Main menu");

    const logo = document.createElement("div");
    logo.className = "sf-menu__logo";
    logo.innerHTML = `
      <div class="sf-menu__logo-sf">SF</div>
      <div class="sf-menu__logo-underground">UNDERGROUND</div>
      <div class="sf-menu__tagline">-- SAN FRANCISCO STREET RACING --</div>
    `;

    this.loadingEl = document.createElement("div");
    this.loadingEl.className = "sf-menu__loading";
    this.loadingEl.textContent = "LOADING SAN FRANCISCO...";

    this.mainList = document.createElement("div");
    this.mainList.className = "sf-menu__list sf-menu__main-list";
    this.mainList.setAttribute("role", "menu");

    const footer = document.createElement("div");
    footer.className = "sf-menu__footer";
    footer.innerHTML = `
      <div>ARROWS SELECT &middot; ENTER START &middot; ESC PAUSE IN GAME</div>
      <div>WASD DRIVE &middot; SPACE HANDBRAKE &middot; C CAMERA &middot; R RESET</div>
    `;

    this.mainView.append(logo, this.loadingEl, this.mainList, footer);

    this.pauseView = document.createElement("section");
    this.pauseView.className = "sf-menu__view sf-menu__pause";
    this.pauseView.setAttribute("aria-label", "Pause menu");

    const pausePanel = document.createElement("div");
    pausePanel.className = "sf-menu__pause-panel";

    const pauseTitle = document.createElement("h2");
    pauseTitle.className = "sf-menu__pause-title";
    pauseTitle.textContent = "PAUSED";

    this.pauseList = document.createElement("div");
    this.pauseList.className = "sf-menu__list sf-menu__pause-list";
    this.pauseList.setAttribute("role", "menu");

    pausePanel.append(pauseTitle, this.pauseList);
    this.pauseView.append(pausePanel);
    this.root.append(this.mainView, this.pauseView);
    document.body.appendChild(this.root);

    this.renderMainItems();
    this.renderPauseItems();
    this.updateVisibility();
  }

  get visible() {
    return this.isShown;
  }

  showMain({ loading = false } = {}) {
    this.mode = "main";
    this.loading = Boolean(loading);
    this.selection = 0;
    this.isShown = true;
    this.renderMainItems();
    this.updateVisibility();
    this.updateSelection();
  }

  setLoading(loading) {
    this.loading = Boolean(loading);
    this.updateVisibility();
  }

  showPause({ inRace = false } = {}) {
    this.mode = "pause";
    this.inRace = Boolean(inRace);
    this.loading = false;
    this.selection = 0;
    this.isShown = true;
    this.renderPauseItems();
    this.updateVisibility();
    this.updateSelection();
  }

  hide() {
    this.isShown = false;
    this.updateVisibility();
  }

  handleKey(event) {
    if (!this.visible) return false;

    const key = event.key;
    const isHandledKey = (
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "w" ||
      key === "W" ||
      key === "s" ||
      key === "S" ||
      key === "Enter" ||
      key === " " ||
      key === "Spacebar" ||
      key === "Escape"
    );

    if (!isHandledKey) return false;

    event.preventDefault();

    if (this.mode === "main" && this.loading) {
      return true;
    }

    if (key === "ArrowUp" || key === "w" || key === "W") {
      this.moveSelection(-1);
      return true;
    }

    if (key === "ArrowDown" || key === "s" || key === "S") {
      this.moveSelection(1);
      return true;
    }

    if (key === "Enter" || key === " " || key === "Spacebar") {
      this.activateSelection();
      return true;
    }

    if (key === "Escape") {
      if (this.mode === "pause") {
        this.callbacks.onResume();
      }
      return true;
    }

    return true;
  }

  renderMainItems() {
    this.mainList.replaceChildren();
    this.items = [];

    if (this.campaign) {
      const next = this.campaign.getProgress();
      if (next >= this.campaign.missions.length) {
        this.addItem(this.mainList, {
          label: "CAMPAIGN COMPLETE — YOU BEAT TECH",
          meta: "REPLAY FINAL",
          action: () => this.callbacks.onStartCampaign(this.campaign.missions.length - 1),
        });
      } else {
        const m = this.campaign.missions[next];
        this.addItem(this.mainList, {
          label: `CAMPAIGN: ${m.title}`,
          meta: `${next}/${this.campaign.missions.length} BEATEN`,
          action: () => this.callbacks.onStartCampaign(next),
        });
        if (next > 0) {
          const prev = this.campaign.missions[next - 1];
          this.addItem(this.mainList, {
            label: `REMATCH: ${prev.name}`,
            meta: "BEATEN",
            action: () => this.callbacks.onStartCampaign(next - 1),
          });
        }
      }
    }

    for (const circuit of this.circuits) {
      this.addItem(this.mainList, {
        label: `RACE: ${circuit.label}`,
        meta: this.formatBest(circuit.id),
        action: () => this.callbacks.onStartRace(circuit.id),
      });
    }

    this.addItem(this.mainList, {
      label: "FREE ROAM",
      meta: "",
      action: () => this.callbacks.onFreeRoam(),
    });

    this.clampSelection();
  }

  renderPauseItems() {
    this.pauseList.replaceChildren();

    if (this.mode === "pause") {
      this.items = [];
    }

    this.addItem(this.pauseList, {
      label: "RESUME",
      meta: "",
      action: () => this.callbacks.onResume(),
    });

    if (this.inRace) {
      this.addItem(this.pauseList, {
        label: "RESTART RACE",
        meta: "",
        action: () => this.callbacks.onRestartRace(),
      });
    }

    this.addItem(this.pauseList, {
      label: "QUIT TO MENU",
      meta: "",
      action: () => this.callbacks.onQuitToMenu(),
    });

    this.clampSelection();
  }

  addItem(parent, { label, meta, action }) {
    const index = this.items.length;
    const button = document.createElement("button");
    button.className = "sf-menu__item";
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-selected", "false");

    const chevron = document.createElement("span");
    chevron.className = "sf-menu__chevron";
    chevron.textContent = "►";

    const labelEl = document.createElement("span");
    labelEl.className = "sf-menu__item-label";
    labelEl.textContent = label;

    const metaEl = document.createElement("span");
    metaEl.className = "sf-menu__item-meta";
    metaEl.textContent = meta;

    button.append(chevron, labelEl, metaEl);
    button.addEventListener("mouseenter", () => {
      if (this.mode === "main" && this.loading) return;
      this.selection = index;
      this.updateSelection();
    });
    button.addEventListener("click", () => {
      if (this.mode === "main" && this.loading) return;
      this.selection = index;
      this.activateSelection();
    });

    parent.appendChild(button);
    this.items.push({ button, action });
  }

  moveSelection(delta) {
    if (this.items.length === 0) return;
    this.selection = (this.selection + delta + this.items.length) % this.items.length;
    this.updateSelection();
  }

  activateSelection() {
    const item = this.items[this.selection];
    if (!item) return;
    item.action();
  }

  updateSelection() {
    this.clampSelection();

    for (let index = 0; index < this.items.length; index += 1) {
      const isSelected = index === this.selection;
      const button = this.items[index].button;
      button.classList.toggle("sf-menu__item--selected", isSelected);
      button.setAttribute("aria-selected", String(isSelected));
    }
  }

  updateVisibility() {
    this.root.classList.toggle("sf-menu--hidden", !this.isShown);
    this.root.classList.toggle("sf-menu--loading", this.mode === "main" && this.loading);
    this.mainView.classList.toggle("sf-menu__view--active", this.mode === "main");
    this.pauseView.classList.toggle("sf-menu__view--active", this.mode === "pause");
    this.root.setAttribute("aria-hidden", String(!this.isShown));
  }

  clampSelection() {
    if (this.items.length === 0) {
      this.selection = 0;
      return;
    }

    if (this.selection < 0) {
      this.selection = this.items.length - 1;
    } else if (this.selection >= this.items.length) {
      this.selection = 0;
    }
  }

  formatBest(circuitId) {
    const best = this.getBest(circuitId);

    if (typeof best !== "number" || !Number.isFinite(best)) {
      return "--:--";
    }

    let totalCentiseconds = Math.round(best * 100);
    const minutes = Math.floor(totalCentiseconds / 6000);
    totalCentiseconds -= minutes * 6000;
    const seconds = Math.floor(totalCentiseconds / 100);
    const centiseconds = totalCentiseconds % 100;

    return `BEST ${minutes}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  }
}
