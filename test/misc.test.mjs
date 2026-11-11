/* 「其他工具」组三个工具的单元测试：UUID / 随机串、进制转换、颜色转换。
   随机相关的断言一律用确定性随机源（常数序列或可复现的 LCG 序列），
   只断言格式与不变量，不断言具体的随机值。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { loadTool } from '../scripts/test-loader.mjs';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const uuid = loadTool('src/tools/13-uuid.js').tool;
const radix = loadTool('src/tools/14-radix.js', ['src/lib/bytes.js']).tool;
const color = loadTool('src/tools/15-color.js').tool;
// 不注入 lib：验证工具在缺少公共字节库时仍能独立工作（宿主页面里出现过这种情况）。
const radixStandalone = loadTool('src/tools/14-radix.js').tool;

const ZERO = () => 0;
const ALMOST_ONE = () => 0.9999999;

// mulberry32：同一种子每次运行产生同一串 [0,1) 值，便于复现而不依赖真实随机。
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('三个工具都符合 misc 组注册契约', () => {
  [uuid, radix, color].forEach((tool) => {
    assert.equal(tool.group, 'misc');
    assert.equal(typeof tool.mount, 'function');
    assert.equal(typeof tool.api, 'object');
    assert.equal(typeof tool.title, 'string');
    assert.equal(typeof tool.desc, 'string');
    assert.ok(tool.title.length > 0 && tool.desc.length > 0);
  });
  assert.equal(uuid.id, 'uuid');
  assert.equal(radix.id, 'radix');
  assert.equal(color.id, 'color');

  ['uuidV4', 'nanoid', 'randomHex', 'uuidV4Batch'].forEach((key) => {
    assert.equal(typeof uuid.api[key], 'function', 'uuid.api.' + key);
  });
  ['parseBigInt', 'convert', 'toBinaryGrouped'].forEach((key) => {
    assert.equal(typeof radix.api[key], 'function', 'radix.api.' + key);
  });
  ['parse', 'toHex', 'toRgb', 'toHsl', 'formatAll', 'luminance'].forEach((key) => {
    assert.equal(typeof color.api[key], 'function', 'color.api.' + key);
  });
});

/* ---------------- UUID / 随机串 ---------------- */

test('uuid：版本位固定 4、变体位落在 8/9/a/b', () => {
  // 常数随机源下结果完全确定，直接把两个极端钉死，比只断格式更严格。
  assert.equal(uuid.api.uuidV4(ZERO), '00000000-0000-4000-8000-000000000000');
  assert.equal(uuid.api.uuidV4(ALMOST_ONE), 'ffffffff-ffff-4fff-bfff-ffffffffffff');

  const Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const rng = seeded(7);
  for (let i = 0; i < 64; i++) {
    const value = uuid.api.uuidV4(rng);
    assert.equal(value.length, 36);
    assert.match(value, Pattern);
    assert.equal(value.charAt(14), '4');
    assert.ok('89ab'.includes(value.charAt(19)), '变体位异常：' + value);
    assert.equal(uuid.api.isUuidV4(value), true);
  }
  assert.equal(uuid.api.isUuidV4('00000000-0000-3000-8000-000000000000'), false);
  assert.equal(uuid.api.isUuidV4('not-a-uuid'), false);
});

test('uuid：批量生成的数量、唯一性与范围校验', () => {
  const rng = seeded(11);
  const list = uuid.api.uuidV4Batch(50, rng);
  assert.equal(list.length, 50);
  assert.equal(new Set(list).size, 50);
  list.forEach((item) => assert.equal(uuid.api.isUuidV4(item), true));

  assert.deepEqual(uuid.api.uuidV4Batch(undefined, ZERO), ['00000000-0000-4000-8000-000000000000']);
  assert.equal(uuid.api.uuidV4Batch(1000, seeded(3)).length, 1000);
  assert.throws(() => uuid.api.uuidV4Batch(0, rng), /1\.\.1000/);
  assert.throws(() => uuid.api.uuidV4Batch(1001, rng), /1\.\.1000/);
  assert.throws(() => uuid.api.uuidV4Batch(2.5, rng), /1\.\.1000/);
  assert.throws(() => uuid.api.uuidV4Batch('x', rng), /1\.\.1000/);
});

test('uuid：NanoID 长度与字符集', () => {
  const alphabet = uuid.api.NANOID_ALPHABET;
  assert.equal(alphabet.length, 64);
  assert.equal(new Set([...alphabet]).size, 64, '字符表存在重复字符');

  assert.equal(uuid.api.nanoid(undefined, ZERO).length, 21, '默认长度应为 21');
  assert.equal(uuid.api.nanoid(8, ZERO), 'u'.repeat(8));

  const rng = seeded(23);
  [1, 8, 21, 64, 512].forEach((size) => {
    const value = uuid.api.nanoid(size, rng);
    assert.equal(value.length, size);
    for (const ch of value) {
      assert.ok(alphabet.includes(ch), '字符不在字符表内：' + ch);
    }
  });
  assert.throws(() => uuid.api.nanoid(0, rng), /1\.\.512/);
  assert.throws(() => uuid.api.nanoid(513, rng), /1\.\.512/);
});

test('uuid：随机十六进制长度与取值范围', () => {
  assert.equal(uuid.api.randomHex(4, ZERO), '00000000');
  assert.equal(uuid.api.randomHex(16, ALMOST_ONE), 'f'.repeat(32));
  assert.equal(uuid.api.randomHex(undefined, ZERO).length, 32, '默认 16 字节');

  const rng = seeded(31);
  [1, 4, 32, 512].forEach((bytes) => {
    const value = uuid.api.randomHex(bytes, rng);
    assert.equal(value.length, bytes * 2);
    assert.match(value, /^[0-9a-f]+$/);
  });
  assert.throws(() => uuid.api.randomHex(0, rng), /1\.\.512/);
  assert.throws(() => uuid.api.randomHex(513, rng), /1\.\.512/);
});

test('uuid：随机源缺 getRandomValues 时降级并标记', () => {
  const weak = uuid.api.createSource(null);
  assert.equal(weak.degraded, true);
  const weakValue = weak.next();
  assert.ok(weakValue >= 0 && weakValue < 1);
  assert.equal(uuid.api.createSource({}).degraded, true);

  // 假宿主随机源：真随机路径应整批取数，而不是逐字节回调。
  let calls = 0;
  let seed = 0;
  const fake = {
    getRandomValues(buffer) {
      calls++;
      for (let i = 0; i < buffer.length; i++) {
        seed = (seed + 1234567) >>> 0;
        buffer[i] = seed;
      }
      return buffer;
    }
  };
  const strong = uuid.api.createSource(fake);
  assert.equal(strong.degraded, false);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const value = strong.next();
    assert.ok(value >= 0 && value < 1, '随机值越界：' + value);
    seen.add(value);
  }
  assert.equal(seen.size, 200);
  assert.equal(calls, 4, '64 个 32 位整数一批，取 200 个值应恰好 4 次宿主调用');
});

test('uuid：大小写与去连字符只影响呈现', () => {
  const value = uuid.api.uuidV4(seeded(5));
  assert.equal(uuid.api.shapeUuid(value, { upper: true }), value.toUpperCase());
  assert.equal(uuid.api.shapeUuid(value, { hyphens: false }).length, 32);
  assert.equal(uuid.api.shapeUuid(value, { upper: true, hyphens: false }), value.replace(/-/g, '').toUpperCase());
  assert.equal(uuid.api.isUuidV4(uuid.api.shapeUuid(value, {})), true);
  assert.equal(uuid.api.isUuidV4(value.toUpperCase()), true, '大写 UUID 也应判定为合法');
});

/* ---------------- 进制转换 ---------------- */

// 超出 2^53 的样本：Number 路线会丢精度，BigInt 路线必须精确。
const BIG_SAMPLES = [
  '9007199254740993',
  '-9007199254740993',
  '340282366920938463463374607431768211455',
  '123456789012345678901234567890',
  '0',
  '255'
];

test('radix：超过 2^53 的整数精确互转', () => {
  assert.equal(typeof radix.api.parseBigInt('9007199254740993', 10), 'bigint');
  assert.equal(radix.api.parseBigInt('9007199254740993', 10), 9007199254740993n);
  assert.equal(radix.api.convert('9007199254740993', 10, 16), '20000000000001');
  assert.equal(radix.api.convert('20000000000001', 16, 10), '9007199254740993');
  assert.equal(radix.api.convert('340282366920938463463374607431768211455', 10, 16), 'f'.repeat(32));
  assert.equal(radix.api.convert('f'.repeat(32), 16, 10), '340282366920938463463374607431768211455');

  BIG_SAMPLES.forEach((text) => {
    radix.api.BASES.forEach((base) => {
      const asBase = radix.api.convert(text, 10, base);
      assert.equal(radix.api.parseBigInt(asBase, base), BigInt(text), text + ' 在 ' + base + ' 进制往返失败');
    });
  });
});

test('radix：自动识别 0x / 0b / 0o 前缀', () => {
  assert.equal(radix.api.parseBigInt('0xff', 'auto'), 255n);
  assert.equal(radix.api.parseBigInt('0XFF', 'auto'), 255n);
  assert.equal(radix.api.parseBigInt('0b1010', 'auto'), 10n);
  assert.equal(radix.api.parseBigInt('0o17', 'auto'), 15n);
  assert.equal(radix.api.parseBigInt('0x1f', 16), 31n);
  assert.equal(radix.api.parseBigInt(' 0b1111 ', 'auto'), 15n);
  assert.equal(radix.api.convert('0xFF', 'auto', 2), '11111111');
  assert.equal(radix.api.convert('0b1111', 'auto', 10), '15');
  assert.equal(radix.api.convert('0o777', 'auto', 10), '511');
  assert.throws(() => radix.api.parseBigInt('0xff', 10), /不一致/);
  assert.throws(() => radix.api.parseBigInt('0b1', 16), /不一致/);
});

test('radix：负数与非法输入的中文报错', () => {
  assert.equal(radix.api.parseBigInt('-0x10', 'auto'), -16n);
  assert.equal(radix.api.convert('-255', 10, 16), '-ff');
  assert.equal(radix.api.convert('-ff', 16, 2), '-11111111');

  assert.throws(() => radix.api.parseBigInt('', 'auto'), /内容为空/);
  assert.throws(() => radix.api.parseBigInt('   ', 'auto'), /内容为空/);
  assert.throws(() => radix.api.parseBigInt('12#', 16), /非法字符/);
  assert.throws(() => radix.api.parseBigInt('1_000', 10), /非法字符/);
  assert.throws(() => radix.api.parseBigInt('102', 2), /合法数字/);
  assert.throws(() => radix.api.parseBigInt('12g', 16), /合法数字/);
  assert.throws(() => radix.api.parseBigInt('0x', 'auto'), /缺少数字/);
  assert.throws(() => radix.api.parseBigInt('-', 'auto'), /缺少数字|内容为空/);
  assert.throws(() => radix.api.parseBigInt('1-2', 10), /正负号/);
  assert.throws(() => radix.api.parseBigInt('1.5', 10), /小数点/);
  assert.throws(() => radix.api.parseBigInt('10', 7), /不支持的进制/);
  assert.throws(() => radix.api.convert('10', 10, 7), /不支持的进制/);
});

test('radix：二进制按 4 位分组', () => {
  assert.equal(radix.api.toBinaryGrouped('ff', 16), '1111 1111');
  assert.equal(radix.api.toBinaryGrouped('0x1234', 'auto'), '0001 0010 0011 0100');
  assert.equal(radix.api.toBinaryGrouped('0b1', 'auto'), '0001');
  assert.equal(radix.api.toBinaryGrouped('1', 10), '0001');
  assert.equal(radix.api.toBinaryGrouped('0', 10), '0000');
  assert.equal(radix.api.toBinaryGrouped('-2', 10), '- 0010');
  assert.equal(radix.api.toBinaryGrouped('9007199254740993', 10), '0010 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0001');
});

test('radix：附带信息（位宽 / 字节数 / UTF-8 解码）', () => {
  const chinese = radix.api.describe('0xE4B8AD', 'auto');
  assert.equal(chinese.utf8.ok, true);
  assert.equal(chinese.utf8.text, '中');
  assert.equal(chinese.bitLength, 24);
  assert.equal(chinese.byteLength, 3);
  assert.equal(chinese.grouped, '1110 0100 1011 1000 1010 1101');
  assert.equal(chinese.bases[2], '111001001011100010101101');
  assert.equal(chinese.bases[10], '14989485');
  assert.equal(chinese.bases[16], 'e4b8ad');
  assert.equal(chinese.decimal, '14989485');

  assert.equal(radix.api.describe('0x41', 'auto').utf8.text, 'A');
  assert.equal(radix.api.describe('255', 10).byteLength, 1);
  assert.equal(radix.api.describe('256', 10).byteLength, 2);
  assert.equal(radix.api.describe('0', 10).byteLength, 1);
  assert.equal(radix.api.describe('-0x41', 'auto').grouped, '- 0100 0001');

  const single = radix.api.describe('0xff', 'auto');
  assert.equal(single.utf8.ok, false);
  assert.match(single.utf8.reason, /UTF-8/);
  assert.equal(radix.api.describe('0', 10).utf8.ok, false);
});

test('radix：没有公共字节库时仍能解码 UTF-8', () => {
  assert.equal(radixStandalone.api.describe('0xE4B8AD', 'auto').utf8.text, '中');
  assert.equal(radixStandalone.api.describe('0x41', 'auto').utf8.text, 'A');
  const bad = radixStandalone.api.describe('0xff', 'auto');
  assert.equal(bad.utf8.ok, false);
  assert.match(bad.utf8.reason, /UTF-8/);
});

test('radix：输出带前缀便于回读', () => {
  assert.equal(radix.api.withPrefix('ff', 16), '0xff');
  assert.equal(radix.api.withPrefix('-ff', 16), '-0xff');
  assert.equal(radix.api.withPrefix('1010', 2), '0b1010');
  assert.equal(radix.api.withPrefix('777', 8), '0o777');
  assert.equal(radix.api.withPrefix('255', 10), '255');
});

/* ---------------- 颜色转换 ---------------- */

test('color：解析各种书写形式', () => {
  assert.deepEqual(color.api.parse('#3399cc'), { r: 51, g: 153, b: 204, a: 1 });
  assert.deepEqual(color.api.parse('3399cc'), { r: 51, g: 153, b: 204, a: 1 });
  assert.deepEqual(color.api.parse('  #FFF  '), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(color.api.parse('#f00'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(color.api.parse('#11223344'), { r: 17, g: 34, b: 51, a: 68 / 255 });
  assert.deepEqual(color.api.parse('#0008'), { r: 0, g: 0, b: 0, a: 136 / 255 });
  assert.deepEqual(color.api.parse('rgb(51,153,204)'), { r: 51, g: 153, b: 204, a: 1 });
  assert.deepEqual(color.api.parse('rgb(51 153 204)'), { r: 51, g: 153, b: 204, a: 1 });
  assert.deepEqual(color.api.parse('rgba(51, 153, 204, 0.5)'), { r: 51, g: 153, b: 204, a: 0.5 });
  assert.deepEqual(color.api.parse('rgb(20%, 60%, 80%)'), { r: 51, g: 153, b: 204, a: 1 });
  assert.deepEqual(color.api.parse('hsl(200, 60%, 50%)'), { r: 51, g: 153, b: 204, a: 1 });
  assert.deepEqual(color.api.parse('hsla(200, 60%, 50%, 0.5)'), { r: 51, g: 153, b: 204, a: 0.5 });
  assert.deepEqual(color.api.parse('HSLA(200deg, 60%, 50%, 50%)'), { r: 51, g: 153, b: 204, a: 0.5 });
  assert.deepEqual(color.api.parse('hsl(-160, 60%, 50%)'), { r: 51, g: 153, b: 204, a: 1 });
});

test('color：formatAll 输出全套表示法', () => {
  assert.deepEqual(color.api.formatAll('#3399cc'), {
    hex: '#3399cc',
    rgb: 'rgb(51, 153, 204)',
    rgba: 'rgba(51, 153, 204, 1)',
    hsl: 'hsl(200, 60%, 50%)',
    hsla: 'hsla(200, 60%, 50%, 1)'
  });

  const half = color.api.formatAll('#3399cc80');
  assert.equal(half.hex, '#3399cc80');
  assert.equal(half.rgb, 'rgb(51, 153, 204)');
  assert.equal(half.rgba, 'rgba(51, 153, 204, 0.502)');
  assert.equal(half.hsla, 'hsla(200, 60%, 50%, 0.502)');
  assert.equal(color.api.toHex({ r: 0, g: 0, b: 0, a: 0 }), '#00000000');
  assert.equal(color.api.formatAll('rgb(0,0,0)').hex, '#000000');
});

test('color：各格式互相往返一致', () => {
  const samples = ['#000000', '#ffffff', '#3399cc', '#7f7f7f', '#ff0000', '#00ff88', '#123456', '#abcdef'];
  samples.forEach((sample) => {
    const expected = color.api.toHex(sample);
    const all = color.api.formatAll(sample);
    assert.equal(color.api.toHex(all.hex), expected, 'HEX 往返：' + sample);
    assert.equal(color.api.toHex(all.rgb), expected, 'RGB 往返：' + sample);
    assert.equal(color.api.toHex(all.rgba), expected, 'RGBA 往返：' + sample);

    // HSL 输出保留 1 位小数，这些样本必须零偏差地转回同一个色值
    assert.equal(color.api.toHex(all.hsl), expected, 'HSL 往返：' + sample);
    assert.equal(color.api.toHex(all.hsla), expected, 'HSLA 往返：' + sample);
  });

  // 随机色抽样：1 位小数的 h/s/l 往返偏差不超过 1 个色阶（8192 个色值实测偏差为 0）
  const rng = seeded(97);
  let worst = 0;
  for (let i = 0; i < 256; i++) {
    const source = { r: Math.floor(rng() * 256), g: Math.floor(rng() * 256), b: Math.floor(rng() * 256), a: 1 };
    const back = color.api.parse(color.api.formatAll(color.api.toHex(source)).hsl);
    worst = Math.max(worst, Math.abs(source.r - back.r), Math.abs(source.g - back.g), Math.abs(source.b - back.b));
  }
  assert.ok(worst <= 1, 'HSL 往返最大偏差 ' + worst + ' 个色阶');

  // 整数 HSL 能精确表示的常用色，要求严格相等
  assert.equal(color.api.toHex('hsl(200, 60%, 50%)'), '#3399cc');
  assert.equal(color.api.toHex('hsl(0, 0%, 50%)'), '#808080');
  assert.equal(color.api.toHex('hsl(120, 100%, 25%)'), '#008000');
  assert.equal(color.api.toHex('hsl(0, 100%, 50%)'), '#ff0000');
  assert.equal(color.api.toHex('hsl(0, 0%, 100%)'), '#ffffff');

  // 带 alpha 的往返：HEX 与 RGBA 字符串必须能还原出一致的 alpha 与色值
  ['#3399cc80', '#00000000', '#ff0000ff'].forEach((sample) => {
    const all = color.api.formatAll(sample);
    assert.equal(color.api.toHex(all.rgba), color.api.toHex(sample), 'RGBA 往返：' + sample);
    assert.equal(color.api.toHex(all.hsla), color.api.toHex(sample), 'HSLA 往返：' + sample);
  });
});

test('color：相对亮度与浅色/深色文字提示', () => {
  assert.equal(color.api.luminance('#000000'), 0);
  assert.ok(Math.abs(color.api.luminance('#ffffff') - 1) < 1e-9);
  const dark = color.api.luminance('#333333');
  const mid = color.api.luminance('#777777');
  const light = color.api.luminance('#bbbbbb');
  assert.ok(dark < mid && mid < light, '亮度应随颜色变浅单调递增');

  assert.equal(color.api.readability('#ffffff').textColor, '深色文字');
  assert.equal(color.api.readability('#000000').textColor, '浅色文字');
  assert.equal(color.api.readability('#eeeeee').darkText, true);
  assert.equal(color.api.readability('#111111').darkText, false);

  assert.ok(Math.abs(color.api.readability('#ffffff').withBlackText - 21) < 1e-9);
  assert.ok(Math.abs(color.api.readability('#000000').withWhiteText - 21) < 1e-9);
  assert.equal(color.api.readability('#000000').level, 'AAA');
  assert.equal(color.api.readability('#ffffff').level, 'AAA');
  assert.ok(Math.abs(color.api.contrastRatio(1, 0) - 21) < 1e-9);
});

test('color：随机颜色取值可用', () => {
  assert.deepEqual(color.api.randomColor(ZERO), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(color.api.randomColor(ALMOST_ONE), { r: 255, g: 255, b: 255, a: 1 });
  const rng = seeded(41);
  for (let i = 0; i < 100; i++) {
    const value = color.api.randomColor(rng);
    [value.r, value.g, value.b].forEach((channel) => {
      assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, '通道越界：' + channel);
    });
    assert.match(color.api.toHex(value), /^#[0-9a-f]{6}$/);
  }
});

test('color：非法输入给中文错误', () => {
  assert.throws(() => color.api.parse(''), /请输入颜色/);
  assert.throws(() => color.api.parse('   '), /请输入颜色/);
  assert.throws(() => color.api.parse('不是颜色'), /无法识别/);
  assert.throws(() => color.api.parse('#ggg'), /非法字符/);
  assert.throws(() => color.api.parse('#12345'), /3 \/ 4 \/ 6 \/ 8/);
  assert.throws(() => color.api.parse('rgb(1,2)'), /需要 3 个参数/);
  assert.throws(() => color.api.parse('rgba(1,2,3)'), /需要 4 个参数/);
  assert.throws(() => color.api.parse('hsl(0, 50%)'), /需要 3 个参数/);
  assert.throws(() => color.api.parse('rgb(300,0,0)'), /0\.\.255/);
  assert.throws(() => color.api.parse('rgb(a,0,0)'), /不是数字/);
  assert.throws(() => color.api.parse('rgb(0,-1,0)'), /0\.\.255/);
  assert.throws(() => color.api.parse('hsl(0, 120%, 50%)'), /0\.\.100%/);
  assert.throws(() => color.api.parse('hsla(0, 50%, 50%, 2)'), /透明度/);
  assert.throws(() => color.api.parse('cmyk(0,0,0,0)'), /不支持的颜色函数/);
  assert.throws(() => color.api.formatAll('nope'), /无法识别/);
  assert.throws(() => color.api.toHex({ r: 300, g: 0, b: 0 }), /0\.\.255/);
});
/* ---------------- mount 冒烟：用真实 GN.ui 在最小 DOM 替身上跑一遍 ---------------- */

// 极简 DOM 替身：只实现 GN.ui 用到的接口。它不替代浏览器验证，
// 但能在 Node 里真跑 mount 与按钮回调，抓住「工具初始化失败」这类只在点开标签时才暴露的错误。
function fakeNode(tag) {
  const node = {
    tagName: tag, childNodes: [], parentNode: null, style: {}, attrs: {}, listeners: {},
    className: '', value: '', checked: false
  };
  let text = '';
  Object.defineProperty(node, 'textContent', {
    get: () => text,
    set: (value) => { text = String(value); node.childNodes.length = 0; }
  });
  node.appendChild = function (child) {
    node.childNodes.push(child);
    child.parentNode = node;
    return child;
  };
  node.removeChild = function (child) {
    const at = node.childNodes.indexOf(child);
    if (at >= 0) { node.childNodes.splice(at, 1); }
    return child;
  };
  node.setAttribute = function (name, value) {
    node.attrs[name] = String(value);
    if (name === 'class') { node.className = String(value); }
  };
  node.getAttribute = function (name) {
    return node.attrs[name] === undefined ? null : node.attrs[name];
  };
  node.addEventListener = function (type, handler) {
    (node.listeners[type] = node.listeners[type] || []).push(handler);
  };
  node.fire = function (type) {
    (node.listeners[type] || []).forEach((handler) => handler.call(node, { type: type }));
  };
  node.classList = { toggle() {}, add() {}, remove() {} };
  return node;
}

// 装上替身并交回还原函数：加载、mount、点按钮都必须发生在替身生效期间。
function installFakeDom() {
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
  return () => {
    globalThis.document = previousDocument;
    globalThis.GN = previousGN;
  };
}

// 按页面的加载方式执行：lib / app / tools 三段脚本共享同一个全局 GN
// （app.js 与 lib/bytes.js 都是从这个全局取 GN 的，不是从模块参数取）。
function loadPageStyle(files) {
  globalThis.GN = { tools: [], lib: {}, groups: [] };
  files.forEach((file) => {
    new Function('GN', fs.readFileSync(path.join(root, file), 'utf8'))(globalThis.GN);
  });
  return globalThis.GN;
}

function collect(node, predicate, out) {
  const list = out || [];
  if (predicate(node)) { list.push(node); }
  node.childNodes.forEach((child) => collect(child, predicate, list));
  return list;
}

test('mount：三个工具能在最小 DOM 替身上构造界面并响应按钮', () => {
  const restore = installFakeDom();
  try {
    const gn = loadPageStyle(['src/lib/bytes.js', 'src/app.js',
      'src/tools/13-uuid.js', 'src/tools/14-radix.js', 'src/tools/15-color.js']);
    const tools = {};
    gn.tools.forEach((tool) => { tools[tool.id] = tool; });
    assert.deepEqual(Object.keys(tools).sort(), ['color', 'radix', 'uuid']);
    assert.equal(typeof gn.ui.badge, 'function', 'app.js 应提供 GN.ui');

    const hosts = {};
    ['uuid', 'radix', 'color'].forEach((id) => {
      hosts[id] = fakeNode('div');
      tools[id].mount(hosts[id]);
      assert.ok(hosts[id].childNodes.length > 0, id + ' 的 mount 没有构造任何界面');
    });

    const button = (host, label) => {
      const found = collect(host, (n) => n.className.indexOf('tb-btn') === 0 && n.textContent === label);
      assert.equal(found.length, 1, '找不到按钮：' + label);
      return found[0];
    };
    const outputOf = (host) => collect(host, (n) => n.className === 'tb-output')[0].textContent;
    const messageOf = (host) => collect(host, (n) => n.className.indexOf('tb-msg') === 0)[0].textContent;
    const detailsOf = (host) => host.childNodes.filter((n) => n.className === 'tb-col')[0].childNodes.length;

    // UUID：批量生成、大小写、长度选项
    const uuidHost = hosts.uuid;
    button(uuidHost, '生成 UUID v4').fire('click');
    const batch = outputOf(uuidHost).split('\n');
    assert.equal(batch.length, 10, '默认应生成 10 个');
    batch.forEach((line) => assert.match(line, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));

    const upperBox = collect(uuidHost, (n) => n.tagName === 'input' && n.attrs.type === 'checkbox')[0];
    upperBox.checked = true;
    upperBox.fire('change');
    button(uuidHost, '生成 UUID v4').fire('click');
    assert.match(outputOf(uuidHost), /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}/);

    button(uuidHost, '生成 NanoID 随机串').fire('click');
    assert.equal(outputOf(uuidHost).length, 21);
    button(uuidHost, '生成随机十六进制').fire('click');
    assert.match(outputOf(uuidHost), /^[0-9A-F]{32}$/);

    // 数量给非法值时应给出中文错误，而不是让异常冒到界面外
    const countInput = collect(uuidHost, (n) => n.tagName === 'input' && n.attrs.type === 'number')[0];
    countInput.value = '0';
    button(uuidHost, '生成 UUID v4').fire('click');
    assert.match(messageOf(uuidHost), /数量必须是/);
    assert.equal(outputOf(uuidHost), '', '出错时应清空结果而不是留着上一次的输出');

    // 进制：mount 内已默认转换一次（9007199254740993 -> 0x20000000000001）
    assert.equal(outputOf(hosts.radix), '0x20000000000001');
    assert.equal(detailsOf(hosts.radix), 2, '应渲染「全部进制」与「附带信息」两张表');
    const radixInput = collect(hosts.radix, (n) => n.className === 'tb-input')[0];
    radixInput.value = '0b1010';
    button(hosts.radix, '转换').fire('click');
    assert.equal(outputOf(hosts.radix), '0xa', '转换失败，界面提示：' + messageOf(hosts.radix));
    radixInput.value = '12#';
    button(hosts.radix, '转换').fire('click');
    assert.match(messageOf(hosts.radix), /非法字符/);
    assert.equal(detailsOf(hosts.radix), 0, '出错时应清空明细表');

    // 颜色：默认色解析 + 随机颜色按钮
    assert.match(outputOf(hosts.color), /HEX {2}#3399cc/);
    button(hosts.color, '随机颜色').fire('click');
    assert.match(outputOf(hosts.color), /^HEX {2}#[0-9a-f]{6}/);
  } finally {
    restore();
  }
});


