export class Menu {
  constructor({
    onFreeRoam = () => {},
    onMultiplayer = () => {},
    onResume = () => {},
    onLeaveMultiplayer = () => {},
    onQuitToMenu = () => {},
  } = {}) {
    this.callbacks = {
      onFreeRoam,
      onMultiplayer,
      onResume,
      onLeaveMultiplayer,
      onQuitToMenu,
    };

    this.mode = "main"; // main | multiplayer | room | pause
    this.isShown = false;
    this.loading = false;
    this.inMultiplayer = false;
    this.selection = 0;
    this.items = [];
    this.roomCode = "";
    this.roomError = "";

    this.root = document.createElement("div");
    this.root.className = "sf-menu sf-menu--hidden";
    this.root.setAttribute("aria-hidden", "true");

    this.mainView = document.createElement("section");
    this.mainView.className = "sf-menu__view sf-menu__main";
    this.mainView.setAttribute("aria-label", "Main menu");

    const logo = document.createElement("div");
    logo.className = "sf-menu__logo";
    logo.innerHTML = `
      <div class="sf-menu__logo-sf">RETRO RACER</div>
      <div class="sf-menu__logo-underground">SF</div>
      <div class="sf-menu__tagline">-- SAN FRANCISCO FREE ROAM --</div>
    `;

    this.loadingEl = document.createElement("div");
    this.loadingEl.className = "sf-menu__loading";
    this.loadingEl.textContent = "LOADING SAN FRANCISCO...";

    this.mainList = document.createElement("div");
    this.mainList.className = "sf-menu__list sf-menu__main-list sf-menu__main-list--horizontal";
    this.mainList.setAttribute("role", "menu");

    const footer = document.createElement("div");
    footer.className = "sf-menu__footer";
    footer.innerHTML = `
      <div>◀ ▶ OR ARROWS · ENTER START · ESC PAUSE</div>
      <div>WASD DRIVE · SPACE HANDBRAKE · Q RADIO · M MAP</div>
    `;

    this.mainView.append(logo, this.loadingEl, this.mainList, footer);

    this.mpView = document.createElement("section");
    this.mpView.className = "sf-menu__view sf-menu__mp";
    this.mpView.setAttribute("aria-label", "Multiplayer");

    const mpPanel = document.createElement("div");
    mpPanel.className = "sf-menu__pause-panel";

    const mpTitle = document.createElement("h2");
    mpTitle.className = "sf-menu__pause-title";
    mpTitle.textContent = "MULTIPLAYER";

    this.mpHint = document.createElement("p");
    this.mpHint.className = "sf-menu__mp-hint";
    this.mpHint.textContent = "UP TO 100 DRIVERS PER ROOM";

    this.mpList = document.createElement("div");
    this.mpList.className = "sf-menu__list sf-menu__mp-list";
    this.mpList.setAttribute("role", "menu");

    mpPanel.append(mpTitle, this.mpHint, this.mpList);
    this.mpView.append(mpPanel);

    this.roomView = document.createElement("section");
    this.roomView.className = "sf-menu__view sf-menu__room";
    this.roomView.setAttribute("aria-label", "Room code");

    const roomPanel = document.createElement("div");
    roomPanel.className = "sf-menu__pause-panel";

    const roomTitle = document.createElement("h2");
    roomTitle.className = "sf-menu__pause-title";
    roomTitle.textContent = "JOIN ROOM";

    this.roomHint = document.createElement("p");
    this.roomHint.className = "sf-menu__mp-hint";
    this.roomHint.textContent = "TYPE ROOM CODE · ENTER TO JOIN";

    this.roomInput = document.createElement("input");
    this.roomInput.className = "sf-menu__room-input";
    this.roomInput.type = "text";
    this.roomInput.maxLength = 20;
    this.roomInput.spellcheck = false;
    this.roomInput.autocomplete = "off";
    this.roomInput.setAttribute("aria-label", "Room code");

    this.roomErrorEl = document.createElement("p");
    this.roomErrorEl.className = "sf-menu__room-error";

    const roomFooter = document.createElement("p");
    roomFooter.className = "sf-menu__mp-hint sf-menu__mp-hint--dim";
    roomFooter.textContent = "ESC BACK";

    roomPanel.append(roomTitle, this.roomHint, this.roomInput, this.roomErrorEl, roomFooter);
    this.roomView.append(roomPanel);

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

    this.root.append(this.mainView, this.mpView, this.roomView, this.pauseView);
    document.body.appendChild(this.root);

    let menuTouchX = null;
    this.mainView.addEventListener("touchstart", (e) => {
      menuTouchX = e.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    this.mainView.addEventListener("touchend", (e) => {
      if (menuTouchX == null || this.mode !== "main" || this.loading) return;
      const dx = (e.changedTouches[0]?.clientX ?? menuTouchX) - menuTouchX;
      menuTouchX = null;
      if (Math.abs(dx) > 40) this.moveSelection(dx < 0 ? 1 : -1);
    }, { passive: true });

    this.roomInput.addEventListener("input", () => {
      this.roomCode = this.roomInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
      this.roomInput.value = this.roomCode;
      this.roomError = "";
      this.roomErrorEl.textContent = "";
    });

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

  showMultiplayer() {
    this.mode = "multiplayer";
    this.loading = false;
    this.selection = 0;
    this.isShown = true;
    this.renderMultiplayerItems();
    this.updateVisibility();
    this.updateSelection();
  }

  showRoomJoin() {
    this.mode = "room";
    this.roomCode = "";
    this.roomError = "";
    this.roomInput.value = "";
    this.roomErrorEl.textContent = "";
    this.isShown = true;
    this.updateVisibility();
    setTimeout(() => this.roomInput.focus(), 0);
  }

  setRoomError(msg) {
    this.roomError = msg;
    this.roomErrorEl.textContent = msg;
  }

  showPause({ inMultiplayer = false } = {}) {
    this.mode = "pause";
    this.inMultiplayer = Boolean(inMultiplayer);
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

    if (this.mode === "room") {
      if (key === "Escape") {
        event.preventDefault();
        this.showMultiplayer();
        return true;
      }
      if (key === "Enter") {
        event.preventDefault();
        const code = this.roomCode.trim();
        if (code.length < 3) {
          this.setRoomError("ENTER A ROOM CODE");
          return true;
        }
        this.callbacks.onMultiplayer(code);
        return true;
      }
      return false;
    }

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

    if (key === "ArrowUp" || key === "w" || key === "W" || key === "ArrowLeft" || key === "a" || key === "A") {
      this.moveSelection(-1);
      return true;
    }

    if (key === "ArrowDown" || key === "s" || key === "S" || key === "ArrowRight" || key === "d" || key === "D") {
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
      } else if (this.mode === "multiplayer") {
        this.showMain({ loading: false });
      }
      return true;
    }

    return true;
  }

  renderMainItems() {
    this.mainList.replaceChildren();
    this.items = [];

    this.addItem(this.mainList, {
      label: "FREE ROAM",
      meta: "SOLO",
      action: () => this.callbacks.onFreeRoam(),
    });

    this.addItem(this.mainList, {
      label: "STORY MODE",
      meta: "COMING SOON",
      action: () => {},
      disabled: true,
    });

    this.addItem(this.mainList, {
      label: "MULTIPLAYER",
      meta: "COMING SOON",
      action: () => {},
      disabled: true,
    });

    this.clampSelection();
  }

  renderMultiplayerItems() {
    this.mpList.replaceChildren();
    this.items = [];

    this.addItem(this.mpList, {
      label: "CREATE ROOM",
      meta: "NEW CODE",
      action: () => this.callbacks.onMultiplayer(null),
    });

    this.addItem(this.mpList, {
      label: "JOIN ROOM",
      meta: "ENTER CODE",
      action: () => this.showRoomJoin(),
    });

    this.addItem(this.mpList, {
      label: "BACK",
      meta: "",
      action: () => this.showMain({ loading: false }),
    });

    this.clampSelection();
  }

  renderPauseItems() {
    this.pauseList.replaceChildren();
    this.items = [];

    this.addItem(this.pauseList, {
      label: "RESUME",
      meta: "",
      action: () => this.callbacks.onResume(),
    });

    if (this.inMultiplayer) {
      this.addItem(this.pauseList, {
        label: "LEAVE ROOM",
        meta: "",
        action: () => this.callbacks.onLeaveMultiplayer(),
      });
    }

    this.addItem(this.pauseList, {
      label: "QUIT TO MENU",
      meta: "",
      action: () => this.callbacks.onQuitToMenu(),
    });

    this.clampSelection();
  }

  addItem(parent, { label, meta, action, disabled = false }) {
    const index = this.items.length;
    const button = document.createElement("button");
    button.className = "sf-menu__item";
    if (disabled) button.classList.add("sf-menu__item--disabled");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-selected", "false");
    if (disabled) button.setAttribute("aria-disabled", "true");

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
      if ((this.mode === "main" && this.loading) || this.mode === "room") return;
      this.selection = index;
      this.updateSelection();
    });
    button.addEventListener("click", () => {
      if ((this.mode === "main" && this.loading) || this.mode === "room" || disabled) return;
      this.selection = index;
      this.activateSelection();
    });

    parent.appendChild(button);
    this.items.push({ button, action, disabled });
  }

  moveSelection(delta) {
    if (this.items.length === 0) return;
    this.selection = (this.selection + delta + this.items.length) % this.items.length;
    this.updateSelection();
  }

  activateSelection() {
    const item = this.items[this.selection];
    if (!item || item.disabled) return;
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
    this.mpView.classList.toggle("sf-menu__view--active", this.mode === "multiplayer");
    this.roomView.classList.toggle("sf-menu__view--active", this.mode === "room");
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
}
