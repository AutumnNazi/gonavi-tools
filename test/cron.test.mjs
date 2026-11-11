import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { loadGN, loadTool } from '../scripts/test-loader.mjs';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const cron = loadGN(['src/lib/cron.js']).lib.cron;
const parserTool = loadTool('src/tools/07-cron.js', ['src/lib/cron.js']).tool;
const builderTool = loadTool('src/tools/08-cron-builder.js', ['src/lib/cron.js']).tool;

const pad = (value) => String(value).padStart(2, '0');
const show = (date) => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
  ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0);
const list = (runs) => runs.map(show);

test('GN.lib.cron 暴露四个纯逻辑入口', () => {
  assert.deepEqual(
    Object.keys(cron).sort(),
    ['describe', 'nextRuns', 'parse', 'validate']
  );
});

test('validate 接受标准 5 段写法', () => {
  const samples = [
    '* * * * *',
    '*/5 * * * *',
    '0 9 * * 1-5',
    '15 3 * * MON-FRI',
    '0 0 1 1 *',
    '0 0 * * ?',
    '0 0 * * 7',
    '0 0 * * SUN',
    '5,10 1-3 */2 JAN,JUL 0',
    '0 12 1,15 * *'
  ];
  samples.forEach((expr) => {
    const result = cron.validate(expr);
    assert.equal(result.ok, true, expr + ' 被判为非法：' + result.message);
  });
});

test('validate 拒绝非法写法并给出中文原因', () => {
  const cases = [
    ['', /为空/],
    ['   ', /为空/],
    ['* * * *', /5 个字段/],
    ['0 0 9 * * 1-5 2026', /5 个字段/],
    ['@daily', /5 个字段/],
    ['60 * * * *', /超出 0-59/],
    ['* 24 * * *', /超出 0-23/],
    ['* * 32 * *', /超出 1-31/],
    ['* * 0 * *', /超出 1-31/],
    ['* * * 13 *', /超出 1-12/],
    ['* * * * 8', /超出 0-7/],
    ['*/0 * * * *', /步长必须大于 0/],
    ['*/x * * * *', /必须是正整数/],
    ['5-1 * * * *', /起始值大于结束值/],
    ['1-2-3 * * * *', /多个横线/],
    ['1,,2 * * * *', /多余的逗号/],
    ['0 0 L * *', /不支持 L/],
    ['0 0 1W * *', /不支持 W/],
    ['0 0 * * 1#2', /不支持 #/],
    ['0 0 * * MONDAY', /无法识别|不是合法取值/],
    ['0 0 * * abc', /不是合法取值/],
    ['0 JAN * * *', /不是合法取值/]
  ];
  cases.forEach((item) => {
    const result = cron.validate(item[0]);
    assert.equal(result.ok, false, item[0] + ' 被判为合法');
    assert.match(result.message, item[1], item[0] + ' 的错误信息不符：' + result.message);
  });
});

test('parse 把表达式拆成五个字段并给出中文含义', () => {
  const fields = cron.parse('*/5 0 1,15 * MON-FRI');
  assert.equal(fields.length, 5);
  assert.deepEqual(fields.map((field) => field.name), ['分钟', '小时', '日', '月', '星期']);
  assert.deepEqual(fields.map((field) => field.raw), ['*/5', '0', '1,15', '*', 'MON-FRI']);
  assert.deepEqual(fields[0].values, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.equal(fields[0].star, true);
  assert.deepEqual(fields[2].values, [1, 15]);
  assert.deepEqual(fields[4].values, [1, 2, 3, 4, 5]);
  assert.equal(fields[4].star, false);
  assert.match(fields[0].text, /每 5 分钟/);
  assert.match(fields[4].text, /周一至周五/);
});

test('parse 把 ? 当成 *，把 7 当成周日', () => {
  assert.equal(cron.parse('0 0 * * ?')[4].star, true);
  assert.deepEqual(cron.parse('0 0 * * ?')[4].values, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(cron.parse('0 0 * * 7')[4].values, [0]);
  assert.deepEqual(cron.parse('0 0 * * 0,7')[4].values, [0]);
  assert.deepEqual(cron.parse('0 0 ? * *')[2].values.length, 31);
});

test('parse 与 describe 对非法表达式抛出中文错误', () => {
  assert.throws(() => cron.parse('0 0 L * *'), /不支持 L/);
  assert.throws(() => cron.describe('每 5 分钟'), /5 个字段/);
});

test('describe 输出整句中文描述', () => {
  assert.equal(cron.describe('* * * * *'), '每分钟执行');
  assert.equal(cron.describe('*/5 * * * *'), '每 5 分钟执行');
  assert.equal(cron.describe('0 * * * *'), '每小时的第 0 分钟执行');
  assert.equal(cron.describe('0 0 * * *'), '在 00:00 执行');
  assert.equal(cron.describe('0 9 * * 1-5'), '每周一至周五的 09:00 执行');
  assert.equal(cron.describe('0 0 1 * *'), '每月 1 日的 00:00 执行');
  assert.equal(cron.describe('0 0 1 1 *'), '每年 1 月的 1 日的 00:00 执行');
  assert.match(cron.describe('0 0 1 * 1'), /每月 1 日或每周一/);
  assert.match(cron.describe('0 0 1 * 1'), /「或」语义/);
});

test('nextRuns 从参考时间起算，严格晚于参考时刻', () => {
  const from = at(2024, 3, 1, 0, 0);
  const runs = cron.nextRuns('*/5 * * * *', 3, from);
  assert.deepEqual(list(runs), ['2024-03-01 00:05', '2024-03-01 00:10', '2024-03-01 00:15']);
  runs.forEach((date) => assert.ok(date.getTime() > from.getTime()));
});

test('nextRuns 支持 0 9 * * 1-5（工作日 9 点）', () => {
  const runs = cron.nextRuns('0 9 * * 1-5', 6, at(2024, 3, 1, 0, 0));
  assert.deepEqual(list(runs), [
    '2024-03-01 09:00',
    '2024-03-04 09:00',
    '2024-03-05 09:00',
    '2024-03-06 09:00',
    '2024-03-07 09:00',
    '2024-03-08 09:00'
  ]);
  const weekend = cron.nextRuns('0 9 * * 0', 1, at(2024, 3, 1, 0, 0))[0];
  assert.equal(show(weekend), '2024-03-03 09:00');
});

test('nextRuns 跨月与跨年', () => {
  assert.deepEqual(
    list(cron.nextRuns('0 0 1 * *', 3, at(2024, 1, 15, 12, 0))),
    ['2024-02-01 00:00', '2024-03-01 00:00', '2024-04-01 00:00']
  );
  assert.deepEqual(
    list(cron.nextRuns('30 6 1 1 *', 2, at(2024, 3, 1))),
    ['2025-01-01 06:30', '2026-01-01 06:30']
  );
  assert.deepEqual(
    list(cron.nextRuns('0 0 31 12 *', 2, at(2024, 1, 1))),
    ['2024-12-31 00:00', '2025-12-31 00:00']
  );
});

test('nextRuns 命中 2 月 29 日（闰年）', () => {
  assert.deepEqual(
    list(cron.nextRuns('0 0 29 2 *', 3, at(2024, 3, 1))),
    ['2028-02-29 00:00', '2032-02-29 00:00', '2036-02-29 00:00']
  );
  // 闰年判断以真实历法为准：1900 年不是闰年，2000 年是
  assert.deepEqual(list(cron.nextRuns('0 0 29 2 *', 1, at(2024, 1, 1))), ['2024-02-29 00:00']);
});

test('每月 31 日在只有 30 天（或 2 月）的月份自动跳过', () => {
  assert.deepEqual(
    list(cron.nextRuns('0 0 31 * *', 3, at(2024, 1, 1))),
    ['2024-01-31 00:00', '2024-03-31 00:00', '2024-05-31 00:00']
  );
  assert.deepEqual(
    list(cron.nextRuns('0 0 31 * *', 3, at(2024, 1, 15))),
    ['2024-01-31 00:00', '2024-03-31 00:00', '2024-05-31 00:00']
  );
});

test('日与周同时被限定时按「或」语义（Vixie）', () => {
  const runs = cron.nextRuns('0 0 1 * 1', 5, at(2024, 1, 2));
  assert.deepEqual(list(runs), [
    '2024-01-08 00:00',
    '2024-01-15 00:00',
    '2024-01-22 00:00',
    '2024-01-29 00:00',
    '2024-02-01 00:00'
  ]);
});

test('日或周以 * 开头时另一字段单独决定', () => {
  assert.deepEqual(
    list(cron.nextRuns('0 0 * * 1', 2, at(2024, 1, 2))),
    ['2024-01-08 00:00', '2024-01-15 00:00']
  );
  assert.deepEqual(
    list(cron.nextRuns('0 0 15 * *', 2, at(2024, 1, 2))),
    ['2024-01-15 00:00', '2024-02-15 00:00']
  );
  // 与 Vixie 一致：*/2 也以 * 开头，所以走与语义，命中「奇数日且是周一」
  assert.deepEqual(
    list(cron.nextRuns('0 0 */2 * 1', 2, at(2024, 1, 2))),
    ['2024-01-15 00:00', '2024-01-29 00:00']
  );
});

test('nextRuns 数量与参数校验', () => {
  assert.equal(cron.nextRuns('0 0 * * *', 7, at(2024, 1, 1)).length, 7);
  assert.equal(cron.nextRuns('0 0 * * *', 1, at(2024, 1, 1)).length, 1);
  assert.equal(cron.nextRuns('0 0 * * *', undefined, at(2024, 1, 1)).length, 10);
  assert.throws(() => cron.nextRuns('0 0 * * *', 0, at(2024, 1, 1)), /次数必须是正整数/);
  assert.throws(() => cron.nextRuns('0 0 * * *', 2.5, at(2024, 1, 1)), /次数必须是正整数/);
  assert.throws(() => cron.nextRuns('0 0 * * *', 1, new Date('坏时间')), /起始时间无效/);
});

test('永不命中的表达式由迭代上限兜住而不是死循环', () => {
  assert.throws(() => cron.nextRuns('0 0 30 2 *', 1, at(2024, 1, 1)), /只找到 0 次/);
  assert.throws(() => cron.nextRuns('0 0 31 2 *', 3, at(2024, 1, 1)), /只找到 0 次/);
});

test('07-cron 工具声明符合契约', () => {
  assert.equal(parserTool.id, 'cron');
  assert.equal(parserTool.group, 'time');
  assert.equal(typeof parserTool.mount, 'function');
  assert.equal(typeof parserTool.desc, 'string');
});

test('07-cron 的 api 复用核心，非法表达式只提示不抛异常', () => {
  const api = parserTool.api;
  assert.equal(api.validate('0 9 * * 1-5').ok, true);
  assert.equal(api.validate('0 9 * * 1-8').ok, false);
  assert.equal(api.parse('每秒都跑'), null);
  assert.match(api.describe('每秒都跑'), /无效/);
  assert.deepEqual(api.nextRuns('每秒都跑'), []);
  assert.deepEqual(api.fieldRows('每秒都跑'), []);
  assert.equal(api.fieldRows('*/5 0 1 * *').length, 5);
  assert.equal(api.fieldRows('*/5 0 1 * *')[0].raw, '*/5');
  assert.match(api.fieldRows('*/5 0 1 * *')[0].text, /每 5 分钟/);
  assert.deepEqual(
    list(api.nextRuns('0 0 * * *', 2, at(2024, 1, 1))),
    ['2024-01-02 00:00', '2024-01-03 00:00']
  );
  api.templates.forEach((item) => {
    assert.equal(api.validate(item.expr).ok, true, item.label + ' 的模板不合法：' + item.expr);
  });
  assert.equal(api.templates.length, 8);
});

test('支持 6 段写法（秒 分 时 日 月 周，Quartz / Spring）', () => {
  const six = [
    '* * * * * *',
    '*/30 * * * * *',
    '0 * * * * *',
    '0 0 9 * * 1-5',
    '30 0 9 * * *',
    '0 0 12 * * ?'
  ];
  six.forEach((expr) => {
    const result = cron.validate(expr);
    assert.equal(result.ok, true, expr + ' 被判为非法：' + result.message);
  });
  // 7 段（带年份）仍然拒绝，并说明支持的是哪两种写法
  assert.match(cron.validate('0 0 9 * * 1-5 2026').message, /5 个字段/);

  const fields = cron.parse('0 0 9 * * 1-5');
  assert.equal(fields.length, 6);
  assert.equal(fields.hasSeconds, true);
  assert.equal(fields[0].name, '秒');
  assert.equal(fields[1].name, '分钟');
  assert.equal(fields[5].name, '星期');
  assert.equal(cron.parse('0 9 * * 1-5').hasSeconds, false, '5 段写法不应带秒字段');

  assert.equal(cron.describe('0 0 9 * * 1-5'), '每周一至周五的 09:00:00 执行');
  assert.equal(cron.describe('*/30 * * * * *'), '每 30 秒执行');
  assert.equal(cron.describe('* * * * * *'), '每秒执行');
  assert.equal(cron.describe('0 * * * * *'), '每分钟执行');
});

test('6 段写法的 nextRuns 走到秒粒度', () => {
  const base = at(2024, 3, 1);
  // list 辅助函数只格式化到分钟，秒级断言直接看 Date 的时分秒
  const two = (value) => (value < 10 ? '0' : '') + value;
  const clock = (runs) => runs.map((date) =>
    two(date.getHours()) + ':' + two(date.getMinutes()) + ':' + two(date.getSeconds()));
  assert.deepEqual(
    clock(cron.nextRuns('*/30 * * * * *', 4, base)),
    ['00:00:30', '00:01:00', '00:01:30', '00:02:00']
  );
  assert.deepEqual(
    clock(cron.nextRuns('5 0 9 * * *', 2, base)),
    ['09:00:05', '09:00:05']
  );
  // 5 段写法的秒恒为 0，与等价的 6 段写法结果必须完全一致
  assert.deepEqual(
    list(cron.nextRuns('0 9 * * 1-5', 3, base)),
    list(cron.nextRuns('0 0 9 * * 1-5', 3, base))
  );
});

test('08-cron-builder 支持切换到 6 段写法', () => {
  const api = builderTool.api;
  assert.equal(api.build(api.defaults(), false), '* * * * *');
  assert.equal(api.build(api.defaults(true), true), '* * * * * *');
  assert.equal(api.fieldsFor(false).length, 5);
  assert.equal(api.fieldsFor(true).length, 6);
  assert.equal(api.fieldsFor(true)[0].name, '秒');

  // 6 段下每种预设组合仍要产出合法表达式，且恰好 6 段
  api.fieldsFor(true).forEach((config, index) => {
    config.modes.forEach((mode) => {
      const states = api.defaults(true);
      states[index] = { mode: mode.id, step: 7, custom: config.custom };
      const expr = api.build(states, true);
      assert.equal(expr.split(' ').length, 6, expr);
      assert.equal(cron.validate(expr).ok, true, config.name + ' + ' + mode.label + ' 拼出非法表达式：' + expr);
    });
  });
});

test('08-cron-builder 工具声明符合契约', () => {
  assert.equal(builderTool.id, 'cron-builder');
  assert.equal(builderTool.group, 'time');
  assert.equal(typeof builderTool.mount, 'function');
  assert.equal(builderTool.api.fields.length, 5);
});

test('08-cron-builder 每种预设组合都产出合法表达式', () => {
  const api = builderTool.api;
  assert.equal(api.build(api.defaults()), '* * * * *');
  api.fields.forEach((config, index) => {
    config.modes.forEach((mode) => {
      const states = api.defaults();
      states[index] = { mode: mode.id, step: 7, custom: config.custom };
      const expr = api.build(states);
      assert.equal(expr.split(' ').length, 5, expr);
      assert.equal(cron.validate(expr).ok, true, config.name + ' + ' + mode.label + ' 拼出非法表达式：' + expr);
    });
  });
});

test('08-cron-builder 的边界处理：留空退回不限、步长被夹紧', () => {
  const api = builderTool.api;
  const blank = api.defaults();
  blank[0] = { mode: 'custom', custom: '   ' };
  assert.equal(api.build(blank), '* * * * *');
  const small = api.defaults();
  small[1] = { mode: 'step', step: 0 };
  assert.equal(api.build(small).split(' ')[1], '*/1');
  const huge = api.defaults();
  huge[1] = { mode: 'step', step: 999 };
  assert.equal(api.build(huge).split(' ')[1], '*/59');
  const wrong = api.defaults();
  wrong[4] = { mode: 'custom', custom: '99' };
  assert.equal(cron.validate(api.build(wrong)).ok, false);
  const workday = api.defaults();
  workday[4] = { mode: 'workday' };
  assert.equal(api.build(workday), '* * * * 1-5');
  assert.equal(cron.describe(api.build(workday)), '每周一至周五的每分钟执行');
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

const findByText = (host, tag, value) => collect(host, (node) => node.tagName === tag && node.textContent === value)[0];

test('mount：Cron 解析工具在最小 DOM 替身上能构造界面并响应模板按钮', () => {
  withFakeDom(() => {
    const gn = loadPage(['src/lib/cron.js', 'src/app.js', 'src/tools/07-cron.js']);
    const host = fakeNode('div');
    gn.tools[0].mount(host);
    assert.ok(host.childNodes.length > 0, 'mount 没有构造任何界面');

    const descOut = collect(host, (node) => node.className === 'tb-output')[0];
    const message = collect(host, (node) => node.className.indexOf('tb-msg') === 0)[0];
    // 默认表达式 0 0 9 * * 1-5（6 段写法）：描述、提示与两张表（6 个字段 + 10 次执行时间）都要出来
    assert.equal(descOut.textContent, '每周一至周五的 09:00:00 执行');
    assert.match(message.textContent, /表达式合法/);
    assert.equal(collect(host, (node) => node.tagName === 'tr').length, 18);

    findByText(host, 'button', '每天 0 点').fire('click');
    assert.equal(descOut.textContent, '在 00:00 执行');
    const input = collect(host, (node) => node.tagName === 'input')[0];
    assert.equal(input.value, '0 0 * * *');
    assert.equal(collect(host, (node) => node.tagName === 'tr').length, 17);

    input.value = '不是表达式';
    input.fire('input');
    assert.match(message.textContent, /表达式无效：/);
    assert.equal(descOut.textContent, '');
    assert.equal(collect(host, (node) => node.tagName === 'tr').length, 0);
  });
});

test('mount：Cron 生成工具的参数控件只在需要时出现且都带中文标签', () => {
  withFakeDom(() => {
    const gn = loadPage(['src/lib/cron.js', 'src/app.js', 'src/tools/08-cron-builder.js']);
    const host = fakeNode('div');
    gn.tools[0].mount(host);

    const api = builderTool.api;
    const outputs = collect(host, (node) => node.className === 'tb-output');
    const badgeText = () => collect(host, (node) => node.className.indexOf('tb-badge') === 0)[0].textContent;
    const selects = collect(host, (node) => node.tagName === 'select');
    // 只统计参数输入框：顶部的写法开关是 checkbox，不属于「需要参数时才出现的输入框」
    const inputs = () => collect(host, (node) => node.tagName === 'input' && node.attrs.type !== 'checkbox');
    // 输入框必须落在 GN.ui.field 生成的 <label class="tb-field"> 里，且标签文字非空
    const labelTextOf = (node) => {
      let parent = node.parentNode;
      while (parent) {
        if (parent.tagName === 'label' && parent.className.indexOf('tb-field') === 0) {
          const span = parent.childNodes.find((child) => child.className === 'tb-label');
          return span ? span.textContent : '';
        }
        parent = parent.parentNode;
      }
      return null;
    };

    assert.equal(selects.length, 6, '默认 6 段写法：秒/分钟/小时/日/月/周 各一个预设下拉');
    assert.equal(outputs.length, 2, '表达式与中文描述各一个输出区');
    assert.equal(outputs[0].textContent, '* * * * * *');
    assert.equal(outputs[1].textContent, '每秒执行');
    assert.match(badgeText(), /通过校验/);
    // 默认每个字段都是「不需要额外参数」的预设：界面上一个输入框都不该有
    assert.equal(inputs().length, 0, '默认状态下不应出现任何输入框');

    // 逐个字段、逐个预设核对可见控件集合：需要参数时只出现一个带中文标签的输入框
    api.fieldsFor(true).forEach((config, index) => {
      config.modes.forEach((mode) => {
        selects[index].value = mode.id;
        selects[index].fire('change');
        const shown = inputs();
        if (mode.param) {
          assert.equal(shown.length, 1, config.name + ' + ' + mode.label + ' 应只出现一个输入框');
          assert.equal(shown[0].attrs.type, mode.param === 'step' ? 'number' : 'text');
          assert.ok(String(mode.paramLabel).length > 0, '参数预设必须带标签文字');
          assert.equal(labelTextOf(shown[0]), mode.paramLabel, config.name + ' + ' + mode.label + ' 的输入框缺少中文标签');
        } else {
          assert.equal(shown.length, 0, config.name + ' + ' + mode.label + ' 不应出现输入框');
        }
        assert.equal(cron.validate(outputs[0].textContent).ok, true,
          config.name + ' + ' + mode.label + ' 拼出非法表达式：' + outputs[0].textContent);
      });
      selects[index].value = config.def;
      selects[index].fire('change');
      assert.equal(inputs().length, 0, config.name + ' 回到默认预设后输入框应消失');
    });

    // 参数真的参与生成：分钟是 6 段写法下的第 2 个下拉（第 1 个是秒）
    selects[1].value = 'step';
    selects[1].fire('change');
    assert.equal(inputs()[0].attrs.type, 'number');
    inputs()[0].value = '15';
    inputs()[0].fire('input');
    assert.equal(outputs[0].textContent, '* */15 * * * *');

    // 切「指定分钟」后换成文本框，标签与取值都跟着变
    selects[1].value = 'custom';
    selects[1].fire('change');
    assert.equal(labelTextOf(inputs()[0]), '分钟列表（如 0,15,30 或 0-30/5）');
    assert.equal(outputs[0].textContent, '* 0,30 * * * *');

    // 周字段（6 段写法下的最后一个下拉）切到「工作日」这种固定值预设，不应该出现输入框
    selects[5].value = 'workday';
    selects[5].fire('change');
    assert.equal(outputs[0].textContent, '* 0,30 * * * 1-5');
    assert.equal(inputs().length, 1, '工作日预设不应再添输入框');

    // 自定义写成非法值时必须报错而不是崩
    inputs()[0].value = '99';
    inputs()[0].fire('input');
    assert.equal(outputs[0].textContent, '* 99 * * * 1-5');
    assert.match(badgeText(), /未通过/);
    const message = collect(host, (node) => node.className.indexOf('tb-msg') === 0)[0];
    assert.match(message.textContent, /未通过校验/);

    // 勾选「用 5 段写法」后切回 5 段：秒卡片消失、表达式回到 5 段、描述跟着变
    const toggle = collect(host, (node) => node.tagName === 'input' && node.attrs.type === 'checkbox')[0];
    assert.ok(toggle, '缺少「用 5 段写法」开关');
    assert.equal(toggle.checked, false, '默认不应勾选：隐含就是 6 段');
    toggle.checked = true;
    toggle.fire('change');
    assert.equal(collect(host, (node) => node.tagName === 'select').length, 5, '切到 5 段后应剩 5 个下拉');
    assert.equal(collect(host, (node) => node.tagName === 'input' && node.attrs.type !== 'checkbox').length, 0);
    assert.equal(cron.parse(outputs[0].textContent).hasSeconds, false, '切到 5 段后表达式不应带秒');
    assert.equal(outputs[0].textContent, '* * * * *');
    assert.equal(outputs[1].textContent, '每分钟执行');

    // 再切回 6 段
    toggle.checked = false;
    toggle.fire('change');
    assert.equal(collect(host, (node) => node.tagName === 'select').length, 6, '切回 6 段后应恢复 6 个下拉');
    assert.equal(outputs[0].textContent, '* * * * * *');
  });
});
