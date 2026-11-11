/* 行处理：去重、排序、反转行序、每行 trim、去空行、加前后缀、合并为一行、转 SQL IN 列表。
   api 既接受行数组，也接受原始文本（按 CRLF / LF / CR 拆行），统一返回新数组，不修改入参。 */
(function (GN) {
  'use strict';

  function asLines(value) {
    if (Array.isArray(value)) {
      return value.map(function (line) { return String(line); });
    }
    var source = String(value === undefined || value === null ? '' : value);
    if (source === '') { return []; }
    var parts = source.split(/\r\n|\r|\n/);
    // 末尾换行只是行终止符，不再额外产生一个空行。
    if (parts.length > 1 && parts[parts.length - 1] === '') { parts.pop(); }
    return parts;
  }

  // 去重保留首次出现的顺序，重复的"哪一条留下"才是用户预期的第一条。
  function unique(lines) {
    var seen = new Set();
    return asLines(lines).filter(function (line) {
      if (seen.has(line)) { return false; }
      seen.add(line);
      return true;
    });
  }

  // 按 UTF-16 码序排序（与数组默认排序一致，结果稳定可预期），desc 为真时反向。
  function sortLines(lines, desc) {
    var out = asLines(lines).sort();
    return desc ? out.reverse() : out;
  }

  function trimLines(lines) {
    return asLines(lines).map(function (line) { return line.trim(); });
  }

  // 只有空白的行也算空行。
  function dropEmpty(lines) {
    return asLines(lines).filter(function (line) { return line.trim() !== ''; });
  }

  function reverse(lines) {
    return asLines(lines).reverse();
  }

  function addAffix(lines, prefix, suffix) {
    var head = prefix === undefined || prefix === null ? '' : String(prefix);
    var tail = suffix === undefined || suffix === null ? '' : String(suffix);
    return asLines(lines).map(function (line) { return head + line + tail; });
  }

  function joinLines(lines, separator) {
    var glue = separator === undefined || separator === null ? '' : String(separator);
    return asLines(lines).join(glue);
  }

  /* 转 SQL IN 列表：每行包成 'x', 形式，行内单引号按 SQL 规则转义成两个单引号。 */
  function toInList(lines) {
    return asLines(lines).map(function (line) {
      return "'" + line.trim().split("'").join("''") + "',";
    });
  }

  GN.register({
    id: 'text-lines',
    group: 'text',
    title: '行处理',
    desc: '去重 / 排序 / 反转 / trim / 去空行 / 加前后缀 / 合并 / IN 列表',
    api: {
      unique: unique,
      sortLines: sortLines,
      trimLines: trimLines,
      dropEmpty: dropEmpty,
      reverse: reverse,
      addAffix: addAffix,
      joinLines: joinLines,
      toInList: toInList
    },
    mount: function (root) {
      var ui = GN.ui;

      var input = ui.textarea({ placeholder: '每行一条数据…', tall: true });
      var prefixInput = ui.input({ placeholder: '前缀，例如 UPDATE t SET ' });
      var suffixInput = ui.input({ placeholder: '后缀，例如 ;' });
      var separatorInput = ui.input({ value: ',', placeholder: '分隔符' });
      var message = ui.msg();

      // 处理结果直接写回输入框，方便一个操作接一个操作地叠加。
      function applyLines(label, transform) {
        var before = asLines(input.value);
        var after = transform(before);
        input.value = after.join('\n');
        message.show(label + '：' + before.length + ' 行 → ' + after.length + ' 行', 'ok');
        GN.util.status(label + '完成');
      }

      function applyText(label, transform) {
        var before = asLines(input.value);
        var text = transform(before);
        input.value = text;
        message.show(label + '：' + before.length + ' 行 → ' + asLines(text).length + ' 行', 'ok');
        GN.util.status(label + '完成');
      }

      root.appendChild(input);
      root.appendChild(ui.row(
        ui.button('去重', function () { applyLines('去重', unique); }),
        ui.button('排序 ↑', function () { applyLines('升序排序', function (list) { return sortLines(list, false); }); }),
        ui.button('排序 ↓', function () { applyLines('降序排序', function (list) { return sortLines(list, true); }); }),
        ui.button('反转行序', function () { applyLines('反转行序', reverse); }),
        ui.button('每行 trim', function () { applyLines('每行 trim', trimLines); }),
        ui.button('去空行', function () { applyLines('去空行', dropEmpty); }),
        ui.spacer()
      ));
      root.appendChild(ui.row(
        ui.field('前缀', prefixInput),
        ui.field('后缀', suffixInput),
        ui.button('加前后缀', function () {
          applyLines('加前后缀', function (list) { return addAffix(list, prefixInput.value, suffixInput.value); });
        })
      ));
      root.appendChild(ui.row(
        ui.field('分隔符', separatorInput),
        ui.button('合并为一行', function () {
          applyText('合并为一行', function (list) { return joinLines(list, separatorInput.value); });
        }),
        ui.spacer()
      ));
      root.appendChild(ui.row(
        ui.button('转 SQL IN 列表', function () { applyLines('转 IN 列表', toInList); }),
        ui.button('清空', function () {
          input.value = '';
          message.clear();
        }, 'danger'),
        ui.spacer(),
        ui.copyButton(function () { return input.value; })
      ));
      root.appendChild(message);
      root.appendChild(ui.hint('操作就地生效，可连续叠加；去重保留首次出现顺序，排序按字符码序。'));
    }
  });
})(GN);
