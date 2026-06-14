import { makeCarSpriteFor } from "./cars.js";
import { preloadCarSprite } from "./car-sprites.js";

const MAX_TAG_LENGTH = 14;

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, MAX_TAG_LENGTH)
    .toUpperCase();
}

export class Lobby {
  constructor({ cars = [], profile = null, onComplete = () => {} } = {}) {
    this.cars = cars;
    this.onComplete = onComplete;
    this.isShown = false;
    this.sprites = new Map();
    this.animFrame = null;
    this.bobPhase = 0;

    const profileCarIndex = this.cars.findIndex((c) => c.id === profile?.carId);
    this.selectedIndex = profileCarIndex >= 0 ? profileCarIndex : 0;
    this.initialTag = profile?.tag?.replace(/^@/, "") || "";

    this.buildDom();
    this.renderCards();
    this.updateSelection();
    this.startAnimLoop();
  }

  get visible() {
    return this.isShown;
  }

  get selectedCar() {
    return this.cars[this.selectedIndex] || null;
  }

  spriteFor(carId) {
    if (!this.sprites.has(carId)) {
      const def = this.cars.find((c) => c.id === carId);
      if (def) {
        this.sprites.set(carId, makeCarSpriteFor(def, 6));
        preloadCarSprite(carId, () => {
          this.sprites.set(carId, makeCarSpriteFor(def, 6));
          this.paintCards();
        });
      }
    }
    return this.sprites.get(carId);
  }

  show() {
    this.isShown = true;
    this.root.classList.remove("sf-lobby--hidden");
    this.tagInput.focus();
    this.scrollToSelected();
  }

  hide() {
    this.isShown = false;
    this.root.classList.add("sf-lobby--hidden");
  }

  handleKey(event) {
    if (!this.visible) return false;

    // If typing in input, only handle special keys
    if (document.activeElement === this.tagInput) {
      if (event.key === "Enter") {
        event.preventDefault();
        this.cardButtons[this.selectedIndex]?.focus();
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.cardButtons[this.selectedIndex]?.focus();
        return true;
      }
      // Let all other keys go to the input normally
      return false;
    }

    const key = event.key;
    if (key === "Escape") return true;

    if (key === "ArrowLeft" || key === "a" || key === "A") {
      event.preventDefault();
      this.moveSelection(-1);
      return true;
    }
    if (key === "ArrowRight" || key === "d" || key === "D") {
      event.preventDefault();
      this.moveSelection(1);
      return true;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      this.tagInput.focus();
      return true;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      this.confirm();
      return true;
    }

    return false;
  }

  buildDom() {
    this.root = document.createElement("div");
    this.root.className = "sf-lobby sf-lobby--hidden";

    // Username section
    const usernameSection = document.createElement("div");
    usernameSection.className = "sf-lobby__username";

    const usernameLabel = document.createElement("label");
    usernameLabel.className = "sf-lobby__username-label";
    usernameLabel.textContent = "ENTER YOUR NAME";

    this.tagInput = document.createElement("input");
    this.tagInput.className = "sf-lobby__username-input";
    this.tagInput.type = "text";
    this.tagInput.maxLength = MAX_TAG_LENGTH;
    this.tagInput.placeholder = "DRIVER";
    this.tagInput.spellcheck = false;
    this.tagInput.autocomplete = "off";
    this.tagInput.value = this.initialTag;
    this.tagInput.addEventListener("input", () => this.updateConfirmState());

    usernameSection.append(usernameLabel, this.tagInput);

    // Cards container
    this.cardsContainer = document.createElement("div");
    this.cardsContainer.className = "sf-lobby__cards";

    // Confirm button
    this.confirmBtn = document.createElement("button");
    this.confirmBtn.className = "sf-lobby__confirm";
    this.confirmBtn.type = "button";
    this.confirmBtn.textContent = "START ENGINE ►";
    this.confirmBtn.addEventListener("click", () => this.confirm());

    // Controls hint
    const controls = document.createElement("div");
    controls.className = "sf-lobby__controls";
    controls.textContent = "◀ ▶ SELECT CAR · ENTER START";

    this.root.append(usernameSection, this.cardsContainer, this.confirmBtn, controls);
    document.body.appendChild(this.root);

    this.updateConfirmState();
  }

  renderCards() {
    this.cardsContainer.replaceChildren();
    this.cardButtons = [];
    this.cardCanvases = [];

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const card = document.createElement("button");
      card.className = "sf-lobby__card";
      card.type = "button";

      // Tier badge
      const tier = document.createElement("div");
      tier.className = `sf-lobby__card-tier sf-lobby__card-tier--${car.tier || "B"}`;
      tier.textContent = car.tier || "B";

      // Image area with canvas
      const imageArea = document.createElement("div");
      imageArea.className = "sf-lobby__card-image";

      const canvas = document.createElement("canvas");
      canvas.className = "sf-lobby__card-canvas";
      canvas.width = 160;
      canvas.height = 120;
      this.cardCanvases.push(canvas);

      imageArea.append(tier, canvas);

      // Info section
      const info = document.createElement("div");
      info.className = "sf-lobby__card-info";

      const name = document.createElement("h3");
      name.className = "sf-lobby__card-name";
      name.textContent = car.name;
      
      if (car.edition) {
        const edition = document.createElement("div");
        edition.className = "sf-lobby__card-edition";
        edition.textContent = car.edition;
        name.appendChild(document.createElement("br"));
        name.appendChild(edition);
      }

      const stats = document.createElement("div");
      stats.className = "sf-lobby__card-stats";
      stats.appendChild(this.createStatBar("SPD", car.stats?.speed || 5));
      stats.appendChild(this.createStatBar("ACC", car.stats?.accel || 5));
      stats.appendChild(this.createStatBar("BRK", car.stats?.brakes || 5));
      stats.appendChild(this.createStatBar("CRN", car.stats?.cornering || 5));
      stats.appendChild(this.createStatBar("AUR", car.stats?.aura || 5, true));

      info.append(name, stats);
      card.append(imageArea, info);

      card.addEventListener("click", () => {
        this.selectedIndex = i;
        this.updateSelection();
      });

      card.addEventListener("focus", () => {
        this.selectedIndex = i;
        this.updateSelection();
      });

      this.cardButtons.push(card);
      this.cardsContainer.appendChild(card);
    }

    this.paintCards();
  }

  paintCards() {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const canvas = this.cardCanvases[i];
      if (!canvas) continue;

      const ctx = canvas.getContext("2d");
      const sprite = this.spriteFor(car.id);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!sprite || sprite.width === 0) continue;

      // Draw car sprite centered, rotated to face right
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      
      // Subtle bob for selected card
      const isSelected = i === this.selectedIndex;
      if (isSelected) {
        const bob = Math.sin(this.bobPhase * 2) * 3;
        ctx.translate(0, bob);
      }

      // Scale up the sprite to fill card nicely
      const scale = Math.min(canvas.width / sprite.height, canvas.height / sprite.width) * 0.85;
      ctx.scale(scale, scale);
      ctx.rotate(-Math.PI / 2); // Face right (car sprites point up by default)
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
      ctx.restore();
    }
  }

  startAnimLoop() {
    const tick = (now) => {
      this.bobPhase = now * 0.001;
      if (this.isShown) this.paintCards();
      this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  updateSelection() {
    for (let i = 0; i < this.cardButtons.length; i++) {
      const isSelected = i === this.selectedIndex;
      this.cardButtons[i].classList.toggle("sf-lobby__card--selected", isSelected);
    }
    this.scrollToSelected();
    this.updateConfirmState();
  }

  scrollToSelected() {
    const card = this.cardButtons[this.selectedIndex];
    if (card) {
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }

  moveSelection(delta) {
    if (this.cars.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.cars.length) % this.cars.length;
    this.updateSelection();
    this.cardButtons[this.selectedIndex]?.focus();
  }

  updateConfirmState() {
    const ready = this.canConfirm();
    this.confirmBtn.classList.toggle("sf-lobby__confirm--ready", ready);
  }

  canConfirm() {
    const tag = normalizeTag(this.tagInput.value);
    return tag.length >= 2 && Boolean(this.selectedCar);
  }

  createStatBar(label, value, isAura = false) {
    const row = document.createElement("div");
    row.className = "sf-lobby__card-stat-row" + (isAura ? " sf-lobby__card-stat-row--aura" : "");
    
    const lbl = document.createElement("span");
    lbl.className = "sf-lobby__card-stat-label";
    lbl.textContent = label;
    
    const bar = document.createElement("div");
    bar.className = "sf-lobby__card-stat-bar";
    
    const filled = Math.min(10, Math.max(0, Math.round(value)));
    for (let i = 0; i < 10; i++) {
      const seg = document.createElement("span");
      seg.className = "sf-lobby__card-stat-seg" + (i < filled ? " sf-lobby__card-stat-seg--on" : "");
      bar.appendChild(seg);
    }
    
    row.append(lbl, bar);
    return row;
  }

  confirm() {
    if (!this.canConfirm()) {
      if (normalizeTag(this.tagInput.value).length < 2) {
        this.tagInput.classList.add("sf-lobby--shake");
        this.tagInput.focus();
        setTimeout(() => this.tagInput.classList.remove("sf-lobby--shake"), 300);
      }
      return;
    }

    this.onComplete({
      tag: `@${normalizeTag(this.tagInput.value)}`,
      carId: this.selectedCar.id,
    });
  }
}
