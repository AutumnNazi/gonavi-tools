/* 行级 diff：LCS 动态规划 + 大输入退化，纯逻辑，可直接在 Node 里单测。
   GN.lib.diff = { MAX_LINES, splitLines, diffLines, diffLinesDetailed }
   diffLines(a, b) → [{ type: 'same' | 'add' | 'del', text }]
   a、b 既可传原始文本（按 CRLF / LF / CR 拆行），也可传已经拆好的行数组。
   规模控制：先剪掉公共前后缀（真实场景的改动通常只占很小一段），剩余行数之和
   超过 MAX_LINES 时改用带前瞻窗口的贪心对齐；退化路径的输出仍是合法差量序列
   （同一位置先删后增），只是不再保证最小编辑距离，这样上万行也不会撑爆内存或卡死页面。 */
(function (GN) {
  'use strict';

  var MAX_LINES = 4000;
  var WINDOW = 64;

  function splitLines(text) {
    var source = String(text);
    if (source === '') { return []; }
    var parts = source.split(/\r\n|\r|\n/);
    // 末尾换行符只是行终止符，不再额外产生一个空行。
    if (parts.length > 1 && parts[parts.length - 1] === '') { parts.pop(); }
    return parts;
  }

  function toLines(value) {
    if (Array.isArray(value)) {
      return value.map(function (line) { return String(line); });
    }
    return splitLines(value === undefined || value === null ? '' : value);
  }

  function commonPrefix(a, b) {
    var limit = Math.min(a.length, b.length);
    var count = 0;
    while (count < limit && a[count] === b[count]) { count++; }
    return count;
  }

  function commonSuffix(a, b, reserved) {
    var limit = Math.min(a.length, b.length) - reserved;
    var count = 0;
    while (count < limit && a[a.length - 1 - count] === b[b.length - 1 - count]) { count++; }
    return count;
  }

  /* LCS 长度表：table[i][j] 记 a[i..] 与 b[j..] 的最长公共子序列长度。
     从右下往左上填，回溯时每步只看一格，就不用递归也不用存方向矩阵。 */
  function lcsTable(a, b) {
    var width = b.length + 1;
    var table = new Int32Array((a.length + 1) * width);
    for (var i = a.length - 1; i >= 0; i--) {
      for (var j = b.length - 1; j >= 0; j--) {
        table[i * width + j] = a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    return table;
  }

  function backtrack(a, b, table) {
    var rows = [];
    var width = b.length + 1;
    var i = 0;
    var j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        rows.push({ type: 'same', text: a[i] });
        i++;
        j++;
        continue;
      }
      // 两侧子问题同分时固定优先记删除，保证同一份输入每次得到同一份结果。
      if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        rows.push({ type: 'del', text: a[i] });
        i++;
      } else {
        rows.push({ type: 'add', text: b[j] });
        j++;
      }
    }
    while (i < a.length) { rows.push({ type: 'del', text: a[i] }); i++; }
    while (j < b.length) { rows.push({ type: 'add', text: b[j] }); j++; }
    return rows;
  }

  /* 退化路径：在 WINDOW 行范围内找最近的对齐点重新同步，找不到就当作删除继续走。
     每轮至少推进一行，复杂度 O(剩余行数 × WINDOW)，不会卡死页面。 */
  function greedyAlign(a, b) {
    var rows = [];
    var i = 0;
    var j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        rows.push({ type: 'same', text: a[i] });
        i++;
        j++;
        continue;
      }
      var pending = 0;
      var side = '';
      for (var step = 1; step <= WINDOW; step++) {
        if (i + step < a.length && a[i + step] === b[j]) { pending = step; side = 'del'; break; }
        if (j + step < b.length && b[j + step] === a[i]) { pending = step; side = 'add'; break; }
      }
      if (!side) {
        rows.push({ type: 'del', text: a[i] });
        i++;
        continue;
      }
      for (var k = 0; k < pending; k++) {
        rows.push({ type: side === 'del' ? 'del' : 'add', text: side === 'del' ? a[i + k] : b[j + k] });
      }
      if (side === 'del') { i += pending; } else { j += pending; }
    }
    while (i < a.length) { rows.push({ type: 'del', text: a[i] }); i++; }
    while (j < b.length) { rows.push({ type: 'add', text: b[j] }); j++; }
    return rows;
  }

  // degraded 为真表示走了贪心退化路径，界面据此提示"结果为大文本近似对齐"。
  function diffLinesDetailed(a, b) {
    var left = toLines(a);
    var right = toLines(b);
    var prefix = commonPrefix(left, right);
    var suffix = commonSuffix(left, right, prefix);
    var midLeft = left.slice(prefix, left.length - suffix);
    var midRight = right.slice(prefix, right.length - suffix);

    var rows = [];
    for (var p = 0; p < prefix; p++) { rows.push({ type: 'same', text: left[p] }); }

    var degraded = midLeft.length + midRight.length > MAX_LINES;
    var middle = degraded ? greedyAlign(midLeft, midRight) : backtrack(midLeft, midRight, lcsTable(midLeft, midRight));
    rows = rows.concat(middle);

    for (var s = 0; s < suffix; s++) { rows.push({ type: 'same', text: left[left.length - suffix + s] }); }
    return { rows: rows, degraded: degraded };
  }

  function diffLines(a, b) {
    return diffLinesDetailed(a, b).rows;
  }

  GN.lib.diff = {
    MAX_LINES: MAX_LINES,
    splitLines: splitLines,
    diffLines: diffLines,
    diffLinesDetailed: diffLinesDetailed
  };
})(GN);
