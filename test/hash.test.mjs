import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadGN, loadTool } from '../scripts/test-loader.mjs';

const LIB_FILES = ['src/lib/bytes.js', 'src/lib/md5.js', 'src/lib/sha1.js', 'src/lib/sha256.js'];
const { GN, tool } = loadTool('src/tools/05-hash.js', LIB_FILES);
const api = tool.api;
const lib = GN.lib;

const utf8 = (text) => lib.bytes.utf8Encode(text);
const cryptoHex = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const ALGORITHMS = [
  { id: 'md5', crypto: 'md5', label: 'MD5', length: 32 },
  { id: 'sha1', crypto: 'sha1', label: 'SHA-1', length: 40 },
  { id: 'sha256', crypto: 'sha256', label: 'SHA-256', length: 64 }
];
const hexOf = { md5: api.md5Hex, sha1: api.sha1Hex, sha256: api.sha256Hex };

test('工具声明符合契约', () => {
  assert.equal(tool.id, 'hash');
  assert.equal(tool.group, 'hash');
  assert.equal(typeof tool.title, 'string');
  assert.equal(typeof tool.desc, 'string');
  assert.equal(typeof tool.mount, 'function');
  ['md5Hex', 'sha1Hex', 'sha256Hex', 'hashesOfText', 'match'].forEach((name) => {
    assert.equal(typeof api[name], 'function', '缺少 api.' + name);
  });
});

test('lib 三个哈希按约定挂载且顶层不触碰 DOM', () => {
  assert.equal(typeof lib.md5, 'function');
  assert.equal(typeof lib.sha1, 'function');
  assert.equal(typeof lib.sha256, 'function');
});

test('MD5 权威向量（RFC 1321 硬编码）', () => {
  assert.equal(api.md5Hex(utf8('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(api.md5Hex(utf8('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(
    api.md5Hex(utf8('The quick brown fox jumps over the lazy dog')),
    '9e107d9d372bb6826bd81d3542a419d6'
  );
});

test('SHA-1 权威向量（FIPS 180-4 硬编码）', () => {
  assert.equal(api.sha1Hex(utf8('')), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(api.sha1Hex(utf8('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('SHA-256 权威向量（FIPS 180-4 硬编码）', () => {
  assert.equal(api.sha256Hex(utf8('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(api.sha256Hex(utf8('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

/* ---------------- 交叉验证样本：覆盖 55/56/63/64/65 与 119/120 字节分组边界 ---------------- */

const SAMPLES = [
  { label: '空串', text: '' },
  { label: '纯 ASCII abc', text: 'abc' },
  { label: '整句 ASCII', text: 'The quick brown fox jumps over the lazy dog' },
  { label: 'ASCII 55 字节（分组内最后一格）', text: 'a'.repeat(55) },
  { label: 'ASCII 56 字节（刚好触发补整块）', text: 'a'.repeat(56) },
  { label: 'ASCII 63 字节', text: 'a'.repeat(63) },
  { label: 'ASCII 64 字节（整块边界）', text: 'a'.repeat(64) },
  { label: 'ASCII 65 字节', text: 'a'.repeat(65) },
  { label: 'ASCII 119 字节（第二块边界前）', text: 'a'.repeat(119) },
  { label: 'ASCII 120 字节', text: 'a'.repeat(120) },
  { label: 'ASCII 127 字节', text: 'a'.repeat(127) },
  { label: 'ASCII 128 字节', text: 'a'.repeat(128) },
  { label: '中文句子', text: '哈希算法：MD5 / SHA-1 / SHA-256 全部在本机计算，不上传任何数据。' },
  { label: 'emoji 与组合字符', text: '🚀🎉😀 表情与 emoji 边界测试' },
  { label: '中文 18 字 = 54 字节', text: '中'.repeat(18) },
  { label: '中文 19 字 = 57 字节（跨 56 边界）', text: '中'.repeat(19) },
  { label: '中文 20 字 = 60 字节', text: '中'.repeat(20) },
  { label: '中文 21 字 = 63 字节', text: '中'.repeat(21) },
  { label: '中文 22 字 = 66 字节（跨 64 边界）', text: '中'.repeat(22) },
  { label: 'ASCII 200000 字节长文本', text: 'abcdefghij'.repeat(20000) },
  { label: '多字节 240000 字节长文本', text: '汉字😀ab'.repeat(20000) }
];

test('与 node:crypto 交叉验证 21 组文本样本 × 3 种算法', () => {
  SAMPLES.forEach(({ label, text }) => {
    const bytes = utf8(text);
    ALGORITHMS.forEach(({ id, crypto, length }) => {
      const actual = hexOf[id](bytes);
      const expected = cryptoHex(crypto, bytes);
      assert.equal(actual, expected, label + ' 的 ' + id + ' 不一致');
      assert.equal(actual.length, length, label + ' 的 ' + id + ' 长度不是 ' + length);
      assert.equal(actual, actual.toLowerCase(), label + ' 的 ' + id + ' 不是小写十六进制');
    });
  });
});

test('边界长度确实是 55/56/63/64/65 与 119/120 字节，长文本确实达 200KB 级', () => {
  const byteLength = (text) => utf8(text).length;
  assert.deepEqual(
    [55, 56, 63, 64, 65, 119, 120].map((n) => byteLength('a'.repeat(n))),
    [55, 56, 63, 64, 65, 119, 120]
  );
  assert.equal(byteLength('中'.repeat(19)), 57);
  assert.equal(byteLength('中'.repeat(22)), 66);
  assert.equal(byteLength('abcdefghij'.repeat(20000)), 200000);
  assert.equal(byteLength('汉字😀ab'.repeat(20000)), 240000);
});

test('lib 直接接受 Uint8Array：含 0x00、0xFF 与非 UTF-8 字节', () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { bytes[i] = i; }
  ALGORITHMS.forEach(({ id, crypto }) => {
    assert.equal(hexOf[id](bytes), cryptoHex(crypto, bytes), '0x00-0xFF 全字节的 ' + id + ' 不一致');
  });

  [55, 56, 63, 64, 65, 119, 120, 1000].forEach((size) => {
    const raw = new Uint8Array(size);
    for (let i = 0; i < size; i++) { raw[i] = (i * 31 + 7) & 255; }
    ALGORITHMS.forEach(({ id, crypto }) => {
      assert.equal(hexOf[id](raw), cryptoHex(crypto, raw), size + ' 字节原始数据的 ' + id + ' 不一致');
    });
  });
});

test('lib 与 api 的十六进制输出在同一实现上一致', () => {
  const bytes = utf8('一致性检查');
  assert.equal(lib.md5(bytes), api.md5Hex(bytes));
  assert.equal(lib.sha1(bytes), api.sha1Hex(bytes));
  assert.equal(lib.sha256(bytes), api.sha256Hex(bytes));
});

test('hashesOfText 返回 md5 / sha1 / sha256 三个键且与 node:crypto 一致', () => {
  const text = 'GoNavi 开发者工具箱 · 哈希工具';
  const bytes = utf8(text);
  const hashes = api.hashesOfText(text);
  assert.deepEqual(Object.keys(hashes).sort(), ['md5', 'sha1', 'sha256']);
  ALGORITHMS.forEach(({ id, crypto }) => {
    assert.equal(hashes[id], cryptoHex(crypto, bytes), id + ' 不一致');
  });
  assert.equal(api.hashesOfText('').md5, 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(api.hashesOfText(null).sha1, 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(api.hashesOfText(undefined).sha256,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('match 指出哈希属于哪种算法', () => {
  const text = '哈希比对样本 abc 123';
  const hashes = api.hashesOfText(text);
  assert.equal(api.match(hashes.md5, text), 'md5');
  assert.equal(api.match(hashes.sha1, text), 'sha1');
  assert.equal(api.match(hashes.sha256, text), 'sha256');
});

test('match 忽略大小写与所有空白', () => {
  const text = 'abc';
  const md5 = '900150983cd24fb0d6963f7d28e17f72';
  assert.equal(api.match(md5.toUpperCase(), text), 'md5');
  assert.equal(api.match('  90015098 3cd24fb0\td6963f7d\n28e17f72  ', text), 'md5');
  assert.equal(api.match('a99 93e36 4706816aba3e25717850c26c9cd0d89d', text), 'sha1');
  assert.equal(
    api.match(' BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD ', text),
    'sha256'
  );
});

test('match 不匹配或非法输入返回 null', () => {
  const text = 'abc';
  assert.equal(api.match('d41d8cd98f00b204e9800998ecf8427e', text), null, '空串哈希不该匹配 abc');
  assert.equal(api.match('900150983cd24fb0d6963f7d28e17f73', text), null, '改一位就不该匹配');
  assert.equal(api.match('', text), null);
  assert.equal(api.match('   ', text), null);
  assert.equal(api.match('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', text), null, '非十六进制返回 null');
  assert.equal(api.match('900150983cd24fb0d6963f7d28e17f7', text), null, '短一位返回 null');
  assert.equal(api.match(null, text), null);
  assert.equal(api.match(undefined, text), null);
});

test('match 与空文本比对时命中空内容哈希', () => {
  assert.equal(api.match('d41d8cd98f00b204e9800998ecf8427e', ''), 'md5');
  assert.equal(api.match('da39a3ee5e6b4b0d3255bfef95601890afd80709', ''), 'sha1');
  assert.equal(api.match('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', ''), 'sha256');
  assert.equal(api.match('d41d8cd98f00b204e9800998ecf8427e', 'x'), null);
});

test('lib 对非法入参抛出中文错误而不是静默算错', () => {
  const junk = ['abc', 123, null, undefined, {}, { length: 3 }];
  ['md5', 'sha1', 'sha256'].forEach((name) => {
    junk.forEach((bad) => {
      assert.throws(() => lib[name](bad), /入参必须是 Uint8Array/,
        'lib.' + name + '(' + String(bad) + ') 应抛中文错误');
    });
  });
});

test('api 层对非法入参同样抛出中文错误，不静默算错', () => {
  const junk = ['abc', 123, 1.5, null, undefined, {}, { length: 3 }, new DataView(new ArrayBuffer(4))];
  ['md5Hex', 'sha1Hex', 'sha256Hex'].forEach((name) => {
    junk.forEach((bad) => {
      assert.throws(() => api[name](bad), /Uint8Array/,
        name + '(' + String(bad) + ') 应抛中文错误');
    });
  });
  assert.throws(() => api.md5Hex([1, 'x']), /0\.\.255/);
  assert.throws(() => api.sha1Hex([-1]), /0\.\.255/);
  assert.throws(() => api.sha256Hex([0.5]), /0\.\.255/);
  assert.throws(() => api.md5Hex([256]), /0\.\.255/);
  assert.equal(api.md5Hex([97, 98, 99]), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(api.sha1Hex(new Uint8Array([97, 98, 99])), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

/* ---------------- 界面挂载冒烟：Node 里没有浏览器，用最小 DOM 桩验证 mount 的取值与提示 ---------------- */

function makeStubElement(tag) {
  const node = {
    nodeType: 1, tagName: String(tag).toUpperCase(), childNodes: [], attributes: {}, style: {},
    _text: '', value: '', listeners: {},
    appendChild(child) { this.childNodes.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.childNodes = this.childNodes.filter((item) => item !== child); return child; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    dispatch(type) { (this.listeners[type] || []).forEach((handler) => handler({ target: this })); },
    select() {}, focus() {}
  };
  Object.defineProperty(node, 'className', {
    get() { return this.attributes.class || ''; },
    set(value) { this.attributes.class = value; }
  });
  Object.defineProperty(node, 'textContent', {
    get() { return this.childNodes.length ? this.childNodes.map((child) => child.textContent).join('') : this._text; },
    set(value) { this._text = String(value); this.childNodes = []; }
  });
  return node;
}

test('mount 可用：空输入给提示不抛错、输入后三行结果、清空后回到提示', () => {
  // app.js 是内核，会把 GN 挂到 globalThis 上；工具模块从同一个 GN 取 GN.ui。
  globalThis.document = {
    readyState: 'loading',                       // 让 app.js 只建 UI 基元，不自动 start()
    body: makeStubElement('body'),
    createElement: makeStubElement,
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    getElementById: () => null,
    addEventListener() {}
  };
  // app.js 的主题模块会读写 documentElement 与 window 级事件 / 媒体查询，替身补上最小实现。
  globalThis.document.documentElement = { setAttribute() {}, getAttribute() { return null; }, style: { setProperty() {} } };
  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.matchMedia = globalThis.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
  try {
    loadGN(['src/app.js']);
    const kernel = globalThis.GN;
    // test-loader 每次新建 GN，而 app.js 绑的是 globalThis，所以这里按页面加载顺序装进内核。
    [...LIB_FILES, 'src/tools/05-hash.js'].forEach((file) => {
      new Function('GN', readFileSync(new URL('../' + file, import.meta.url), 'utf8'))(kernel);
    });
    const tool = kernel.tools[kernel.tools.length - 1];
    const root = makeStubElement('div');
    tool.mount(root);

    const [input, tableBox, buttons, tableMsg, field, compareMsg] = root.childNodes;
    const compareInput = field.childNodes[1];
    const cells = () => {
      const out = [];
      (function walk(node) {
        if (node.nodeType === 1 && node.tagName === 'TD') { out.push(node.textContent); }
        (node.childNodes || []).forEach(walk);
      })(tableBox);
      return out;
    };

    assert.match(tableMsg.textContent, /没有输入/, '空输入应给提示');
    assert.deepEqual(cells(), [
      'MD5', 'd41d8cd98f00b204e9800998ecf8427e',
      'SHA-1', 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      'SHA-256', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    ]);

    input.value = 'abc';
    input.dispatch('input');
    assert.deepEqual(cells(), [
      'MD5', '900150983cd24fb0d6963f7d28e17f72',
      'SHA-1', 'a9993e364706816aba3e25717850c26c9cd0d89d',
      'SHA-256', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    ]);

    compareInput.value = ' 9001 5098 3CD24FB0D6963F7D28E17F72 ';
    compareInput.dispatch('input');
    assert.equal(compareMsg.textContent, '匹配 MD5');

    buttons.childNodes[4].dispatch('click');     // 复制按钮 3 个 + spacer + 清空
    assert.match(tableMsg.textContent, /没有输入/, '清空后应回到空输入提示');
    assert.equal(compareMsg.textContent, '');
  } finally {
    delete globalThis.document;
  }
});

/* ---------------- 回归：沙箱/iframe 里 TextEncoder 属于另一个 realm（与 scripts/page-runner.mjs 同款注入） ---------------- */

test('跨 realm 字节不被 lib 拒绝：沙箱内 hashesOfText 与 mount 首条路径都能算', () => {
  const files = [...LIB_FILES, 'src/tools/05-hash.js'];
  const source = files.map((file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8')).join('\n');
  const sandbox = { TextEncoder, TextDecoder, console };   // 注入宿主 realm 的 TextEncoder
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(
    'var GN = globalThis.GN = { lib: {}, tools: [], groups: [], register: function (tool) { this.tools.push(tool); } };\n' + source,
    context,
    { filename: 'page-sandbox.js' }
  );

  // 前置条件：沙箱内 instanceof 判定为 false —— 这正是线上挂载报错的触发条件
  assert.equal(
    vm.runInContext('GN.lib.bytes.utf8Encode("abc") instanceof Uint8Array', context),
    false,
    '前置条件不成立：沙箱内的字节已是本 realm 的 Uint8Array，这个用例就测不到跨 realm 路径'
  );

  const vmApi = vm.runInContext('GN.tools[0].api', context);
  const foreignBytes = vm.runInContext('GN.lib.bytes.utf8Encode("abc")', context);
  assert.equal(vmApi.md5Hex(foreignBytes), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(vmApi.sha1Hex(foreignBytes), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(vmApi.sha256Hex(foreignBytes),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  // mount 首次渲染走的就是 hashesOfText('')，缺陷正是从这条路径抛出来的。
  // 沙箱返回的对象属于另一个 realm，deepStrictEqual 会因原型不同而失败，所以逐字段比较。
  const emptyHashes = vmApi.hashesOfText('');
  assert.equal(emptyHashes.md5, 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(emptyHashes.sha1, 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(emptyHashes.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const mixed = '中文 🚀 abc';
  const vmHashes = vmApi.hashesOfText(mixed);
  const hostHashes = api.hashesOfText(mixed);
  ALGORITHMS.forEach(({ id }) => {
    assert.equal(vmHashes[id], hostHashes[id], '跨 realm 的 ' + id + ' 应与本 realm 一致');
  });
  assert.equal(vmApi.match(' 9001 5098 3CD24FB0D6963F7D28E17F72 ', 'abc'), 'md5');
});


