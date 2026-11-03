/**
 * test/qa/frontend-helper.js — Shared frontend test utilities (no browser).
 *
 * Provides:
 *   - installDOMShim(): minimal but functional DOM shim so page/component ES
 *     modules can be imported and rendered under Node.
 *   - mockFetch(handlers): replaces global.fetch with a stub that answers
 *     route-pattern matches with canned JSON responses (or errors).
 *   - flush(): yields to the event loop so async page renders complete.
 *
 * Test-only; production code is unchanged.
 */

class FakeClassList {
    constructor() { this._set = new Set(); }
    add(...v) { v.forEach((x) => this._set.add(x)); }
    remove(...v) { v.forEach((x) => this._set.delete(x)); }
    contains(v) { return this._set.has(v); }
    toggle(v, force) {
        if (force === undefined) force = !this._set.has(v);
        force ? this._set.add(v) : this._set.delete(v);
        return force;
    }
    replace(oldV, newV) { this._set.delete(oldV); this._set.add(newV); }
    toString() { return [...this._set].join(' '); }
    get length() { return this._set.size; }
    item(i) { const a = [...this._set]; return a[i] === undefined ? null : a[i]; }
    [Symbol.iterator]() { return this._set[Symbol.iterator](); }
}

class FakeElement {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.childNodes = this.children;
        this.classList = new FakeClassList();
        this.style = {};
        this.attributes = {};
        this._props = {};
        this._textNodes = [];
        this._innerHTML = '';
        this.value = '';
        this.id = '';
        this.disabled = false;
        this.checked = false;
        this.selected = false;
        this.type = '';
        this.parentElement = null;
        this._listeners = {};
        this._className = '';
        this.offsetWidth = 0;
        this.offsetHeight = 0;
    }
    get textContent() {
        if (this.tag === '#text') return this._ownText || '';
        const parts = [];
        for (const c of this.children) parts.push(c.textContent);
        parts.push(...this._textNodes);
        return parts.join('');
    }
    set textContent(v) {
        const s = String(v === null || v === undefined ? '' : v);
        this._textNodes = [s];
        this._innerHTML = s;
    }
    get innerHTML() { return this._innerHTML || ''; }
    set innerHTML(html) {
        this._innerHTML = String(html === null || html === undefined ? '' : html);
        this.replaceChildren(...parseHTML(String(html === null || html === undefined ? '' : html)));
    }
    get className() { return this._className; }
    set className(v) { this._className = String(v); this.classList.replace(this.classList.toString(), String(v)); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; }
    hasAttribute(k) { return k in this.attributes; }
    appendChild(c) {
        if (c.parentElement === this) return c;
        if (c.parentElement) c.parentElement.removeChild(c);
        this.children.push(c);
        c.parentElement = this;
        return c;
    }
    append(...children) {
        for (const c of children) this.appendChild(c);
    }
    replaceChildren(...cs) {
        for (const c of this.children) c.parentElement = null;
        this.children = [...cs];
        for (const c of cs) c.parentElement = this;
    }
    insertBefore(c, ref) {
        if (!ref) { this.appendChild(c); return c; }
        const i = this.children.indexOf(ref);
        if (i < 0) { this.children.push(c); }
        else { this.children.splice(i, 0, c); }
        c.parentElement = this;
        return c;
    }
    removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) { this.children.splice(i, 1); c.parentElement = null; }
        return c;
    }
    addEventListener(type, listener) {
        this._listeners[type] = this._listeners[type] || [];
        this._listeners[type].push(listener);
    }
    removeEventListener(type, listener) {
        if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((l) => l !== listener);
    }
    dispatchEvent(evt) {
        const type = evt && evt.type ? evt.type : evt;
        if (evt) evt.target = this;
        const ls = this._listeners[type] || [];
        for (const l of ls) { try { l(evt); } catch (e) { } }
        return !(evt && evt.defaultPrevented);
    }
    click() { this.dispatchEvent(new FakeEvent('click')); if (this.onclick) this.onclick(); }
    focus() { }
    scrollIntoView() { }
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
    querySelector(sel) {
        const all = this.querySelectorAll(sel);
        return all.length ? all[0] : null;
    }
    querySelectorAll(sel) {
        return matchSelectorAll(this, sel, true);
    }
    getElementsByTagName() { return []; }
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
const OPEN_TAG_RE = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)(\/?)>/;
const CLOSE_TAG_RE = /<\/([a-zA-Z]+)>/;
const TEXT_RE = /[^<]+/;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9-]*)=["']([^"']*)["']/g;

function parseAttrs(attrStr) {
    const attrs = {};
    let m;
    while ((m = ATTR_RE.exec(attrStr)) !== null) attrs[m[1]] = m[2];
    return attrs;
}

function parseHTML(html) {
    const root = new FakeElement('div');
    const stack = [root];
    let i = 0;
    while (i < html.length) {
        if (html[i] !== '<') {
            // Text run: accumulate direct text on the current element.
            const m = TEXT_RE.exec(html.slice(i));
            const text = m ? m[0] : html[i];
            const cur = stack[stack.length - 1];
            cur._textNodes.push(text);
            i += text.length;
            continue;
        }
        const sub = html.slice(i);
        const cm = sub.match(CLOSE_TAG_RE);
        if (cm && cm.index === 0) {
            stack.pop();
            i += cm[0].length;
            continue;
        }
        const om = sub.match(OPEN_TAG_RE);
        if (om && om.index === 0) {
            const tag = om[1].toLowerCase();
            const el = new FakeElement(tag);
            for (const [k, v] of Object.entries(parseAttrs(om[2]))) el.setAttribute(k, v);
            const selfClosing = om[3] === '/' || VOID_TAGS.has(tag);
            stack[stack.length - 1].appendChild(el);
            if (!selfClosing) stack.push(el);
            i += om[0].length;
            continue;
        }
        // Lone '<' not part of a tag; treat as literal text.
        const cur = stack[stack.length - 1];
        cur._textNodes.push('<');
        i += 1;
    }
    return root.children;
}

function matchSelectorAll(root, sel, includeRoot) {
    const out = [];
    const tokens = String(sel).trim().split(/\s+/).filter(Boolean);
    function walk(node) {
        const candidates = includeRoot ? [node] : [...node.children];
        for (const cand of candidates) {
            if (matches(cand, tokens)) out.push(cand);
            walkDescendants(cand, tokens, out);
        }
    }
    walk(root);
    return out;
}

function walkDescendants(node, tokens, out) {
    for (const child of node.children) {
        if (matches(child, tokens)) out.push(child);
        walkDescendants(child, tokens, out);
    }
}

function matches(el, tokens) {
    const last = tokens[tokens.length - 1];
    if (!matchOne(el, last)) return false;
    if (tokens.length === 1) return true;
    let anc = el.parentElement;
    let idx = tokens.length - 2;
    while (anc && idx >= 0) {
        if (matchOne(anc, tokens[idx])) idx--;
        if (idx < 0) break;
        anc = anc.parentElement;
    }
    return idx < 0;
}

const NTH_CHILD_RE = /^:?nth-child\((\d+)\)$/;
const TAG_PSEUDO_RE = /^([a-zA-Z]+)(:last-child|:nth-child\(\d+\))$/;

function pseudoMatches(el, pseudo) {
    if (!el.parentElement) return false;
    const siblings = el.parentElement.children;
    if (pseudo === ':last-child') {
        return siblings[siblings.length - 1] === el;
    }
    const m = pseudo.match(NTH_CHILD_RE);
    if (m) {
        const n = parseInt(m[1], 10);
        return siblings[n - 1] === el;
    }
    return false;
}

function matchOne(el, token) {
    if (token === '*') return true;
    const tagPseudo = token.match(TAG_PSEUDO_RE);
    if (tagPseudo) {
        if (el.tag.toLowerCase() !== tagPseudo[1].toLowerCase()) return false;
        return pseudoMatches(el, tagPseudo[2]);
    }
    if (token === ':last-child') {
        return pseudoMatches(el, ':last-child');
    }
    const m = token.match(NTH_CHILD_RE);
    if (m) {
        const n = parseInt(m[1], 10);
        return el.parentElement && el.parentElement.children[n - 1] === el;
    }
    if (token.startsWith('#')) {
        return el.id === token.slice(1);
    }
    if (token.startsWith('.')) {
        const cls = token.slice(1);
        return el.classList.contains(cls);
    }
    const tagM = token.match(/^([a-zA-Z]+)\.(.+)$/);
    if (tagM) {
        if (el.tag.toLowerCase() !== tagM[1].toLowerCase()) return false;
        return el.classList.contains(tagM[2]);
    }
    return el.tag.toLowerCase() === token.toLowerCase();
}

class FakeEvent {
    constructor(type, detail = {}) {
        this.type = type;
        this.defaultPrevented = false;
        this.detail = detail;
    }
    preventDefault() { this.defaultPrevented = true; }
}
class FakeCustomEvent extends FakeEvent {
    constructor(type, detail) { super(type, detail); }
}

class MockResponse {
    constructor(data, status = 200) {
        this.data = data;
        this.status = status;
        this.ok = status >= 200 && status < 300;
        this.statusText = this.ok ? 'OK' : 'Error';
        this.headers = { get: () => null };
    }
    async text() { return typeof this.data === 'string' ? this.data : JSON.stringify(this.data); }
    async json() { return this.data; }
}

function mockFetch(handlers) {
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
        const u = String(url);
        for (const h of handlers) {
            if (h.match && u.includes(h.match)) {
                const response = typeof h.response === 'function' ? h.response(opts) : h.response;
                return new MockResponse(response, h.status || 200);
            }
        }
        return new MockResponse({ value: [] }, 200);
    };
    global.fetch.original = originalFetch;
    return () => { global.fetch = originalFetch; };
}

function installDOMShim() {
    if (global.document && global.document.installed) return global.document;
    const doc = {
        installed: true,
        createElement: (tag) => new FakeElement(tag),
        createElementNS: (ns, tag) => new FakeElement(tag),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createDocumentFragment: () => new FakeElement('fragment'),
        addEventListener: () => {},
        removeEventListener: () => {},
        head: new FakeElement('head'),
        body: new FakeElement('body'),
        documentElement: new FakeElement('html'),
        location: { hash: '' }
    };
    const win = {
        location: { hash: '' },
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        matchMedia: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
        Blob: class FakeBlob {
            constructor(parts, opts) { this.parts = parts; this.opts = opts; }
        },
        Event: FakeEvent,
        CustomEvent: FakeCustomEvent
    };
    global.document = doc;
    global.window = win;
    global.Element = FakeElement;
    global.Node = { ELEMENT_NODE: 1 };
    global.HTMLElement = FakeElement;
    global.HTMLButtonElement = FakeElement;
    global.HTMLSelectElement = FakeElement;
    global.HTMLInputElement = FakeElement;
    global.Event = FakeEvent;
    global.CustomEvent = FakeCustomEvent;
    global.Blob = win.Blob;
    global.URL = win.URL;
    return { document: doc, window: win };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = { FakeElement, FakeEvent, MockResponse, installDOMShim, mockFetch, flush };
