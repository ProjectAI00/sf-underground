const MAX_TAG_LENGTH = 14;
const FOCUS_ORDER = ["tag", "cars", "confirm"];
const STYLE_ID = "sf-lobby-style";
const TAG_CHAR = /^[a-zA-Z0-9_-]$/;

function clampStat(value) {
  return Math.max(0, Math.min(10, Math.round(Number(value) || 0)));
}

function normalizeTag(value) {
  const raw = String(value || "").trim();
  const body = raw
    .replace(/^@+/, "")
    .replace(/@+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, MAX_TAG_LENGTH - 1);

  return `@${body}`;
}

function tagBody(value) {
  return normalizeTag(value).slice(1);
}

export class Lobby {
  constructor({
    cars = [],
    drawPreview = () => {},
    profile = null,
    onComplete = () => {},
  } = {}) {
    this.cars = cars;
    this.drawPreview = drawPreview;
    this.onComplete = onComplete;
    this.isShown = false;
    this.focusZone = "tag";
    this.cardButtons = [];

    const profileCarIndex = this.cars.findIndex((car) => car.id === profile?.carId);
    this.selectedIndex = profileCarIndex >= 0 ? profileCarIndex : (this.cars.length > 0 ? 0 : -1);

    this.ensureStylesheet();
    this.buildDom(normalizeTag(profile?.tag || ""));
    this.updateSelection();
    this.updateConfirmState();
    this.updateVisibility();
  }

  get visible() {
    return this.isShown;
  }

  get selectedCar() {
    return this.cars[this.selectedIndex] || null;
  }

  show() {
    this.isShown = true;
    this.focusZone = "tag";
    this.updateVisibility();
    this.updateFocusState();
    this.focusCurrentZone();
  }

  hide() {
    this.isShown = false;
    this.updateVisibility();
  }

  handleKey(event) {
    if (!this.visible) return false;

    if (event.__sfLobbyHandled) return true;
    event.__sfLobbyHandled = true;
    event.preventDefault();
    event.stopPropagation();

    this.syncFocusFromTarget(event.target);

    const key = event.key;
    if (key === "Escape") return true;

    if (key === "Tab") {
      this.cycleFocus(event.shiftKey ? -1 : 1);
      return true;
    }

    if (this.focusZone === "tag") {
      return this.handleTagKey(event);
    }

    if (this.focusZone === "cars") {
      return this.handleCarKey(key);
    }

    if (this.focusZone === "confirm") {
      return this.handleConfirmKey(key);
    }

    return true;
  }

  ensureStylesheet() {
    if (document.getElementById(STYLE_ID)) return;

    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = new URL("./lobby.css", import.meta.url).href;
    document.head.appendChild(link);
  }

  buildDom(initialTag) {
    this.root = document.createElement("div");
    this.root.className = "sf-lobby sf-lobby--hidden";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Driver registration");
    this.root.addEventListener("keydown", (event) => this.handleKey(event));

    const shell = document.createElement("section");
    shell.className = "sf-lobby__shell";

    const header = document.createElement("header");
    header.className = "sf-lobby__header";

    const kicker = document.createElement("div");
    kicker.className = "sf-lobby__kicker";
    kicker.textContent = "WELCOME TO SF UNDERGROUND";

    const title = document.createElement("h1");
    title.className = "sf-lobby__title";
    title.textContent = "DRIVER REGISTRATION";

    header.append(kicker, title);

    const body = document.createElement("main");
    body.className = "sf-lobby__body";

    const leftColumn = document.createElement("aside");
    leftColumn.className = "sf-lobby__left";

    this.tagFrame = document.createElement("label");
    this.tagFrame.className = "sf-lobby__field sf-lobby__tag-frame";

    const tagStep = document.createElement("span");
    tagStep.className = "sf-lobby__step";
    tagStep.textContent = "STEP 1";

    const tagLabel = document.createElement("span");
    tagLabel.className = "sf-lobby__field-label";
    tagLabel.textContent = "PICK A GAMER TAG";

    this.tagInput = document.createElement("input");
    this.tagInput.className = "sf-lobby__tag-input";
    this.tagInput.type = "text";
    this.tagInput.maxLength = MAX_TAG_LENGTH;
    this.tagInput.spellcheck = false;
    this.tagInput.autocomplete = "off";
    this.tagInput.inputMode = "text";
    this.tagInput.value = initialTag;
    this.tagInput.setAttribute("aria-label", "Pick a gamer tag");
    this.tagInput.addEventListener("focus", () => this.setFocus("tag"));
    this.tagInput.addEventListener("input", () => this.normalizeInputFromDom());

    const tagHint = document.createElement("span");
    tagHint.className = "sf-lobby__hint";
    tagHint.textContent = "2+ CHARS AFTER @";

    this.tagFrame.append(tagStep, tagLabel, this.tagInput, tagHint);

    this.carSummary = document.createElement("div");
    this.carSummary.className = "sf-lobby__field sf-lobby__car-summary";

    const carStep = document.createElement("span");
    carStep.className = "sf-lobby__step";
    carStep.textContent = "STEP 2";

    const carLabel = document.createElement("span");
    carLabel.className = "sf-lobby__field-label";
    carLabel.textContent = "PICK A CAR";

    this.selectedCarName = document.createElement("div");
    this.selectedCarName.className = "sf-lobby__selected-name";

    const carHint = document.createElement("div");
    carHint.className = "sf-lobby__hint";
    carHint.textContent = "ARROWS CHANGE RIDE";

    this.carSummary.append(carStep, carLabel, this.selectedCarName, carHint);

    leftColumn.append(this.tagFrame, this.carSummary);

    this.garagePanel = document.createElement("section");
    this.garagePanel.className = "sf-lobby__garage";
    this.garagePanel.setAttribute("aria-label", "Select your ride");

    const garageTop = document.createElement("div");
    garageTop.className = "sf-lobby__garage-top";

    const garageTitle = document.createElement("h2");
    garageTitle.className = "sf-lobby__garage-title";
    garageTitle.textContent = "SELECT YOUR RIDE";

    const garageMeta = document.createElement("div");
    garageMeta.className = "sf-lobby__garage-meta";
    garageMeta.textContent = "BAY 04 / NIGHT RUN";

    garageTop.append(garageTitle, garageMeta);

    this.cardGrid = document.createElement("div");
    this.cardGrid.className = "sf-lobby__cars";
    this.cardGrid.setAttribute("role", "radiogroup");
    this.cardGrid.setAttribute("aria-label", "Car selection");

    for (let index = 0; index < this.cars.length; index += 1) {
      this.cardGrid.appendChild(this.createCarCard(this.cars[index], index));
    }

    this.garagePanel.append(garageTop, this.cardGrid);
    body.append(leftColumn, this.garagePanel);

    const footer = document.createElement("footer");
    footer.className = "sf-lobby__footer";

    this.confirmButton = document.createElement("button");
    this.confirmButton.className = "sf-lobby__confirm";
    this.confirmButton.type = "button";
    this.confirmButton.innerHTML = '<span>START YOUR ENGINE</span><span class="sf-lobby__confirm-chev">►</span>';
    this.confirmButton.addEventListener("focus", () => this.setFocus("confirm"));
    this.confirmButton.addEventListener("click", () => this.confirm());

    const controls = document.createElement("div");
    controls.className = "sf-lobby__controls";
    controls.textContent = "TAB / ARROWS MOVE · ENTER CONFIRMS · ESC IGNORED";

    footer.append(this.confirmButton, controls);
    shell.append(header, body, footer);
    this.root.appendChild(shell);
    document.body.appendChild(this.root);
  }

  createCarCard(car, index) {
    const card = document.createElement("button");
    card.className = "sf-lobby__car";
    card.type = "button";
    card.setAttribute("role", "radio");
    card.style.setProperty("--car-color", car.color || "#ffc24b");
    card.style.setProperty("--car-accent", car.accent || "#4be0c8");

    const previewWrap = document.createElement("div");
    previewWrap.className = "sf-lobby__preview-wrap";

    const canvas = document.createElement("canvas");
    canvas.className = "sf-lobby__preview";
    canvas.width = 176;
    canvas.height = 96;
    canvas.setAttribute("aria-hidden", "true");
    this.drawPreview(canvas, car.id);
    previewWrap.appendChild(canvas);

    const name = document.createElement("div");
    name.className = "sf-lobby__car-name";
    name.textContent = car.name;

    const badge = document.createElement("div");
    badge.className = "sf-lobby__tier";
    badge.textContent = `${car.tier || "B"}-TIER`;

    const blurb = document.createElement("div");
    blurb.className = "sf-lobby__blurb";
    blurb.textContent = car.blurb || "";

    const stats = document.createElement("div");
    stats.className = "sf-lobby__stats";
    stats.append(
      this.createStat("SPEED", car.stats?.speed),
      this.createStat("ACCEL", car.stats?.accel),
      this.createStat("BRAKES", car.stats?.brakes),
      this.createStat("CORNER", car.stats?.cornering),
      this.createStat("AURA", car.stats?.aura, true),
    );

    card.append(previewWrap, name, badge, blurb, stats);
    card.addEventListener("focus", () => {
      this.selectedIndex = index;
      this.setFocus("cars");
      this.updateSelection();
    });
    card.addEventListener("mouseenter", () => card.classList.add("sf-lobby__car--hovered"));
    card.addEventListener("mouseleave", () => card.classList.remove("sf-lobby__car--hovered"));
    card.addEventListener("click", () => {
      this.selectedIndex = index;
      this.setFocus("cars");
      this.updateSelection();
    });

    this.cardButtons.push(card);
    return card;
  }

  createStat(label, value, isAura = false) {
    const row = document.createElement("div");
    row.className = `sf-lobby__stat${isAura ? " sf-lobby__stat--aura" : ""}`;

    const labelEl = document.createElement("span");
    labelEl.className = "sf-lobby__stat-label";
    labelEl.textContent = label;

    const bar = document.createElement("span");
    bar.className = "sf-lobby__stat-bar";
    bar.setAttribute("aria-label", `${label} ${clampStat(value)} of 10`);

    const filled = clampStat(value);
    for (let index = 0; index < 10; index += 1) {
      const segment = document.createElement("span");
      segment.className = `sf-lobby__stat-seg${index < filled ? " sf-lobby__stat-seg--filled" : ""}`;
      bar.appendChild(segment);
    }

    row.append(labelEl, bar);
    return row;
  }

  handleTagKey(event) {
    const key = event.key;

    if (key === "Enter") {
      this.setFocus("cars", true);
      return true;
    }

    if (key === "ArrowDown") {
      this.setFocus("cars", true);
      return true;
    }

    if (key === "ArrowUp") {
      this.setFocus("confirm", true);
      return true;
    }

    if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") {
      this.moveTagCursor(key);
      return true;
    }

    if (key === "Backspace" || key === "Delete") {
      this.deleteTagText(key);
      return true;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return true;

    if (key.length === 1 && TAG_CHAR.test(key)) {
      this.replaceTagSelection(key);
      return true;
    }

    return true;
  }

  handleCarKey(key) {
    if (key === "ArrowLeft" || key === "a" || key === "A") {
      this.moveCarSelection(-1);
      return true;
    }

    if (key === "ArrowRight" || key === "d" || key === "D") {
      this.moveCarSelection(1);
      return true;
    }

    if (key === "ArrowUp" || key === "w" || key === "W") {
      this.setFocus("tag", true);
      return true;
    }

    if (key === "ArrowDown" || key === "s" || key === "S") {
      this.setFocus("confirm", true);
      return true;
    }

    if (key === "Enter" || key === " " || key === "Spacebar") {
      this.confirm();
      return true;
    }

    return true;
  }

  handleConfirmKey(key) {
    if (key === "ArrowUp" || key === "w" || key === "W") {
      this.setFocus("cars", true);
      return true;
    }

    if (key === "ArrowDown" || key === "s" || key === "S") {
      this.setFocus("tag", true);
      return true;
    }

    if (key === "ArrowLeft" || key === "a" || key === "A") {
      this.setFocus("cars", true);
      this.moveCarSelection(-1);
      return true;
    }

    if (key === "ArrowRight" || key === "d" || key === "D") {
      this.setFocus("cars", true);
      this.moveCarSelection(1);
      return true;
    }

    if (key === "Enter" || key === " " || key === "Spacebar") {
      this.confirm();
      return true;
    }

    return true;
  }

  replaceTagSelection(insert) {
    const input = this.tagInput;
    const value = input.value || "@";
    const start = Math.max(1, input.selectionStart ?? value.length);
    const end = Math.max(1, input.selectionEnd ?? value.length);
    const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
    this.setTag(next, start + insert.length);
  }

  deleteTagText(key) {
    const input = this.tagInput;
    const value = input.value || "@";
    let start = Math.max(1, input.selectionStart ?? value.length);
    let end = Math.max(1, input.selectionEnd ?? value.length);

    if (start === end) {
      if (key === "Backspace" && start > 1) {
        start -= 1;
      } else if (key === "Delete" && end < value.length) {
        end += 1;
      } else {
        return;
      }
    }

    const next = `${value.slice(0, start)}${value.slice(end)}`;
    this.setTag(next, start);
  }

  moveTagCursor(key) {
    const input = this.tagInput;
    const value = input.value || "@";
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    let cursor = end;

    if (key === "ArrowLeft") cursor = Math.max(1, start - 1);
    if (key === "ArrowRight") cursor = Math.min(value.length, end + 1);
    if (key === "Home") cursor = 1;
    if (key === "End") cursor = value.length;

    this.placeTagCursor(cursor);
  }

  setTag(value, cursor = null) {
    const normalized = normalizeTag(value);
    this.tagInput.value = normalized;
    this.updateConfirmState();

    if (cursor !== null) {
      this.placeTagCursor(Math.min(Math.max(1, cursor), normalized.length));
    }
  }

  normalizeInputFromDom() {
    const cursor = Math.max(1, this.tagInput.selectionStart ?? this.tagInput.value.length);
    this.setTag(this.tagInput.value, cursor);
  }

  placeTagCursor(cursor) {
    this.tagInput.setSelectionRange(cursor, cursor);
  }

  moveCarSelection(delta) {
    if (this.cars.length === 0) return;

    this.selectedIndex = (this.selectedIndex + delta + this.cars.length) % this.cars.length;
    this.updateSelection();
    this.focusCurrentZone();
  }

  cycleFocus(delta) {
    const current = FOCUS_ORDER.indexOf(this.focusZone);
    const nextIndex = (current + delta + FOCUS_ORDER.length) % FOCUS_ORDER.length;
    this.setFocus(FOCUS_ORDER[nextIndex], true);
  }

  setFocus(zone, shouldFocus = false) {
    this.focusZone = zone;
    this.updateFocusState();
    if (shouldFocus) this.focusCurrentZone();
  }

  focusCurrentZone() {
    if (!this.visible) return;

    if (this.focusZone === "tag") {
      this.tagInput.focus({ preventScroll: true });
      this.placeTagCursor(this.tagInput.value.length);
      return;
    }

    if (this.focusZone === "cars") {
      this.cardButtons[this.selectedIndex]?.focus({ preventScroll: true });
      return;
    }

    this.confirmButton.focus({ preventScroll: true });
  }

  syncFocusFromTarget(target) {
    if (target === this.tagInput) {
      this.setFocus("tag");
      return;
    }

    if (target === this.confirmButton) {
      this.setFocus("confirm");
      return;
    }

    const cardIndex = this.cardButtons.indexOf(target);
    if (cardIndex >= 0) {
      this.selectedIndex = cardIndex;
      this.setFocus("cars");
      this.updateSelection();
    }
  }

  updateSelection() {
    for (let index = 0; index < this.cardButtons.length; index += 1) {
      const selected = index === this.selectedIndex;
      const card = this.cardButtons[index];
      card.classList.toggle("sf-lobby__car--selected", selected);
      card.setAttribute("aria-checked", String(selected));
      card.tabIndex = selected ? 0 : -1;
    }

    const car = this.selectedCar;
    this.selectedCarName.textContent = car ? car.name : "NO CARS FOUND";
    this.updateConfirmState();
    this.updateFocusState();
  }

  updateFocusState() {
    this.root.dataset.focus = this.focusZone;
    this.tagFrame.classList.toggle("sf-lobby__field--focused", this.focusZone === "tag");
    this.carSummary.classList.toggle("sf-lobby__field--focused", this.focusZone === "cars");
    this.garagePanel.classList.toggle("sf-lobby__garage--focused", this.focusZone === "cars");
    this.confirmButton.classList.toggle("sf-lobby__confirm--focused", this.focusZone === "confirm");
  }

  updateConfirmState() {
    const ready = this.canConfirm();
    this.confirmButton?.classList.toggle("sf-lobby__confirm--ready", ready);
    this.confirmButton?.setAttribute("aria-disabled", String(!ready));
  }

  updateVisibility() {
    this.root.classList.toggle("sf-lobby--hidden", !this.isShown);
    this.root.setAttribute("aria-hidden", String(!this.isShown));
  }

  canConfirm() {
    return tagBody(this.tagInput?.value).length >= 2 && Boolean(this.selectedCar);
  }

  confirm() {
    if (!this.canConfirm()) {
      if (tagBody(this.tagInput.value).length < 2) {
        this.shake(this.tagFrame);
        this.setFocus("tag", true);
      } else {
        this.shake(this.garagePanel);
        this.setFocus("cars", true);
      }
      return;
    }

    this.onComplete({
      tag: normalizeTag(this.tagInput.value),
      carId: this.selectedCar.id,
    });
  }

  shake(element) {
    element.classList.remove("sf-lobby--shake");
    void element.offsetWidth;
    element.classList.add("sf-lobby--shake");
    window.setTimeout(() => element.classList.remove("sf-lobby--shake"), 360);
  }
}
