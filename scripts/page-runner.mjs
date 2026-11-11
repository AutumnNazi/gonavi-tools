/* 页面级运行验证：把构建产物里的脚本块按浏览器顺序在 vm 里执行一遍。
   存在的意义：单测的加载器会直接注入 GN，掩盖"脚本块顺序错误"这类只在页面里才暴露的问题；
   这里没有注入，谁依赖什么顺序就按什么顺序执行，缺了就报错。 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

export function extractScripts(html) {
  const scripts = [];
  const pattern = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) { scripts.push(match[1]); }
  return scripts;
}

class MiniNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.listeners = new Map();
    this.style = {
      values: {},
      setProperty(name, value) { this.values[name] = String(value); },
      removeProperty(name) { delete this.values[name]; },
      getPropertyValue(name) { return this.values[name] === undefined ? '' : this.values[name]; },
    };
    this.className = '';
    this.text = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.type = '';
    this.parentNode = null;
  }

  get children() { return this.childNodes.filter((node) => node instanceof MiniNode); }

  get classList() {
    const self = this;
    const parts = () => String(self.className || '').split(/\s+/).filter(Boolean);
    return {
      add(...names) { self.className = Array.from(new Set([...parts(), ...names])).join(' '); },
      remove(...names) { self.className = parts().filter((name) => !names.includes(name)).join(' '); },
      contains(name) { return parts().includes(name); },
      toggle(name, force) {
        const has = parts().includes(name);
        const want = force === undefined ? !has : Boolean(force);
        if (want) { this.add(name); } else { this.remove(name); }
        return want;
      }
    };
  }

  appendChild(node) {
    if (node.parentNode) { node.parentNode.removeChild(node); }
    node.parentNode = this;
    this.text = '';
    this.childNodes.push(node);
    return node;
  }

  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  prepend(node) { node.parentNode = this; this.childNodes.unshift(node); return node; }
  replaceChildren(...nodes) { this.childNodes = []; this.text = ''; nodes.forEach((node) => this.appendChild(node)); }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) { this.childNodes.splice(index, 1); }
    node.parentNode = null;
    return node;
  }

  remove() { if (this.parentNode) { this.parentNode.removeChild(this); } }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }

  get dataset() {
    const self = this;
    return new Proxy({}, {
      get(_, key) { return self.attributes['data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())]; }
    });
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((item) => item !== handler));
  }

  dispatch(type, event) {
    const detail = event || { type, target: this, preventDefault() {}, stopPropagation() {} };
    for (const handler of (this.listeners.get(type) || [])) { handler(detail); }
  }

  click() { this.dispatch('click'); }
  focus() {}
  blur() {}
  select() {}

  matches(selector) {
    return String(selector).split(',').some((part) => {
      const trimmed = part.trim();
      if (trimmed.startsWith('[')) {
        const parsed = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(trimmed);
        if (!parsed) { return false; }
        const value = this.attributes[parsed[1]];
        return parsed[2] === undefined ? value !== undefined : value === parsed[2];
      }
      return this.tagName === trimmed.toUpperCase();
    });
  }

  findAll(selector, out = []) {
    for (const child of this.childNodes) {
      if (!(child instanceof MiniNode)) { continue; }
      if (child.matches(selector)) { out.push(child); }
      child.findAll(selector, out);
    }
    return out;
  }

  querySelector(selector) { return this.findAll(selector)[0] || null; }
  querySelectorAll(selector) { return this.findAll(selector); }

  insertRow() { const row = new MiniNode('tr'); this.appendChild(row); return row; }
  insertCell() { const cell = new MiniNode('td'); this.appendChild(cell); return cell; }

  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get parentElement() { return this.parentNode; }

  get textContent() {
    if (this.childNodes.length) { return this.childNodes.map((node) => node.textContent || '').join(''); }
    return this.text;
  }

  set textContent(value) {
    this.childNodes = [];
    this.text = value === null || value === undefined ? '' : String(value);
  }

  get innerHTML() { return ''; }
  set innerHTML(value) {
    this.childNodes = [];
    this.text = '';
    if (value) { this.innerHTMLWasUsed = String(value); }
  }
}

function createDocument(html) {
  const document = new MiniNode('#document');
  document.readyState = 'complete';
  document.documentElement = new MiniNode('html');
  document.body = new MiniNode('body');
  document.appendChild(document.documentElement);
  document.appendChild(document.body);
  document.createElement = (tag) => new MiniNode(tag);
  document.createTextNode = (text) => {
    const node = new MiniNode('#text');
    node.text = String(text);
    node.textContent = String(text);
    return node;
  };
  document.getElementById = (id) => document.findAll('#' + id).concat(document.findAll('[id]'))
    .find((node) => node.getAttribute('id') === id) || null;
  document.execCommand = () => true;

  // 页面里的静态元素没有 HTML 解析器可用，按 id 逐个补出来，
  // 保证 app.js 的 getElementById 与容器的 children 遍历行为与浏览器一致。
  const pattern = /<(\w+)[^>]*?id="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const element = new MiniNode(match[1]);
    element.setAttribute('id', match[2]);
    document.body.appendChild(element);
  }
  return document;
}

export function runPage(html, options = {}) {
  const document = createDocument(html);
  const errors = [];
  const hostListeners = new Map();

  const sandbox = {
    document,
    console,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); if (timer.unref) { timer.unref(); } return timer; },
    clearTimeout,
    TextDecoder,
    __hostTextEncoder: TextEncoder,
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    URL,
    URLSearchParams,
    crypto: { getRandomValues: (array) => { for (let i = 0; i < array.length; i++) { array[i] = Math.floor(Math.random() * 256); } return array; } },
    navigator: {},
    performance: { now: () => Date.now() },
    // window 级的监听与媒体查询：宿主主题事件、系统深浅色偏好都走这里。
    addEventListener: (type, handler) => {
      const list = hostListeners.get(type) || [];
      list.push(handler);
      hostListeners.set(type, list);
    },
    removeEventListener: (type, handler) => {
      hostListeners.set(type, (hostListeners.get(type) || []).filter((item) => item !== handler));
    },
    dispatchEvent: (event) => {
      for (const handler of (hostListeners.get(event.type) || [])) { handler(event); }
      return true;
    },
    matchMedia: () => ({
      matches: options.prefersDark === true,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
  };
  if (options.hostPreferences) { sandbox.gonaviHostPrefs = options.hostPreferences; }
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);

  // TextEncoder 必须在沙箱 realm 内构造字节：若直接注入宿主实现，它产出的
  // Uint8Array 属于宿主 realm，在沙箱里过不了 instanceof —— 而真实浏览器是单 realm，
  // 不会有这个差异。注入宿主实体会制造出浏览器里根本不存在的失败（已经发生过一次）。
  vm.runInContext(`
    var TextEncoder = function () { this.inner = new __hostTextEncoder(); };
    TextEncoder.prototype.encode = function (text) {
      var source = this.inner.encode(String(text));
      var copy = new Uint8Array(source.length);
      for (var i = 0; i < source.length; i++) { copy[i] = source[i]; }
      return copy;
    };
  `, context);

  for (const [index, source] of extractScripts(html).entries()) {
    try {
      vm.runInContext(source, context, { filename: 'page-script-' + index + '.js' });
    } catch (error) {
      errors.push({ block: index, message: String(error && error.message ? error.message : error) });
    }
  }

  return {
    GN: sandbox.GN,
    document,
    sandbox,
    errors,
    // 在页面 realm 内求值：用来断言"沙箱里的类型语义与真实浏览器一致"这类环境自身的问题。
    evaluate: (source) => vm.runInContext(source, context),
  };
}

export function readBuiltPage() {
  return fs.readFileSync(path.join(root, 'dist/preview.html'), 'utf8');
}

export function expectedToolCount() {
  return fs.readdirSync(path.join(root, 'src/tools')).filter((name) => name.endsWith('.js')).length;
}

export function findByTag(node, tag, out = []) {
  if (node.tagName === tag.toUpperCase()) { out.push(node); }
  for (const child of node.childNodes || []) {
    if (child instanceof MiniNode) { findByTag(child, tag, out); }
  }
  return out;
}
