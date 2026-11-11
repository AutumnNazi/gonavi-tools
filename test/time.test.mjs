import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { loadTool } from '../scripts/test-loader.mjs';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const { tool } = loadTool('src/tools/06-time.js');
const api = tool.api;

const pad = (value) => String(value).padStart(2, '0');
const localText = (date) => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
  ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());

test('工具声明符合契约', () => {
  assert.equal(tool.id, 'time');
  assert.equal(tool.group, 'time');
  assert.equal(typeof tool.mount, 'function');
  assert.equal(typeof tool.desc, 'string');
  assert.deepEqual(Object.keys(api).sort(), ['detectUnit', 'formatAll', 'formatDate', 'fromDateString', 'toMilliseconds']);
});

test('detectUnit 按位数识别秒与毫秒', () => {
  assert.equal(api.detectUnit('1704067200'), 's');
  assert.equal(api.detectUnit('1704067200000'), 'ms');
  assert.equal(api.detectUnit('0'), 's');
  assert.equal(api.detectUnit(' 1704067200 '), 's');
  assert.equal(api.detectUnit('17040672000'), 'ms');
  assert.equal(api.detectUnit('170406720000'), 'ms');
  assert.equal(api.detectUnit('1704067200.5'), 's');
});

test('toMilliseconds 自动识别并支持手动指定单位', () => {
  assert.equal(api.toMilliseconds('1704067200'), 1704067200000);
  assert.equal(api.toMilliseconds('1704067200000'), 1704067200000);
  assert.equal(api.toMilliseconds('1704067200', 's'), 1704067200000);
  assert.equal(api.toMilliseconds('1704067200', 'ms'), 1704067200);
  assert.equal(api.toMilliseconds('1704067200000', 's'), 1704067200000000);
  assert.equal(api.toMilliseconds('1704067200', 'auto'), 1704067200000);
  assert.equal(api.toMilliseconds('-1000', 's'), -1000000);
});

test('toMilliseconds 对坏输入直接报错', () => {
  assert.throws(() => api.toMilliseconds('abc'), /必须是整数/);
  assert.throws(() => api.toMilliseconds(''), /必须是整数/);
  assert.throws(() => api.toMilliseconds('1704067200.5'), /必须是整数/);
  assert.throws(() => api.toMilliseconds('999999999999999999999'), /超出可表示范围/);
  assert.throws(() => api.toMilliseconds('17040672000000', 's'), /超出可表示范围/);
});

test('fromDateString 按本地时区解析，不落 UTC 陷阱', () => {
  const local = new Date(2024, 0, 1, 0, 0, 0).getTime();
  assert.equal(api.fromDateString('2024-01-01'), local);
  assert.equal(api.fromDateString('2024-01-01 00:00:00'), local);
  assert.equal(api.fromDateString('2024-01-01T00:00:00'), local);
  assert.equal(api.fromDateString('2024-01-01T00:00'), local);
  assert.equal(api.fromDateString('  2024-01-01 08:30:00  '), new Date(2024, 0, 1, 8, 30, 0).getTime());
  assert.equal(api.fromDateString('2024-03-05T09:07:03.040'), new Date(2024, 2, 5, 9, 7, 3, 40).getTime());
  // 本机不在 UTC 时，纯日期字符串绝不能被当成 UTC 零点
  if (new Date(2024, 0, 1).getTimezoneOffset() !== 0) {
    assert.notEqual(api.fromDateString('2024-01-01'), Date.parse('2024-01-01'));
  }
});

test('fromDateString 尊重显式时区偏移', () => {
  assert.equal(api.fromDateString('2024-01-01T00:00:00Z'), Date.UTC(2024, 0, 1));
  assert.equal(api.fromDateString('2024-01-01T08:00:00+08:00'), Date.UTC(2024, 0, 1));
  assert.equal(api.fromDateString('2024-01-01T00:00:00.500Z'), Date.UTC(2024, 0, 1) + 500);
});

test('fromDateString 拒绝不存在的日期与坏格式', () => {
  assert.throws(() => api.fromDateString('2024-02-30 00:00:00'), /日期不存在/);
  assert.throws(() => api.fromDateString('2023-02-29 00:00:00'), /日期不存在/);
  assert.throws(() => api.fromDateString('2024-13-01'), /月份超出/);
  assert.throws(() => api.fromDateString('2024-00-01'), /月份超出/);
  assert.throws(() => api.fromDateString('2024-01-01 25:00:00'), /超出范围/);
  assert.throws(() => api.fromDateString('下午三点'), /无法识别/);
  assert.throws(() => api.fromDateString(''), /不能为空/);
});

test('formatAll 同时给出本地、UTC、北京时间与 ISO 8601', () => {
  const ms = Date.UTC(2024, 0, 1, 0, 0, 0);
  const all = api.formatAll(ms);
  assert.equal(all.iso, '2024-01-01T00:00:00.000Z');
  assert.equal(all.utc, '2024-01-01 00:00:00');
  assert.equal(all.beijing, '2024-01-01 08:00:00');
  assert.equal(all.local, api.formatDate(ms, 'yyyy-MM-dd HH:mm:ss'));
  assert.equal(all.local, localText(new Date(ms)));
});

test('北京时间恒等于 UTC+8（含跨日）', () => {
  assert.equal(api.formatAll(Date.UTC(2024, 5, 30, 20, 30, 0)).beijing, '2024-07-01 04:30:00');
  assert.equal(api.formatAll(Date.UTC(2024, 0, 1, 15, 59, 59)).beijing, '2024-01-01 23:59:59');
  assert.equal(api.formatAll(0).beijing, '1970-01-01 08:00:00');
  assert.equal(api.formatAll(Date.UTC(1969, 11, 31, 16, 0, 0)).beijing, '1970-01-01 00:00:00');
  // 与 UTC 的差值固定 8 小时，不随本机时区变化
  const base = Date.UTC(2024, 2, 1, 6, 0, 0);
  assert.equal(api.formatAll(base).beijing, api.formatAll(base + 8 * 3600 * 1000).utc);
});

test('formatDate 支持常用占位符', () => {
  const ms = new Date(2024, 2, 5, 9, 7, 3, 40).getTime();
  assert.equal(api.formatDate(ms, 'yyyy-MM-dd HH:mm:ss'), '2024-03-05 09:07:03');
  assert.equal(api.formatDate(ms, 'yyyy/MM/dd'), '2024/03/05');
  assert.equal(api.formatDate(ms, 'HH:mm:ss.SSS'), '09:07:03.040');
  assert.equal(api.formatDate(ms), '2024-03-05 09:07:03');
});

test('毫秒精度与范围边界', () => {
  assert.equal(api.formatAll(Date.UTC(2024, 0, 1) + 123).iso, '2024-01-01T00:00:00.123Z');
  assert.equal(api.formatAll(Date.UTC(2024, 0, 1)).beijing, '2024-01-01 08:00:00');
  assert.throws(() => api.formatAll('abc'), /必须是整数/);
  assert.throws(() => api.formatAll(1e20), /超出可表示范围/);
  assert.throws(() => api.formatDate('bad', 'yyyy'), /必须是整数/);
});

test('时间戳与日期字符串可以往返', () => {
  const text = '2024-06-18 23:45:01';
  const ms = api.fromDateString(text);
  assert.equal(api.formatAll(ms).local, text);
  assert.equal(api.toMilliseconds(String(Math.floor(ms / 1000))), ms);
});

/* ---------------- mount 冒烟：用真实 GN.ui 在最小 DOM 替身上跑一遍 ---------------- */

// 极简 DOM 替身：只实现 GN.ui 用到的那部分接口。它替代不了浏览器验证，
// 但能在 Node 里真跑 mount 与按钮回调，抓住「工具初始化失败」这类只在打开标签时才暴露的错误。
function fakeNode(tag) {
  const node = {
    tagName: tag, childNodes: [], parentNode: null, style: {}, attrs: {}, listeners: {},
    className: '', value: '', checked: false, disabled: false,
    classList: { toggle() {}, add() {}, remove() {} }
  };
  let text = '';
  Object.defineProperty(node, 'textContent', {
    get: () => text,
    set: (value) => { text = String(value); node.childNodes.length = 0; }
  });
  node.appendChild = (child) => {
    node.childNodes.push(child);
    child.parentNode = node;
    return child;
  };
  node.removeChild = (child) => {
    const at = node.childNodes.indexOf(child);
    if (at >= 0) { node.childNodes.splice(at, 1); }
    return child;
  };
  node.setAttribute = (name, value) => {
    node.attrs[name] = String(value);
    if (name === 'class') { node.className = String(value); }
  };
  node.getAttribute = (name) => (node.attrs[name] === undefined ? null : node.attrs[name]);
  node.addEventListener = (type, handler) => {
    (node.listeners[type] = node.listeners[type] || []).push(handler);
  };
  node.fire = (type) => {
    (node.listeners[type] || []).forEach((handler) => handler.call(node, { type }));
  };
  return node;
}

function withFakeDom(run) {
  const previousDocument = globalThis.document;
  const previousGN = globalThis.GN;
  const nodes = {};
  globalThis.document = {
    readyState: 'complete',
    body: fakeNode('body'),
    createElement: (tag) => fakeNode(tag),
    createTextNode: (value) => {
      const node = fakeNode('#text');
      node.textContent = value;
      return node;
    },
    getElementById: (id) => (nodes[id] = nodes[id] || fakeNode('div')),
    addEventListener() {},
    execCommand: () => false
  };
  // app.js 的主题模块会读写 documentElement 与 window 级事件 / 媒体查询，替身补上最小实现。
  globalThis.document.documentElement = { setAttribute() {}, getAttribute() { return null; }, style: { setProperty() {} } };
  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.matchMedia = globalThis.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
  try {
    return run();
  } finally {
    globalThis.document = previousDocument;
    globalThis.GN = previousGN;
  }
}

// 按页面里的加载方式执行：lib / app / tools 共享同一个全局 GN
function loadPage(files) {
  globalThis.GN = { tools: [], lib: {}, groups: [] };
  files.forEach((file) => { new Function('GN', fs.readFileSync(path.join(root, file), 'utf8'))(globalThis.GN); });
  return globalThis.GN;
}

function collect(node, predicate, out) {
  const list = out || [];
  if (predicate(node)) { list.push(node); }
  node.childNodes.forEach((child) => collect(child, predicate, list));
  return list;
}

const texts = (host) => collect(host, () => true).map((node) => node.textContent);

test('mount：时间戳工具在最小 DOM 替身上能构造界面并完成转换', () => {
  withFakeDom(() => {
    const gn = loadPage(['src/app.js', 'src/tools/06-time.js']);
    assert.equal(typeof gn.ui, 'object', 'app.js 应提供 GN.ui');
    const host = fakeNode('div');
    gn.tools[0].mount(host);
    assert.ok(host.childNodes.length > 0, 'mount 没有构造任何界面');

    const stamp = collect(host, (node) => node.tagName === 'input' && node.attrs.type === 'text')[0];
    const message = collect(host, (node) => node.className.indexOf('tb-msg') === 0)[0];
    assert.ok(stamp && message, '缺少时间戳输入框或提示区');

    stamp.value = '1704067200';
    stamp.fire('input');
    assert.match(message.textContent, /转换完成/);
    const all = api.formatAll(1704067200000);
    const shown = texts(host);
    assert.ok(shown.includes(all.local), '本地时间未出现在界面上');
    assert.ok(shown.includes(all.utc), 'UTC 未出现在界面上');
    assert.ok(shown.includes(all.beijing), '北京时间未出现在界面上');
    assert.ok(shown.includes(all.iso), 'ISO 8601 未出现在界面上');

    stamp.value = 'abc';
    stamp.fire('input');
    assert.match(message.textContent, /转换失败：时间戳必须是整数/);

    const dateInput = collect(host, (node) => node.tagName === 'input' && node.attrs.type === 'text')[1];
    dateInput.value = '2024-01-01 08:30:00';
    collect(host, (node) => node.tagName === 'button' && node.textContent === '解析为时间戳')[0].fire('click');
    assert.equal(stamp.value, String(api.fromDateString('2024-01-01 08:30:00')));
    assert.match(message.textContent, /已按本地时区解析为/);
  });
});
