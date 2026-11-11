/* 正则测试：高亮全部匹配、列出匹配清单与捕获分组、替换预览。
   高亮不拼 HTML 字符串：先把匹配切成"片段"（segments，纯逻辑可单测），
   在 mount 里再逐个用 DOM 节点 + textContent 拼出来，用户输入永远不进 innerHTML。
   零宽匹配（例如 a* 落在 "b" 上）不会推进 lastIndex，必须手动 +1，
   否则 exec 会在同一个位置反复命中，页面直接死循环。 */
(function (GN) {
  'use strict';

  var ALLOWED_FLAGS = 'gimsuyd';
  var MAX_MATCHES = 5000;  // 病态模式（如 (?:)）会产出海量零宽匹配，到量即停，保住页面
  var MAX_ROWS = 300;      // 清单最多渲染的行数，避免一次插入上万个表格单元

  function normalizeFlags(flags) {
    var text = flags === undefined || flags === null ? '' : String(flags);
    var seen = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ALLOWED_FLAGS.indexOf(ch) < 0) { throw new Error('非法 flags：' + ch + '，只支持 g i m s u y d'); }
      if (seen.indexOf(ch) >= 0) { throw new Error('非法 flags：' + ch + ' 重复出现'); }
      seen += ch;
    }
    return seen;
  }

  function buildRegExp(pattern, flags) {
    var source = pattern === undefined || pattern === null ? '' : String(pattern);
    try {
      return new RegExp(source, normalizeFlags(flags));
    } catch (error) {
      // 引擎给出的原因文本照原样带上，前面补中文前缀，避免静默失败。
      throw new Error('非法正则：' + String((error && error.message) || error));
    }
  }

  // 未参与匹配的分组是 undefined，统一成空串，调用方不用处理两种"没有值"。
  function toMatch(found) {
    var groups = [];
    for (var i = 1; i < found.length; i++) {
      groups.push(found[i] === undefined ? '' : found[i]);
    }
    return { index: found.index, match: found[0], groups: groups };
  }

  // 与 JS 语义一致：勾选 g 返回全部匹配，未勾选 g 只返回第一处。
  function findMatches(pattern, flags, text) {
    var source = text === undefined || text === null ? '' : String(text);
    var re = buildRegExp(pattern, flags);
    var out = [];
    if (!re.global) {
      var only = re.exec(source);
      if (only) { out.push(toMatch(only)); }
      return out;
    }
    for (;;) {
      var found = re.exec(source);
      if (!found) { break; }
      out.push(toMatch(found));
      if (out.length >= MAX_MATCHES) { break; }
      // 零宽匹配不会自己推进 lastIndex，手动 +1 才能走到下一个位置。
      if (found[0] === '' || re.lastIndex === found.index) { re.lastIndex = found.index + 1; }
    }
    return out;
  }

  /* 替换始终替换全部匹配（函数名即契约），因此内部补上 g；
     $1、$&、$$ 等分组引用交给 String.replace 自己解释。 */
  function replaceAll(pattern, flags, text, replacement) {
    var source = text === undefined || text === null ? '' : String(text);
    var normalized = normalizeFlags(flags);
    if (normalized.indexOf('g') < 0) { normalized += 'g'; }
    var re = buildRegExp(pattern, normalized);
    return source.replace(re, replacement === undefined || replacement === null ? '' : String(replacement));
  }

  /* 把文本切成高亮片段，只描述文本与标记，不碰 DOM，方便单测。
     不变量：所有片段的 text 依次拼起来必须等于原文。 */
  function segments(text, matches) {
    var source = text === undefined || text === null ? '' : String(text);
    var parts = [];
    var cursor = 0;
    (matches || []).forEach(function (item) {
      var index = item.index;
      var value = item.match;
      if (index < cursor) { return; }  // 防御：非前进的匹配（如粘性模式）不重复消费同一段文本
      if (index > cursor) {
        parts.push({ index: cursor, text: source.slice(cursor, index), mark: false, zero: false });
      }
      parts.push({ index: index, text: value, mark: true, zero: value === '' });
      cursor = index + value.length;
    });
    if (cursor < source.length) {
      parts.push({ index: cursor, text: source.slice(cursor), mark: false, zero: false });
    }
    return parts;
  }

  GN.register({
    id: 'regex',
    group: 'text',
    title: '正则测试',
    desc: '匹配高亮 / 分组清单 / 替换预览',
    api: {
      findMatches: findMatches,
      replaceAll: replaceAll,
      segments: segments
    },
    mount: function (root) {
      var ui = GN.ui;
      var flags = 'g';

      var patternInput = ui.input({ placeholder: '例如：\\d+ 或 (\\w+)@(\\w+)' });
      var textArea = ui.textarea({ placeholder: '粘贴待匹配的文本…', tall: true, oninput: refresh });
      var replaceInput = ui.input({ placeholder: '替换为，支持 $1 / $& 等分组引用', oninput: refresh });
      var message = ui.msg();
      var counter = ui.badge('未填写正则');
      var highlight = ui.el('div', { class: 'tb-output' });
      var listBox = ui.el('div');
      var replaceOutput = ui.output();

      function setFlag(letter, on) {
        if (on) {
          if (flags.indexOf(letter) < 0) { flags += letter; }
        } else {
          flags = flags.split(letter).join('');
        }
        refresh();
      }

      function flagBox(letter, on) {
        return ui.checkbox(letter, on, function (event) { setFlag(letter, event.target.checked); });
      }

      // 表格里展示换行/制表符时转成可见写法，否则一整行会被撑开。
      function display(text) {
        return String(text).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      }

      function renderHighlight(source, matches) {
        segments(source, matches).forEach(function (part) {
          if (part.zero) {
            highlight.appendChild(ui.el('span', { class: 'tb-mark', text: '|', title: '零宽匹配（位置 ' + part.index + '）' }));
            return;
          }
          highlight.appendChild(ui.el('span', part.mark ? { class: 'tb-mark', text: part.text } : { text: part.text }));
        });
      }

      function renderList(matches) {
        var rows = matches.slice(0, MAX_ROWS).map(function (item, i) {
          return {
            no: String(i + 1),
            index: String(item.index),
            match: item.match === '' ? '（零宽）' : display(item.match),
            groups: item.groups.length
              ? item.groups.map(function (group) { return group === '' ? '（空）' : display(group); }).join(' | ')
              : '—'
          };
        });
        listBox.appendChild(ui.table([
          { key: 'no', title: '序号' },
          { key: 'index', title: '起始位置' },
          { key: 'match', title: '完整匹配', mono: true },
          { key: 'groups', title: '捕获分组', mono: true }
        ], rows));
        if (matches.length > MAX_ROWS) {
          listBox.appendChild(ui.hint('共 ' + matches.length + ' 处匹配，清单只列出前 ' + MAX_ROWS + ' 条。'));
        }
      }

      function refresh() {
        var source = textArea.value;
        highlight.textContent = '';
        listBox.textContent = '';
        replaceOutput.setText('');
        counter.textContent = '未填写正则';
        message.clear();
        if (!patternInput.value) {
          message.show('请填写正则表达式', 'warn');
          return;
        }
        try {
          var matches = findMatches(patternInput.value, flags, source);
          renderHighlight(source, matches);
          renderList(matches);
          counter.textContent = matches.length >= MAX_MATCHES
            ? matches.length + ' 处匹配（已达上限，停止继续查找）'
            : matches.length + ' 处匹配';
          replaceOutput.setText(replaceAll(patternInput.value, flags, source, replaceInput.value));
          GN.util.status('正则测试 · ' + matches.length + ' 处匹配');
        } catch (error) {
          counter.textContent = '正则无效';
          message.show(String((error && error.message) || error), 'error');
        }
      }

      function applyReplace() {
        if (!patternInput.value) { message.show('请先填写正则表达式', 'warn'); return; }
        if (!replaceOutput.textContent && !textArea.value) { return; }
        textArea.value = replaceOutput.textContent;
        replaceInput.value = '';
        refresh();
        message.show('已把替换结果写回原文', 'ok');
      }

      patternInput.addEventListener('input', refresh);

      root.appendChild(ui.field('正则表达式', patternInput));
      root.appendChild(ui.row(
        ui.label('flags'),
        flagBox('g', true),
        flagBox('i', false),
        flagBox('m', false),
        flagBox('s', false),
        flagBox('u', false),
        ui.spacer(),
        counter
      ));
      root.appendChild(textArea);
      root.appendChild(message);
      root.appendChild(ui.row(
        ui.label('高亮预览'),
        ui.spacer(),
        ui.copyButton(function () { return textArea.value; }, '复制原文')
      ));
      root.appendChild(highlight);
      root.appendChild(ui.label('匹配清单'));
      root.appendChild(ui.scroll(listBox));
      root.appendChild(ui.row(
        ui.field('替换为', replaceInput),
        ui.button('替换到原文', applyReplace),
        ui.copyButton(function () { return replaceOutput.textContent; }, '复制替换结果')
      ));
      root.appendChild(replaceOutput);
      root.appendChild(ui.hint('未勾选 g 只处理第一处匹配；替换始终替换全部。零宽匹配用竖线标出位置。'))

      refresh();
    }
  });
})(GN);
