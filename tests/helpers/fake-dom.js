class FakeEvent {
  constructor(type) {
    this.type = type;
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

function matches(element, selector) {
  const checked = selector.endsWith(":checked");
  const base = checked ? selector.slice(0, -8) : selector;
  if (checked && !element.checked) return false;
  if (base.startsWith("#")) return element.id === base.slice(1);
  if (base.startsWith(".")) return element.className.split(/\s+/).includes(base.slice(1));
  const attribute = base.match(/^\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]$/);
  if (attribute) {
    const value = element.getAttribute(attribute[1]);
    return value !== null && (attribute[2] === undefined || value === attribute[2]);
  }
  const named = base.match(/^([\w-]+)\[([^=\]]+)=["']?([^\]"']+)["']?\]$/);
  if (named) {
    return element.tagName === named[1].toUpperCase()
      && element.getAttribute(named[2]) === named[3];
  }
  return element.tagName === base.toUpperCase();
}

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = String(tagName).toUpperCase();
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.type = "";
    this._textContent = "";
  }

  get id() { return this.getAttribute("id") || ""; }
  set id(value) { this.setAttribute("id", value); }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get textContent() {
    return this._textContent || this.children.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = text;
    }
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = "";
    this.append(...nodes);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const next = typeof event === "string" ? new FakeEvent(event) : event;
    next.target ||= this;
    next.currentTarget = this;
    for (const listener of this.listeners.get(next.type) || []) listener(next);
    return !next.defaultPrevented;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement(this, "html");
    this.body = new FakeElement(this, "body");
    this.documentElement.append(this.body);
  }

  createElement(tagName) { return new FakeElement(this, tagName); }
  createTextNode(text) {
    const node = new FakeElement(this, "#text");
    node.textContent = text;
    return node;
  }
  getElementById(id) { return this.documentElement.querySelector(`#${id}`); }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
}

function createFakeDom() {
  const document = new FakeDocument();
  return { document, root: document.body };
}

function input(element, value) {
  element.value = value;
  element.dispatchEvent(new FakeEvent("input"));
}

function click(element) {
  element.dispatchEvent(new FakeEvent("click"));
  if (element.type === "submit") {
    let parent = element.parentNode;
    while (parent && parent.tagName !== "FORM") parent = parent.parentNode;
    parent?.dispatchEvent(new FakeEvent("submit"));
  }
}

module.exports = { FakeDocument, FakeElement, FakeEvent, createFakeDom, input, click };
