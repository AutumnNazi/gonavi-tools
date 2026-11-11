/* 文本统计：字符数、UTF-8 字节数、行数、非空行数、词数、中文字符数、最长行长度。
   一切按 Unicode 代码点计数：代理对（emoji、扩展区汉字）算一个字符；
   汉字只认 CJK 统一表意文字及其扩展/兼容区，所以 emoji 永远不会被算成汉字。 */
(function (GN) {
  'use strict';

  // CJK 统一表意文字：扩展 A、基本区、兼容汉字，以及扩展 B 之后的补充平面。
  var CJK_RANGES = [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff], [0x20000, 0x2fa1f]];

  // 行以 CRLF / LF / CR 分隔；末尾换行只是行终止符，不再额外算一个空行。
  function toLines(text) {
    var source = String(text);
    if (source === '') { return []; }
    var parts = source.split(/\r\n|\r|\n/);
    if (parts.length > 1 && parts[parts.length - 1] === '') { parts.pop(); }
    return parts;
  }

  function isChinese(code) {
    for (var i = 0; i < CJK_RANGES.length; i++) {
      if (code >= CJK_RANGES[i][0] && code <= CJK_RANGES[i][1]) { return true; }
    }
    return false;
  }

  // 与 UTF-8 编码规则一致：孤立代理项按 U+FFFD 的 3 字节算，和 TextEncoder 结果相同。
  function utf8Size(code) {
    if (code <= 0x7f) { return 1; }
    if (code <= 0x7ff) { return 2; }
    if (code <= 0xffff) { return 3; }
    return 4;
  }

  function countCodePoints(text) {
    var count = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        var low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) { i++; }
      }
      count++;
    }
    return count;
  }

  function scan(text) {
    var chars = 0;
    var bytes = 0;
    var chinese = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.codePointAt(i);
      if (code > 0xffff) { i++; }
      chars++;
      bytes += utf8Size(code);
      if (isChinese(code)) { chinese++; }
    }
    return { chars: chars, bytes: bytes, chinese: chinese };
  }

  function stats(text) {
    var source = text === undefined || text === null ? '' : String(text);
    var counted = scan(source);
    var lines = toLines(source);
    var nonEmptyLines = 0;
    var longestLine = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') { nonEmptyLines++; }
      var width = countCodePoints(lines[i]);
      if (width > longestLine) { longestLine = width; }
    }
    var words = source.split(/\s+/).filter(function (token) { return token !== ''; }).length;
    return {
      chars: counted.chars,
      bytes: counted.bytes,
      lines: lines.length,
      nonEmptyLines: nonEmptyLines,
      words: words,
      chinese: counted.chinese,
      longestLine: longestLine
    };
  }

  GN.register({
    id: 'text-stat',
    group: 'text',
    title: '文本统计',
    desc: '字符 / 字节 / 行 / 词 / 汉字 / 最长行',
    api: {
      stats: stats
    },
    mount: function (root) {
      var ui = GN.ui;
      var input = ui.textarea({ placeholder: '粘贴或输入文本，统计会实时更新…', tall: true, oninput: refresh });
      var message = ui.msg();
      var tableBox = ui.el('div');
      var summary = '';

      var COLUMNS = [
        { key: 'name', title: '指标' },
        { key: 'value', title: '数值' }
      ];

      function rowsOf(result) {
        return [
          { name: '字符数（按代码点）', value: String(result.chars) },
          { name: 'UTF-8 字节数', value: String(result.bytes) },
          { name: '行数', value: String(result.lines) },
          { name: '非空行数', value: String(result.nonEmptyLines) },
          { name: '词数', value: String(result.words) },
          { name: '中文字符数', value: String(result.chinese) },
          { name: '最长行长度', value: String(result.longestLine) }
        ];
      }

      function refresh() {
        var result = stats(input.value);
        summary = '字符 ' + result.chars + ' / 字节 ' + result.bytes + ' / 行 ' + result.lines +
          ' / 非空行 ' + result.nonEmptyLines + ' / 词 ' + result.words +
          ' / 汉字 ' + result.chinese + ' / 最长行 ' + result.longestLine;
        tableBox.textContent = '';
        tableBox.appendChild(ui.table(COLUMNS, rowsOf(result)));
        message.clear();
        GN.util.status('文本统计 · ' + summary);
      }

      root.appendChild(input);
      root.appendChild(ui.row(
        ui.copyButton(function () { return summary; }, '复制统计结果'),
        ui.spacer()
      ));
      root.appendChild(message);
      root.appendChild(tableBox);
      root.appendChild(ui.hint('字符按 Unicode 代码点计（emoji 记 1 个）；字节按 UTF-8；行按 CRLF / LF / CR 分隔。'))

      refresh();
    }
  });
})(GN);
