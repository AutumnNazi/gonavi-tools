import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGN, loadTool } from '../scripts/test-loader.mjs';

const diffLib = loadGN(['src/lib/diff.js']).lib.diff;
const regex = loadTool('src/tools/09-regex.js').tool;
const stat = loadTool('src/tools/10-text-stat.js').tool;
const textDiff = loadTool('src/tools/11-text-diff.js', ['src/lib/diff.js']).tool;
const lines = loadTool('src/tools/12-text-lines.js').tool;

const SOURCES = [
  'src/lib/diff.js',
  'src/tools/09-regex.js',
  'src/tools/10-text-stat.js',
  'src/tools/11-text-diff.js',
  'src/tools/12-text-lines.js'
];

function readSource(file) {
  return fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
}

test('四个工具都符合注册契约', () => {
  const cases = [
    [regex, 'regex', '正则测试'],
    [stat, 'text-stat', '文本统计'],
    [textDiff, 'text-diff', '文本对比'],
    [lines, 'text-lines', '行处理']
  ];
  cases.forEach(([tool, id, title]) => {
    assert.equal(tool.id, id);
    assert.equal(tool.group, 'text');
    assert.equal(tool.title, title);
    assert.equal(typeof tool.mount, 'function');
    assert.equal(typeof tool.api, 'object');
    assert.ok(typeof tool.desc === 'string' && tool.desc.length > 0, id + ' 缺少 desc');
  });
});

test('模块以 IIFE 注册，且顶层不触碰 DOM（加载本身即验证）', () => {
  SOURCES.forEach((file) => {
    const source = readSource(file);
    assert.match(source, /\(function \(GN\) \{/, file + ' 不是 (function (GN) {...})(GN) 形式');
    assert.match(source, /'use strict';/, file + ' 缺少严格模式');
    assert.ok(source.trimEnd().endsWith('})(GN);'), file + ' 结尾不是 })(GN);');
  });
  assert.match(readSource('src/tools/09-regex.js'), /GN\.register\(\{/);
  assert.match(readSource('src/lib/diff.js'), /GN\.lib\.diff = \{/);
});

test('源码不含硬约束禁止的字面量，也不使用 innerHTML', () => {
  const forbidden = [
    /https?:\/\//, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/,
    /sessionStorage/, /document\.cookie/, /importScripts/, /@import/, /crypto\.subtle/
  ];
  SOURCES.forEach((file) => {
    const source = readSource(file);
    forbidden.forEach((pattern) => {
      assert.equal(pattern.test(source), false, file + ' 命中被禁止的字面量：' + pattern);
    });
    assert.equal(/\.innerHTML/.test(source), false, file + ' 通过 innerHTML 拼装内容');
  });
});

/* ---------------- lib/diff ---------------- */

test('行级 diff 判定新增、删除与相同', () => {
  assert.deepEqual(diffLib.diffLines('a\nb\nc', 'a\nx\nc'), [
    { type: 'same', text: 'a' },
    { type: 'del', text: 'b' },
    { type: 'add', text: 'x' },
    { type: 'same', text: 'c' }
  ]);
  assert.deepEqual(diffLib.diffLines('同一行\n另一行', '同一行\n改了'), [
    { type: 'same', text: '同一行' },
    { type: 'del', text: '另一行' },
    { type: 'add', text: '改了' }
  ]);
});

test('diff 的空输入与尾部换行边界', () => {
  assert.deepEqual(diffLib.diffLines('', ''), []);
  assert.deepEqual(diffLib.diffLines(undefined, null), []);
  assert.deepEqual(diffLib.diffLines('', 'a'), [{ type: 'add', text: 'a' }]);
  assert.deepEqual(diffLib.diffLines('a', ''), [{ type: 'del', text: 'a' }]);
  assert.deepEqual(diffLib.diffLines('a\n', 'a'), [{ type: 'same', text: 'a' }]);
  assert.deepEqual(diffLib.diffLines('a\n', 'a\n'), [{ type: 'same', text: 'a' }]);
  assert.deepEqual(diffLib.diffLines('\n', ''), [{ type: 'del', text: '' }]);
});

test('diff 把 CRLF 与 LF 视为同一行内容', () => {
  assert.deepEqual(diffLib.diffLines('a\r\nb', 'a\nb'), [
    { type: 'same', text: 'a' },
    { type: 'same', text: 'b' }
  ]);
  assert.deepEqual(diffLib.splitLines('a\r\nb\r\n'), ['a', 'b']);
  assert.deepEqual(diffLib.splitLines(''), []);
});

test('diff 接受行数组，同分行数不依赖具体的对齐选择', () => {
  assert.deepEqual(diffLib.diffLines(['x'], []), [{ type: 'del', text: 'x' }]);
  assert.deepEqual(diffLib.diffLines([], ['x']), [{ type: 'add', text: 'x' }]);
  const rows = diffLib.diffLines(['a', 'b'], ['b', 'a']);
  const count = (type) => rows.filter((row) => row.type === type).length;
  assert.equal(count('same'), 1);
  assert.equal(count('del'), 1);
  assert.equal(count('add'), 1);
});

test('diff 的删增顺序稳定，重复行按最长公共子序列处理', () => {
  assert.deepEqual(diffLib.diffLines('a\na\na', 'a\na'), [
    { type: 'same', text: 'a' },
    { type: 'same', text: 'a' },
    { type: 'del', text: 'a' }
  ]);
  const rows = diffLib.diffLines('x\ny', 'y\nx');
  const types = rows.map((row) => row.type).join(',');
  assert.ok(types === 'del,same,add' || types === 'add,same,del', types);
});

test('大输入走退化路径，仍然快速返回合法的差量序列', () => {
  const left = Array.from({ length: 2500 }, (_, i) => 'L' + i);
  const right = Array.from({ length: 2500 }, (_, i) => 'R' + i);
  const started = Date.now();
  const detailed = diffLib.diffLinesDetailed(left, right);
  const elapsed = Date.now() - started;
  assert.equal(detailed.degraded, true);
  assert.equal(detailed.rows.length, 5000);
  assert.equal(detailed.rows.filter((row) => row.type === 'del').length, 2500);
  assert.equal(detailed.rows.filter((row) => row.type === 'add').length, 2500);
  assert.ok(elapsed < 2000, '退化路径耗时 ' + elapsed + 'ms');
});

test('大文本只改一行时靠公共前后缀剪枝，仍走精确 DP', () => {
  const left = Array.from({ length: 5000 }, (_, i) => 'line ' + i);
  const right = left.slice();
  right[2000] = 'CHANGED';
  const detailed = diffLib.diffLinesDetailed(left, right);
  assert.equal(detailed.degraded, false);
  assert.equal(detailed.rows.length, 5001);
  assert.equal(detailed.rows.filter((row) => row.type === 'del').length, 1);
  assert.equal(detailed.rows.filter((row) => row.type === 'add').length, 1);
  assert.equal(detailed.rows[2001].text, 'CHANGED');
});

/* ---------------- 09 正则测试 ---------------- */

test('零宽匹配手动推进 lastIndex，不会死循环且位置正确', () => {
  assert.deepEqual(regex.api.findMatches('a*', 'g', 'baab'), [
    { index: 0, match: '', groups: [] },
    { index: 1, match: 'aa', groups: [] },
    { index: 3, match: '', groups: [] },
    { index: 4, match: '', groups: [] }
  ]);
  assert.deepEqual(regex.api.findMatches('', 'g', 'ab').map((m) => m.index), [0, 1, 2]);
  assert.deepEqual(regex.api.findMatches('^', 'gm', 'a\nb').map((m) => m.index), [0, 2]);
  assert.deepEqual(regex.api.findMatches('(?=b)', 'g', 'abcb').map((m) => m.index), [1, 3]);
  assert.deepEqual(regex.api.findMatches('x*', 'g', '').map((m) => m.index), [0]);
});

test('捕获分组按顺序返回，未参与匹配的分组为空串', () => {
  const found = regex.api.findMatches('(\\d+)-(\\d+)', 'g', '10-20 30-40');
  assert.equal(found.length, 2);
  assert.deepEqual(found[0], { index: 0, match: '10-20', groups: ['10', '20'] });
  assert.deepEqual(found[1].groups, ['30', '40']);
  assert.deepEqual(regex.api.findMatches('(a)|(b)', 'g', 'ab').map((m) => m.groups), [['a', ''], ['', 'b']]);
  assert.deepEqual(regex.api.findMatches('(a)(b)?', 'g', 'a').map((m) => m.groups), [['a', '']]);
});

test('查找按 flags 行事：未勾选 g 只返回第一处', () => {
  assert.equal(regex.api.findMatches('a', '', 'aaa').length, 1);
  assert.equal(regex.api.findMatches('A', 'i', 'aA').length, 1);
  assert.deepEqual(regex.api.findMatches('B', 'i', 'aBc').map((m) => m.index), [1]);
  assert.equal(regex.api.findMatches('[\\u{1F600}]', 'gu', '😀').length, 1);
  assert.deepEqual(regex.api.findMatches('b.c', 's', 'b\nc').map((m) => m.match), ['b\nc']);
});

test('替换支持 $1 / $& / $$ 等引用，且始终替换全部匹配', () => {
  assert.equal(regex.api.replaceAll('(\\w+)@(\\w+)', 'g', 'a@b c@d', '$2:$1'), 'b:a d:c');
  assert.equal(regex.api.replaceAll('a', '', 'aaa', '-'), '---');
  assert.equal(regex.api.replaceAll('(a)(b)', 'g', 'ab', '$&|$1|$2'), 'ab|a|b');
  assert.equal(regex.api.replaceAll('x', 'g', 'x', '$$'), '$');
  assert.equal(regex.api.replaceAll('(a)', 'g', 'a a', ''), ' ');
  assert.equal(regex.api.replaceAll('a*', 'g', 'baab', '-'), '-b--b-');
});

test('非法正则与非法 flags 抛中文错误', () => {
  assert.throws(() => regex.api.findMatches('(', 'g', 'x'), /非法正则/);
  assert.throws(() => regex.api.findMatches('[a-', 'g', 'x'), /非法正则/);
  assert.throws(() => regex.api.findMatches('a', 'x', 'x'), /非法 flags/);
  assert.throws(() => regex.api.findMatches('a', 'gg', 'x'), /非法 flags/);
  assert.throws(() => regex.api.replaceAll('a', 'q', 'x', 'y'), /非法 flags/);
});

test('高亮片段能无损还原原文，并标出零宽匹配', () => {
  const source = 'baab';
  const parts = regex.api.segments(source, regex.api.findMatches('a*', 'g', source));
  assert.equal(parts.map((part) => part.text).join(''), source);
  assert.equal(parts.filter((part) => part.zero).length, 3);
  assert.equal(parts.filter((part) => part.mark && !part.zero).map((part) => part.text).join(''), 'aa');
  assert.equal(parts.filter((part) => !part.mark).map((part) => part.text).join(''), 'bb');
  assert.deepEqual(regex.api.segments('abc', []), [{ index: 0, text: 'abc', mark: false, zero: false }]);
  assert.deepEqual(regex.api.segments('', []), []);
});

/* ---------------- 10 文本统计 ---------------- */

test('空输入与纯空白输入的口径', () => {
  assert.deepEqual(stat.api.stats(''), {
    chars: 0, bytes: 0, lines: 0, nonEmptyLines: 0, words: 0, chinese: 0, longestLine: 0
  });
  assert.deepEqual(stat.api.stats(undefined), stat.api.stats(''));
  const blank = stat.api.stats('   ');
  assert.equal(blank.lines, 1);
  assert.equal(blank.nonEmptyLines, 0);
  assert.equal(blank.words, 0);
  assert.equal(blank.chars, 3);
  assert.equal(blank.longestLine, 3);
});

test('统计中文字符：emoji 与标点都不算汉字', () => {
  const mixed = stat.api.stats('中文😀\nabc');
  assert.equal(mixed.chars, 7);
  assert.equal(mixed.bytes, 14);
  assert.equal(mixed.lines, 2);
  assert.equal(mixed.nonEmptyLines, 2);
  assert.equal(mixed.words, 2);
  assert.equal(mixed.chinese, 2);
  assert.equal(mixed.longestLine, 3);

  const emoji = stat.api.stats('😀');
  assert.equal(emoji.chars, 1);
  assert.equal(emoji.bytes, 4);
  assert.equal(emoji.chinese, 0);

  assert.equal(stat.api.stats('，。！？').chinese, 0);
  assert.equal(stat.api.stats('㐀').chinese, 1);          // 扩展 A
  assert.equal(stat.api.stats('\u{20000}').chinese, 1);   // 扩展 B（代理对，必须算 1 个字符）
  assert.equal(stat.api.stats('\u{20000}').chars, 1);
  assert.equal(stat.api.stats('\u{20000}').bytes, 4);
  assert.equal(stat.api.stats('abc').chinese, 0);
});

test('统计 CRLF 与行数口径', () => {
  const crlf = stat.api.stats('a\r\nb\r\n');
  assert.equal(crlf.lines, 2);
  assert.equal(crlf.nonEmptyLines, 2);
  assert.equal(crlf.chars, 6);
  assert.equal(crlf.bytes, 6);
  assert.equal(crlf.longestLine, 1);

  const mixedBreak = stat.api.stats('a\rb\nc');
  assert.equal(mixedBreak.lines, 3);
  assert.equal(mixedBreak.longestLine, 1);

  const gaps = stat.api.stats('a\n\n  \nb');
  assert.equal(gaps.lines, 4);
  assert.equal(gaps.nonEmptyLines, 2);
  assert.equal(stat.api.stats('a\nbb\nccc').longestLine, 3);
});

/* ---------------- 11 文本对比 ---------------- */

test('文本对比统计新增、删除与相同行数', () => {
  const rows = textDiff.api.diff('a\nb\nc', 'a\nx\nc');
  assert.deepEqual(textDiff.api.summarize(rows), { same: 2, add: 1, del: 1, total: 4 });
  assert.deepEqual(textDiff.api.summarize([]), { same: 0, add: 0, del: 0, total: 0 });
  assert.deepEqual(textDiff.api.summarize(textDiff.api.diff('', '')), { same: 0, add: 0, del: 0, total: 0 });
  assert.deepEqual(textDiff.api.summarize(textDiff.api.diff('', 'a\nb')), { same: 0, add: 2, del: 0, total: 2 });
});

test('渲染截断给出省略行数', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ type: 'same', text: String(i) }));
  const limited = textDiff.api.preview(rows, 4);
  assert.equal(limited.rows.length, 4);
  assert.equal(limited.omitted, 6);
  assert.equal(textDiff.api.preview(rows).omitted, 0);
  assert.equal(textDiff.api.preview(rows).rows.length, 10);
  assert.deepEqual(textDiff.api.preview([], 4), { rows: [], omitted: 0 });
  assert.equal(textDiff.api.preview(rows, 0).rows.length, 10);
});

test('缺少 lib/diff.js 时给出可读的中文错误', () => {
  const lonely = loadTool('src/tools/11-text-diff.js').tool;
  assert.throws(() => lonely.api.diff('a', 'b'), /缺少 lib\/diff\.js/);
});

/* ---------------- 12 行处理 ---------------- */

test('行处理：去重保留首次出现的顺序', () => {
  assert.deepEqual(lines.api.unique(['b', 'a', 'b', 'a', 'c']), ['b', 'a', 'c']);
  assert.deepEqual(lines.api.unique([]), []);
  assert.deepEqual(lines.api.unique('a\na\nb'), ['a', 'b']);
  assert.deepEqual(lines.api.unique(['', '', 'a', '']), ['', 'a']);
});

test('行处理：排序与反转', () => {
  assert.deepEqual(lines.api.sortLines(['b', 'c', 'a']), ['a', 'b', 'c']);
  assert.deepEqual(lines.api.sortLines(['b', 'c', 'a'], true), ['c', 'b', 'a']);
  assert.deepEqual(lines.api.sortLines([]), []);
  assert.deepEqual(lines.api.reverse(['a', 'b', 'c']), ['c', 'b', 'a']);
  assert.deepEqual(lines.api.reverse([]), []);
  assert.deepEqual(lines.api.reverse('a\nb'), ['b', 'a']);
});

test('行处理：每行 trim 与去空行', () => {
  assert.deepEqual(lines.api.trimLines(['  a ', '\tb', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(lines.api.trimLines([]), []);
  assert.deepEqual(lines.api.dropEmpty(['a', '', '   ', 'b']), ['a', 'b']);
  assert.deepEqual(lines.api.dropEmpty(['', '  ']), []);
  assert.deepEqual(lines.api.dropEmpty([]), []);
});

test('行处理：加前后缀与合并为一行', () => {
  assert.deepEqual(lines.api.addAffix(['a', 'b'], "'", "',"), ["'a',", "'b',"]);
  assert.deepEqual(lines.api.addAffix(['a'], '', ''), ['a']);
  assert.deepEqual(lines.api.addAffix([], 'x', 'y'), []);
  assert.deepEqual(lines.api.addAffix('a\nb', '> ', ''), ['> a', '> b']);
  assert.equal(lines.api.joinLines(['a', 'b'], ','), 'a,b');
  assert.equal(lines.api.joinLines(['a', 'b']), 'ab');
  assert.equal(lines.api.joinLines([], ','), '');
  assert.equal(lines.api.joinLines('a\nb', ' | '), 'a | b');
});

test('行处理：转 SQL IN 列表并转义单引号', () => {
  assert.deepEqual(lines.api.toInList(['a', 'b']), ["'a',", "'b',"]);
  assert.deepEqual(lines.api.toInList([" O'Brien "]), ["'O''Brien',"]);
  assert.deepEqual(lines.api.toInList([]), []);
  assert.deepEqual(lines.api.toInList('a\nb'), ["'a',", "'b',"]);
  assert.equal(lines.api.toInList(['a', 'b']).join('\n'), "'a',\n'b',");
});

test('行处理：每个 api 都不修改入参', () => {
  const input = ['b', 'a', 'a'];
  const snapshot = input.slice();
  lines.api.unique(input);
  lines.api.sortLines(input);
  lines.api.trimLines(input);
  lines.api.dropEmpty(input);
  lines.api.reverse(input);
  lines.api.addAffix(input, '> ');
  lines.api.joinLines(input, ',');
  lines.api.toInList(input);
  assert.deepEqual(input, snapshot);
});
