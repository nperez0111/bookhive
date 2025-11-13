const template = document.createElement("template");
template.innerHTML = `
  <slot></slot>

  <ul class="menu" part="menu"></ul>

  <style>
    :host {
      --color-background-inherited: var(--color-background, #ffffff);
      --color-border-inherited: var(--color-border, #00000022);
      --color-shadow-inherited: var(--color-shadow, #000000);
      --color-hover-inherited: var(--color-hover, #00000011);
      --color-avatar-fallback-inherited: var(--color-avatar-fallback, #00000022);
      --radius-inherited: var(--radius, 8px);
      --padding-menu-inherited: var(--padding-menu, 4px);
      display: block;
      position: relative;
      font-family: system-ui;
    }

    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    .menu {
      display: flex;
      flex-direction: column;
      position: absolute;
      left: 0;
      margin-top: 4px;
      width: 100%;
      list-style: none;
      overflow: hidden;
      background-color: var(--color-background-inherited);
      background-clip: padding-box;
      border: 1px solid var(--color-border-inherited);
      border-radius: var(--radius-inherited);
      box-shadow: 0 6px 6px -4px rgb(from var(--color-shadow-inherited) r g b / 20%);
      padding: var(--padding-menu-inherited);
    }

    .menu:empty {
      display: none;
    }

    .user {
      all: unset;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      width: 100%;
      height: calc(1.5rem + 6px * 2);
      border-radius: calc(var(--radius-inherited) - var(--padding-menu-inherited));
      cursor: default;
    }

    .user:hover,
    .user[data-active="true"] {
      background-color: var(--color-hover-inherited);
    }

    .avatar {
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background-color: var(--color-avatar-fallback-inherited);
      overflow: hidden;
      flex-shrink: 0;
    }

    .img {
      display: block;
      width: 100%;
      height: 100%;
    }

    .handle {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
`;

const user = document.createElement("template");
user.innerHTML = `
  <li>
    <button class="user" part="user">
      <div class="avatar" part="avatar">
        <img class="img" part="img">
      </div>
      <span class="handle" part="handle"></span>
    </button>
  </li>
`;

/**
 * @template {HTMLElement} T
 * @param {T} tmpl
 */
function clone(tmpl) {
  return /** @type {T} */ (tmpl.cloneNode(true));
}

export default class ActorTypeahead extends HTMLElement {
  static tag = "actor-typeahead";

  static define(tag = this.tag) {
    this.tag = tag;

    const name = customElements.getName(this);
    if (name && name !== tag) return console.warn(`${this.name} already defined as <${name}>!`);

    const ce = customElements.get(tag);
    if (ce && ce !== this) return console.warn(`<${tag}> already defined as ${ce.name}!`);

    customElements.define(tag, this);
  }

  static {
    const tag = new URL(import.meta.url).searchParams.get("tag") || this.tag;
    if (tag !== "none") this.define(tag);
  }

  #shadow = this.attachShadow({ mode: "closed" });

  /** @type {Array<{ handle: string; avatar: string }>} */
  #actors = [];
  #index = -1;
  #pressed = false;

  constructor() {
    super();

    this.#shadow.append(clone(template).content);
    this.#render();
    this.addEventListener("input", this);
    this.addEventListener("focusout", this);
    this.addEventListener("keydown", this);
    this.#shadow.addEventListener("pointerdown", this);
    this.#shadow.addEventListener("pointerup", this);
    this.#shadow.addEventListener("click", this);
  }

  get #rows() {
    const rows = Number.parseInt(this.getAttribute("rows") ?? "");

    if (Number.isNaN(rows)) return 5;
    return rows;
  }

  /** @param {Event} evt */
  handleEvent(evt) {
    switch (evt.type) {
      case "input":
        this.#oninput(/** @type {InputEvent & { target: HTMLInputElement }} */ (evt));
        break;

      case "keydown":
        this.#onkeydown(/** @type {KeyboardEvent} */ (evt));
        break;

      case "focusout":
        this.#onfocusout(evt);
        break;

      case "pointerdown":
        this.#onpointerdown(/** @type {PointerEvent & { target: HTMLElement }} */ (evt));
        break;

      case "pointerup":
        this.#onpointerup(/** @type {PointerEvent & { target: HTMLElement }} */ (evt));
        break;

      case "click":
        this.#onclick(/** @type {MouseEvent & { target: HTMLElement }} */ (evt));
        break;
    }
  }

  /** @param {KeyboardEvent} evt */
  #onkeydown(evt) {
    switch (evt.key) {
      case "ArrowDown":
        evt.preventDefault();
        this.#index = Math.min(this.#index + 1, this.#rows - 1);
        this.#render();
        break;

      case "PageDown":
        evt.preventDefault();
        this.#index = this.#rows - 1;
        this.#render();
        break;

      case "ArrowUp":
        evt.preventDefault();
        this.#index = Math.max(this.#index - 1, 0);
        this.#render();
        break;

      case "PageUp":
        evt.preventDefault();
        this.#index = 0;
        this.#render();
        break;

      case "Escape":
        evt.preventDefault();
        this.#actors = [];
        this.#index = -1;
        this.#render();
        break;

      case "Enter":
        evt.preventDefault();
        this.#shadow.querySelectorAll("button")[this.#index]?.click();
        break;
    }
  }

  /** @param {InputEvent & { target: HTMLInputElement }} evt */
  async #oninput(evt) {
    const query = evt.target?.value;
    if (!query) {
      this.#actors = [];
      this.#render();
      return;
    }

    const host = this.getAttribute("host") ?? "https://public.api.bsky.app";
    const url = new URL("xrpc/app.bsky.actor.searchActorsTypeahead", host);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", `${this.#rows}`);

    const res = await fetch(url);
    const json = await res.json();
    this.#actors = json.actors;
    this.#index = -1;
    this.#render();
  }

  /** @param {Event} evt */
  async #onfocusout(evt) {
    // Small delay to allow click events on mobile Safari
    setTimeout(() => {
      if (!this.#pressed && document.activeElement !== this.querySelector("input")) {
        this.#actors = [];
        this.#index = -1;
        this.#render();
      }
    }, 150);
  }

  #render() {
    const fragment = document.createDocumentFragment();
    let i = -1;
    for (const actor of this.#actors) {
      const li = clone(user).content;

      const button = li.querySelector("button");
      if (button) {
        button.dataset.handle = actor.handle;
        if (++i === this.#index) button.dataset.active = "true";
      }

      const avatar = li.querySelector("img");
      if (avatar && actor.avatar) avatar.src = actor.avatar;

      const handle = li.querySelector(".handle");
      if (handle) handle.textContent = actor.handle;

      fragment.append(li);
    }

    this.#shadow.querySelector(".menu")?.replaceChildren(...fragment.children);
  }

  /** @param {PointerEvent} evt */
  #onpointerdown(evt) {
    this.#pressed = true;
  }

  /** @param {PointerEvent & { target: HTMLElement }} evt */
  #onpointerup(evt) {
    this.#pressed = false;

    const button = evt.target?.closest("button");
    const input = this.querySelector("input");
    if (!input || !button) return;

    // Clear menu and set value
    this.#actors = [];
    this.#index = -1;
    this.#render();
    input.value = button.dataset.handle || "";
    input.focus();
  }

  /** @param {MouseEvent & { target: HTMLElement }} evt */
  #onclick(evt) {
    const button = evt.target?.closest("button");
    const input = this.querySelector("input");
    if (!input || !button) return;

    evt.preventDefault();
    evt.stopPropagation();
    
    // Clear menu and set value
    this.#actors = [];
    this.#index = -1;
    this.#render();
    input.value = button.dataset.handle || "";
    input.focus();
  }
}
