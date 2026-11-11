import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTool } from '../scripts/test-loader.mjs';

const { tool } = loadTool('src/tools/01-json.js');
const api = tool.api;

test('工具声明符合契约', () => {
  assert.equal(tool.id, 'json');
  assert.equal(tool.group, 'codec');
  assert.equal(typeof tool.mount, 'function');
  assert.equal(typeof tool.desc, 'string');
});

test('format 按所选缩进重建', () => {
  assert.equal(api.format('{"a":1,"b":[2,3]}', '2'), '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  assert.equal(api.format('{"a":1}', '4'), '{\n    "a": 1\n}');
  assert.equal(api.format('{"a":1}', 'tab'), '{\n\t"a": 1\n}');
});

test('minify 去掉所有空白', () => {
  assert.equal(api.minify('{\n  "a": [1, 2],\n  "b": "x y"\n}'), '{"a":[1,2],"b":"x y"}');
});

test('sortKeys 递归排序对象键但保持数组顺序', () => {
  const expected = '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1,\n  "list": [\n    3,\n    1,\n    2\n  ]\n}';
  assert.equal(api.sortKeys('{"b":1,"a":{"d":2,"c":3},"list":[3,1,2]}', '2'), expected);
});

test('转义与去转义往返（含中文、引号、换行）', () => {
  const text = '第一行\n第二行 "带引号" \\ 反斜杠';
  const escaped = api.escape(text);
  assert.equal(escaped.charAt(0), '"');
  assert.equal(api.unescape(escaped), text);
});

test('去转义同时接受带引号字面量与裸转义文本', () => {
  assert.equal(api.unescape('a\\nb'), 'a\nb');
  assert.equal(api.unescape('"a\\tb"'), 'a\tb');
  assert.equal(api.unescape('"\\u4e2d"'), '中');
  assert.equal(api.unescape('{"x":1}'), '{"x":1}');
  assert.equal(api.unescape('普通文本'), '普通文本');
});

test('校验非法 JSON 报出准确行列与中文原因', () => {
  const result = api.validate('{\n  "a": 1,\n  "b": }\n}');
  assert.equal(result.ok, false);
  assert.equal(result.line, 3);
  assert.equal(result.column, 8);
  assert.match(result.message, /无法识别/);
});

test('校验能区分常见错误类型', () => {
  assert.match(api.validate('{"a":1,}').message, /键必须是双引号/);
  assert.match(api.validate("{'a':1}").message, /键必须是双引号/);
  assert.match(api.validate('{"a" 1}').message, /缺少冒号/);
  assert.match(api.validate('[1 2]').message, /期望逗号/);
  assert.match(api.validate('01').message, /多余字符|数字格式/);
  assert.match(api.validate('').message, /意外结束/);
  assert.match(api.validate('{"a":1}}').message, /多余字符/);
});

test('校验合法 JSON 返回 ok', () => {
  assert.equal(api.validate('{"a":1}').ok, true);
  assert.equal(api.validate('  [1, -2.5e3, "\u4e2d", null, true]  ').ok, true);
});

test('自研扫描器与 JSON.parse 在样本上判定一致', () => {
  const samples = [
    '{}', '[]', '1', '-1.5e10', '"a"', 'null', 'true', '{"a":[1,2,{}]}', '"\\u4e2d"', '  {"a":1}  ',
    '', '{', '[1,]', '{"a":1,}', "{'a':1}", '01', '1.', '.5', '+1', 'NaN', 'tru', '"a', '"\\x"', '1 2',
    '{"a" 1}', '[1 2]', '{"a":1}}', '"a\nb"', '{"a":01}', '[01]', '-', '{"a":}', 'undefined'
  ];
  samples.forEach((sample) => {
    let engineOk = true;
    try { JSON.parse(sample); } catch (error) { engineOk = false; }
    assert.equal(api.scan(sample).ok, engineOk, '判定不一致的样本：' + JSON.stringify(sample));
  });
});

test('格式错误时抛出而不是吞掉', () => {
  assert.throws(() => api.format('{bad}', '2'));
  assert.throws(() => api.minify('not json'));
});
