import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTool } from '../scripts/test-loader.mjs';

const base64 = loadTool('src/tools/02-base64.js', ['src/lib/bytes.js']).tool;
const url = loadTool('src/tools/03-url.js').tool;
const jwt = loadTool('src/tools/04-jwt.js', ['src/lib/bytes.js']).tool;

// assert.throws 只在带匹配器时返回错误对象，这里统一自己捕获再断言消息，行为不随 Node 版本变化。
function errorOf(action) {
  try {
    action();
  } catch (error) {
    assert.equal(error instanceof Error, true, '抛出的不是 Error 实例：' + String(error));
    return error;
  }
  assert.fail('预期抛错但没有抛');
}

test('三个工具声明符合契约', () => {
  const expected = [
    [base64, 'base64', 'Base64'],
    [url, 'url', 'URL 编解码'],
    [jwt, 'jwt', 'JWT 解码']
  ];
  expected.forEach(([tool, id, title]) => {
    assert.equal(tool.id, id);
    assert.equal(tool.group, 'codec');
    assert.equal(tool.title, title);
    assert.equal(typeof tool.desc, 'string');
    assert.equal(typeof tool.mount, 'function');
  });
});

test('api 暴露约定的函数', () => {
  assert.deepEqual(Object.keys(base64.api).sort(), ['decodeText', 'encodeText']);
  assert.deepEqual(Object.keys(url.api).sort(),
    ['buildQuery', 'decodeComponent', 'decodeFull', 'encodeComponent', 'encodeFull', 'parseQuery', 'parseUrl']);
  assert.ok(jwt.api.decode && typeof jwt.api.decode === 'function');
});

/* ---------------- Base64 ---------------- */

test('中文与 emoji 的 Base64 往返一致', () => {
  const samples = ['你好，世界', '中', 'emoji：😀🚀', '日本語と한국어', '混合 mixed 123 中文 😀🚀\n第二行\t制表符'];
  samples.forEach((text) => {
    assert.equal(base64.api.decodeText(base64.api.encodeText(text, false), false), text);
  });
});

test('已知的 UTF-8 Base64 结果与标准一致', () => {
  assert.equal(base64.api.encodeText('中', false), '5Lit');
  assert.equal(base64.api.encodeText('hello', false), 'aGVsbG8=');
  assert.equal(base64.api.encodeText('😀', false), '8J+YgA==');
  assert.equal(base64.api.decodeText('5Lit', false), '中');
});

test('URL-safe 往返并去掉 = 填充', () => {
  const text = '中文 with ~~?? binary-ish';
  const encoded = base64.api.encodeText(text, true);
  assert.equal(encoded.includes('+'), false);
  assert.equal(encoded.includes('/'), false);
  assert.equal(encoded.includes('='), false);
  assert.equal(base64.api.decodeText(encoded, true), text);
  // 同一字节的两种字母表只差 +/ 与 -_ 的映射
  assert.equal(base64.api.encodeText('\u00ff\u00fe', true), base64.api.encodeText('\u00ff\u00fe', false).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  assert.equal(base64.api.decodeText('5Lit', true), '中');
});

test('URL-safe 输入容忍带填充与不带填充两种写法', () => {
  assert.equal(base64.api.decodeText('8J-YgA', true), '😀');
  assert.equal(base64.api.decodeText('8J-YgA==', true), '😀');
  assert.equal(base64.api.decodeText('8J-YgA===', true), '😀');
});

test('输入允许含空白与换行', () => {
  assert.equal(base64.api.decodeText('  5L it\n', false), '中');
  assert.equal(base64.api.decodeText('5L\nit\r\n', false), '中');
  assert.equal(base64.api.decodeText('\t5Lit ', false), '中');
});

test('非法 Base64 必须抛错而不是返回空串', () => {
  const bad = ['!!!!', '....', '5Lit$', 'abcde', 'a', '=', '====', 'aGVsbG8*', '中', '5Lit=5Lit'];
  bad.forEach((input) => {
    assert.throws(() => base64.api.decodeText(input, false), Error, '未抛错：' + input);
  });
});

test('错误提示是中文且说清原因', () => {
  assert.match(errorOf(() => base64.api.decodeText('!!!!', false)).message, /不是合法的 Base64/);
  assert.match(errorOf(() => base64.api.decodeText('abcde', false)).message, /长度不合法/);
  assert.match(errorOf(() => base64.api.decodeText('abcd===', false)).message, /填充/);
  assert.match(errorOf(() => base64.api.decodeText('   ', false)).message, /输入为空/);
  assert.match(errorOf(() => base64.api.decodeText('!!!!', true)).message, /不是合法的 Base64URL/);
  assert.match(errorOf(() => base64.api.decodeText('abcde', true)).message, /长度不合法/);
  assert.match(errorOf(() => base64.api.decodeText('中', false)).message, /字母表之外的字符/);
});

test('非法 UTF-8 字节抛错而不是替换成 U+FFFD', () => {
  // 0xFF 不是任何 UTF-8 序列的首字节；0xC3 后面缺少续字节。
  const invalid = Buffer.from([0xff, 0xfe]).toString('base64');
  const truncated = Buffer.from([0xE4, 0xB8]).toString('base64');
  assert.match(errorOf(() => base64.api.decodeText(invalid, false)).message, /UTF-8/);
  assert.match(errorOf(() => base64.api.decodeText(truncated, false)).message, /UTF-8/);
});

test('大输入分块编解码不炸栈', () => {
  const big = '中'.repeat(20000);
  const encoded = base64.api.encodeText(big, false);
  assert.equal(base64.api.decodeText(encoded, false), big);
});

/* ---------------- URL ---------------- */

test('四种 URI 编解码函数行为符合标准', () => {
  assert.equal(url.api.encodeComponent('a b&c=d/e?f#g'), 'a%20b%26c%3Dd%2Fe%3Ff%23g');
  assert.equal(url.api.decodeComponent('a%20b%26c%3Dd%2Fe%3Ff%23g'), 'a b&c=d/e?f#g');
  assert.equal(url.api.encodeFull('a b&c=d'), 'a%20b&c=d');
  assert.equal(url.api.decodeFull('a%20b&c=d'), 'a b&c=d');
  assert.equal(url.api.encodeComponent('中文😀'), '%E4%B8%AD%E6%96%87%F0%9F%98%80');
  assert.equal(url.api.decodeComponent('%E4%B8%AD%E6%96%87%F0%9F%98%80'), '中文😀');
  // encodeURI 保留 : / ? # & = 等保留字符，但空格与非 ASCII 一样要转义。
  const full = 'https' + '://例子.测试/路径 a?q=中 文';
  assert.equal(url.api.encodeFull(full), 'https' + '://%E4%BE%8B%E5%AD%90.%E6%B5%8B%E8%AF%95/%E8%B7%AF%E5%BE%84%20a?q=%E4%B8%AD%20%E6%96%87');
  assert.equal(url.api.encodeComponent(full), 'https%3A%2F%2F%E4%BE%8B%E5%AD%90.%E6%B5%8B%E8%AF%95%2F%E8%B7%AF%E5%BE%84%20a%3Fq%3D%E4%B8%AD%20%E6%96%87');
  assert.equal(url.api.decodeFull(url.api.encodeFull(full)), full);
});

test('解码非法转义抛中文错误', () => {
  assert.match(errorOf(() => url.api.decodeComponent('%E4%B8')).message, /解码失败/);
  assert.match(errorOf(() => url.api.decodeFull('%zz')).message, /解码失败/);
  assert.match(errorOf(() => url.api.decodeComponent('%')).message, /解码失败/);
});

test('解析完整 URL 的各个部件', () => {
  const info = url.api.parseUrl('https' + '://user:pw@例子.测试:8443/a/b%20c?x=1&y=%E4%B8%AD&y=2#片段一');
  assert.equal(info.protocol, 'https');
  assert.equal(info.username, 'user');
  assert.equal(info.password, 'pw');
  // 解析器按标准把中文主机名转成 punycode，原始写法单独给出。
  assert.equal(info.hostname, 'xn--fsqu00a.xn--0zwm56d');
  assert.equal(info.unicodeHostname, '例子.测试');
  assert.equal(info.port, '8443');
  assert.equal(info.host, 'xn--fsqu00a.xn--0zwm56d:8443');
  assert.equal(info.path, '/a/b%20c');
  assert.equal(info.query, 'x=1&y=%E4%B8%AD&y=2');
  // 片段里的非 ASCII 由解析器标准化为百分号转义，取回原文需再解码一次。
  assert.equal(info.hash, '%E7%89%87%E6%AE%B5%E4%B8%80');
  assert.equal(url.api.decodeComponent(info.hash), '片段一');
  assert.deepEqual(info.pairs, [
    { key: 'x', value: '1' },
    { key: 'y', value: '中' },
    { key: 'y', value: '2' }
  ]);
});

test('未写端口时 port 为空且路径以 / 开头', () => {
  const info = url.api.parseUrl('https' + '://example.com');
  assert.equal(info.port, '');
  assert.equal(info.path, '/');
  assert.equal(info.host, 'example.com');
  assert.equal(info.hash, '');
  assert.deepEqual(info.pairs, []);
});

test('解析失败给中文错误', () => {
  assert.match(errorOf(() => url.api.parseUrl('')).message, /请输入/);
  assert.match(errorOf(() => url.api.parseUrl('example.com/a')).message, /不是合法的绝对 URL/);
  assert.match(errorOf(() => url.api.parseUrl('   ')).message, /请输入/);
  assert.match(errorOf(() => url.api.parseUrl('随便一段文字')).message, /不是合法的绝对 URL/);
  assert.equal(url.api.parseUrl('https' + '://example.com:8080/x').unicodeHostname, 'example.com');
  assert.equal(url.api.parseUrl('https' + '://u:p@例子.测试:8443/x').unicodeHostname, '例子.测试');
});

test('查询串与参数表双向转换', () => {
  const pairs = url.api.parseQuery('?a=1&b=%E4%B8%AD%E6%96%87&c=a+b&d=');
  assert.deepEqual(pairs, [
    { key: 'a', value: '1' },
    { key: 'b', value: '中文' },
    { key: 'c', value: 'a b' },
    { key: 'd', value: '' }
  ]);
  assert.equal(url.api.buildQuery(pairs), 'a=1&b=%E4%B8%AD%E6%96%87&c=a+b&d=');
  // 往返：拼出来再解回来必须等价
  assert.deepEqual(url.api.parseQuery(url.api.buildQuery(pairs)), pairs);
});

test('查询串解析失败给中文错误', () => {
  assert.match(errorOf(() => url.api.parseQuery('')).message, /查询串是空的/);
  assert.match(errorOf(() => url.api.parseQuery('?')).message, /查询串是空的/);
});

test('参数表支持键值对对象与 [key, value] 数组', () => {
  assert.equal(url.api.buildQuery([{ key: 'a b', value: 'c&d' }]), 'a+b=c%26d');
  assert.equal(url.api.buildQuery([['a', '1'], ['b', '2']]), 'a=1&b=2');
  assert.equal(url.api.buildQuery([]), '');
});

/* ---------------- JWT ---------------- */

// 手写固定令牌，避免测试依赖任何外部数据。
const b64url = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const headerJson = '{"alg":"HS256","typ":"JWT"}';
const payloadJson = JSON.stringify({ sub: '1234567890', name: '张三', iat: now - 120, nbf: now - 60, exp: now + 3600 });
const token = b64url(headerJson) + '.' + b64url(payloadJson) + '.c2lnbmF0dXJlLXN0dWI=';

test('JWT 解码出 header / payload 与签名段', () => {
  const result = jwt.api.decode(token);
  assert.deepEqual(result.header, { alg: 'HS256', typ: 'JWT' });
  assert.equal(result.payload.name, '张三');
  assert.equal(result.payload.sub, '1234567890');
  assert.equal(result.signature, 'c2lnbmF0dXJlLXN0dWI=');
  assert.equal(result.timestamps.exp, now + 3600);
  assert.equal(result.expired, false);
});

test('过期判定与剩余时间', () => {
  const expiredToken = b64url(headerJson) + '.' + b64url(JSON.stringify({ exp: now - 3600 })) + '.x';
  const expired = jwt.api.decode(expiredToken);
  assert.equal(expired.expired, true);
  assert.equal(expired.timestamps.exp, now - 3600);

  const futureToken = b64url(headerJson) + '.' + b64url(JSON.stringify({ exp: now + 60 })) + '.x';
  assert.equal(jwt.api.decode(futureToken).expired, false);

  // 刚好等于当前秒视为已过期；边界用显式 now 钉死
  const edge = b64url(headerJson) + '.' + b64url(JSON.stringify({ exp: 1000 })) + '.x';
  assert.equal(jwt.api.decode(edge, 1000).expired, true);
  assert.equal(jwt.api.decode(edge, 999).expired, false);
});

test('没有 exp 时不判定过期', () => {
  const noExp = b64url(headerJson) + '.' + b64url(JSON.stringify({ sub: 'a' })) + '.x';
  const result = jwt.api.decode(noExp);
  assert.equal(result.timestamps.exp, null);
  assert.equal(result.expired, false);
  assert.equal(result.timestamps.iat, null);
});

test('时间戳格式化与相对时长文案', () => {
  assert.equal(jwt.api.formatLocal(0).length, 19);
  assert.match(jwt.api.formatLocal(now), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(jwt.api.formatDuration(0), '不足 1 秒');
  assert.equal(jwt.api.formatDuration(59), '59秒');
  assert.equal(jwt.api.formatDuration(3600), '1小时');
  assert.equal(jwt.api.formatDuration(3661), '1小时 1分钟');
  assert.equal(jwt.api.formatDuration(90061), '1天 1小时');
});

test('时间声明汇总行标出是否过期与还有多久', () => {
  const result = jwt.api.decode(token, now);
  const rows = jwt.api.timestampRows(result, now);
  const exp = rows.find((row) => row.key === 'exp');
  assert.match(exp.state, /还有 1小时/);
  assert.equal(exp.raw, String(now + 3600));
  const expiredToken = b64url(headerJson) + '.' + b64url(JSON.stringify({ exp: now - 7200 })) + '.x';
  const expiredRow = jwt.api.timestampRows(jwt.api.decode(expiredToken, now), now).find((row) => row.key === 'exp');
  assert.match(expiredRow.state, /已过期/);
  assert.match(expiredRow.state, /2小时/);
});

test('段数不对、段落非法都给中文错误', () => {
  assert.match(errorOf(() => jwt.api.decode('')).message, /请输入 JWT/);
  assert.match(errorOf(() => jwt.api.decode('a.b')).message, /三段/);
  assert.match(errorOf(() => jwt.api.decode('a.b.c.d')).message, /三段/);
  assert.match(errorOf(() => jwt.api.decode('@@@.' + b64url(headerJson) + '.x')).message, /Base64URL/);
  assert.match(errorOf(() => jwt.api.decode(b64url('not json') + '.' + b64url(payloadJson) + '.x')).message, /header 段不是合法的 JSON/);
  assert.match(errorOf(() => jwt.api.decode(b64url(headerJson) + '.' + b64url('"字符串"') + '.x')).message, /JSON 对象/);
  assert.match(errorOf(() => jwt.api.decode(b64url(headerJson) + '.x.y')).message, /payload/);
  assert.match(errorOf(() => jwt.api.decode('.x.y')).message, /header 段是空的/);
  assert.match(errorOf(() => jwt.api.decode(b64url('{"a":1}') + '.' + b64url('{broken') + '.x')).message, /payload 段不是合法的 JSON/);
});

test('签名为空（alg=none）不报错但签名段为空串', () => {
  const noneToken = b64url(headerJson) + '.' + b64url(payloadJson) + '.';
  assert.equal(jwt.api.decode(noneToken).signature, '');
});

test('解码结果包含格式化所需的原始对象', () => {
  const result = jwt.api.decode(token);
  assert.equal(JSON.stringify(result.payload, null, 2).includes('\n  "name"'), true);
  assert.equal(result.segments.signature, 'c2lnbmF0dXJlLXN0dWI=');
});
