/* 文本对比：左右两份文本做行级 diff（算法在 lib/diff.js），标注新增 / 删除 / 相同。
   渲染行数有上限，超出只渲染前一段并明确提示省略了多少行，
   避免一次往页面插入上万行 DOM 把界面卡住。 */
(function (GN) {
  'use strict';

  var MAX_RENDER = 2000;

  // 行级 diff 是共享算法，放在 lib 里；这里只做一次存在性检查，缺 lib 时给出能看懂的错误。
  function requireDiff() {
    if (!GN.lib || !GN.lib.diff || typeof GN.lib.diff.diffLines !== 'function') {
      throw new Error('缺少 lib/diff.js：文本对比依赖行级 diff 实现');
    }
    return GN.lib.diff;
  }

  function diff(a, b) {
    return requireDiff().diffLines(a, b);
  }

  function summarize(rows) {
    var counts = { same: 0, add: 0, del: 0, total: 0 };
    (rows || []).forEach(function (row) {
      if (row.type === 'add') { counts.add++; }
      else if (row.type === 'del') { counts.del++; }
      else { counts.same++; }
      counts.total++;
    });
    return counts;
  }

  // 按上限截断渲染行，并回报省略了多少行。
  function preview(rows, limit) {
    var list = rows || [];
    var max = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : MAX_RENDER;
    return { rows: list.slice(0, max), omitted: Math.max(0, list.length - max) };
  }

  GN.register({
    id: 'text-diff',
    group: 'text',
    title: '文本对比',
    desc: '左右文本行级对比，新增绿 / 删除红 / 相同灰',
    api: {
      diff: diff,
      summarize: summarize,
      preview: preview
    },
    mount: function (root) {
      var ui = GN.ui;

      var left = ui.textarea({ placeholder: '左侧：原始文本…', tall: true });
      var right = ui.textarea({ placeholder: '右侧：对比文本…', tall: true });
      var message = ui.msg();
      var statsRow = ui.row();
      var rowsBox = ui.output();
      var tip = ui.hint('');

      function lineNode(row) {
        var mark = row.type === 'add' ? 'tb-mark--add' : (row.type === 'del' ? 'tb-mark--del' : '');
        var sign = row.type === 'add' ? '+' : (row.type === 'del' ? '-' : ' ');
        return ui.el('div', { class: 'tb-mono' + (row.type === 'same' ? ' tb-hint' : '') }, [
          ui.el('span', { class: mark, text: sign + ' ' }),
          // 空行给一个不换行空格，否则行内没有内容、底色也显示不出来。
          ui.el('span', { class: mark, text: row.text === '' ? '\u00a0' : row.text })
        ]);
      }

      function compare() {
        statsRow.textContent = '';
        rowsBox.textContent = '';
        tip.textContent = '';
        message.clear();

        var rows;
        try {
          rows = diff(left.value, right.value);
        } catch (error) {
          message.show(String((error && error.message) || error), 'error');
          return;
        }

        var counts = summarize(rows);
        statsRow.appendChild(ui.badge('新增 ' + counts.add, 'ok'));
        statsRow.appendChild(ui.badge('删除 ' + counts.del, 'error'));
        statsRow.appendChild(ui.badge('相同 ' + counts.same));
        statsRow.appendChild(ui.label('共 ' + counts.total + ' 行'));

        var slice = preview(rows, MAX_RENDER);
        slice.rows.forEach(function (row) { rowsBox.appendChild(lineNode(row)); });
        if (slice.omitted) {
          tip.textContent = '共计 ' + counts.total + ' 行，只渲染了前 ' + MAX_RENDER + ' 行，省略 ' + slice.omitted + ' 行。';
        }
        GN.util.status('文本对比 · 新增 ' + counts.add + ' / 删除 ' + counts.del + ' / 相同 ' + counts.same);
      }

      function swap() {
        var temp = left.value;
        left.value = right.value;
        right.value = temp;
        compare();
      }

      root.appendChild(ui.split(
        ui.col(ui.label('左侧（原始）'), left),
        ui.col(ui.label('右侧（对比）'), right)
      ));
      root.appendChild(ui.row(
        ui.button('对比', compare),
        ui.button('交换左右', swap),
        ui.button('清空', function () {
          left.value = '';
          right.value = '';
          statsRow.textContent = '';
          rowsBox.textContent = '';
          tip.textContent = '';
          message.clear();
        }, 'danger'),
        ui.spacer(),
        ui.copyButton(function () { return rowsBox.textContent; }, '复制对比结果')
      ));
      root.appendChild(message);
      root.appendChild(statsRow);
      root.appendChild(rowsBox);
      root.appendChild(tip);
      root.appendChild(ui.hint('绿色新增、红色删除、灰色未改动；行级对比，相同的前后缀会先剪掉。'))
    }
  });
})(GN);
