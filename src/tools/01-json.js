/* JSON 工具：格式化、压缩、键排序、转义/去转义、带准确行列的校验。
   校验位置不用引擎错误消息（不同 V8 版本格式不同、新版本已不给坐标），
   而是自己扫一遍语法，保证任何环境下都能报出中文原因与行列。
   本文件同时是其余工具模块的写法范例：顶层只注册，DOM 操作全部在 mount 内。 */
(function (GN) {
  'use strict';

  var INDENTS = { '2': '  ', '4': '    ', 'tab': '\t' };
  var MAX_DEPTH = 512;

  function parseJson(text) {
    return JSON.parse(String(text));
  }

  // 递归按键名排序；数组顺序保持原样（顺序通常有语义）。
  function sortValue(value) {
    if (Array.isArray(value)) { return value.map(sortValue); }
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).sort().forEach(function (key) { out[key] = sortValue(value[key]); });
      return out;
    }
    return value;
  }

  function indentOf(key) {
    return INDENTS[key] === undefined ? '  ' : INDENTS[key];
  }

  function formatJson(text, indentKey) {
    return JSON.stringify(parseJson(text), null, indentOf(indentKey));
  }

  function minifyJson(text) {
    return JSON.stringify(parseJson(text));
  }

  function sortJson(text, indentKey) {
    return JSON.stringify(sortValue(parseJson(text)), null, indentOf(indentKey));
  }

  // 输出完整 JSON 字符串字面量（含外层引号），可直接粘进 JSON 或代码里。
  function escapeAsJsonString(text) {
    return JSON.stringify(String(text));
  }

  var JSON_ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

  // 裸转义文本的宽容还原：合法转义序列还原，非法序列原样保留，
  // 这样把不含转义的普通文本粘进来也能原样返回。
  function decodeEscapes(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch !== '\\' || i + 1 >= text.length) { out += ch; continue; }
      var next = text.charAt(i + 1);
      if (next === 'u') {
        var hex = text.substr(i + 2, 4);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          continue;
        }
        out += ch;
        continue;
      }
      if (JSON_ESCAPES[next] !== undefined) { out += JSON_ESCAPES[next]; i++; continue; }
      out += ch;
    }
    return out;
  }

  // 带引号的字面量按 JSON 规则严格解析；裸文本按转义文本宽容还原。
  function unescapeJsonString(text) {
    var source = String(text).trim();
    if (source.charAt(0) === '"' && source.charAt(source.length - 1) === '"') {
      var value = JSON.parse(source);
      if (typeof value !== 'string') { throw new Error('去转义的目标必须是 JSON 字符串'); }
      return value;
    }
    return decodeEscapes(source);
  }

  /* ---------------- 语法扫描：定位第一个错误 ---------------- */

  function scanJson(text) {
    text = String(text);
    var at = 0;
    var depth = 0;

    function fail(message, index) {
      throw { position: index === undefined ? at : index, reason: message };
    }

    function skipSpace() {
      while (at < text.length) {
        var ch = text.charAt(at);
        if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') { return; }
        at++;
      }
    }

    function readValue() {
      skipSpace();
      if (at >= text.length) { fail('内容在这里意外结束，缺少值'); }
      var ch = text.charAt(at);
      if (ch === '{') { readObject(); return; }
      if (ch === '[') { readArray(); return; }
      if (ch === '"') { readString(); return; }
      if (ch === 't') { readLiteral('true'); return; }
      if (ch === 'f') { readLiteral('false'); return; }
      if (ch === 'n') { readLiteral('null'); return; }
      if (ch === '-' || (ch >= '0' && ch <= '9')) { readNumber(); return; }
      fail('无法识别的字符 ' + JSON.stringify(ch));
    }

    function readLiteral(word) {
      if (text.substr(at, word.length) !== word) { fail('期望 ' + word); }
      at += word.length;
    }

    function readObject() {
      if (++depth > MAX_DEPTH) { fail('嵌套层数超过 ' + MAX_DEPTH + ' 层'); }
      at++;
      skipSpace();
      if (text.charAt(at) === '}') { at++; depth--; return; }
      for (;;) {
        skipSpace();
        if (text.charAt(at) !== '"') { fail('对象的键必须是双引号字符串'); }
        readString();
        skipSpace();
        if (text.charAt(at) !== ':') { fail('键后面缺少冒号'); }
        at++;
        readValue();
        skipSpace();
        if (text.charAt(at) === ',') { at++; continue; }
        if (text.charAt(at) === '}') { at++; break; }
        fail('期望逗号或右花括号');
      }
      depth--;
    }

    function readArray() {
      if (++depth > MAX_DEPTH) { fail('嵌套层数超过 ' + MAX_DEPTH + ' 层'); }
      at++;
      skipSpace();
      if (text.charAt(at) === ']') { at++; depth--; return; }
      for (;;) {
        readValue();
        skipSpace();
        if (text.charAt(at) === ',') { at++; continue; }
        if (text.charAt(at) === ']') { at++; break; }
        fail('期望逗号或右方括号');
      }
      depth--;
    }

    function readString() {
      at++;
      for (;;) {
        if (at >= text.length) { fail('字符串缺少闭合的双引号'); }
        var ch = text.charAt(at);
        if (ch === '"') { at++; return; }
        if (ch === '\\') {
          var escape = text.charAt(at + 1);
          if (escape === '') { fail('转义字符不完整'); }
          if ('"\\/bfnrt'.indexOf(escape) >= 0) { at += 2; continue; }
          if (escape === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(text.substr(at + 2, 4))) { fail('\\u 后面必须跟 4 位十六进制'); }
            at += 6;
            continue;
          }
          fail('无效的转义 \\' + escape);
        }
        if (ch.charCodeAt(0) < 0x20) { fail('字符串里出现了未转义的控制字符'); }
        at++;
      }
    }

    function readNumber() {
      if (text.charAt(at) === '-') { at++; }
      if (text.charAt(at) === '0') { at++; }
      else if (text.charAt(at) >= '1' && text.charAt(at) <= '9') {
        while (text.charAt(at) >= '0' && text.charAt(at) <= '9') { at++; }
      } else { fail('数字格式不正确'); }

      if (text.charAt(at) === '.') {
        at++;
        if (!(text.charAt(at) >= '0' && text.charAt(at) <= '9')) { fail('小数点后面必须有数字'); }
        while (text.charAt(at) >= '0' && text.charAt(at) <= '9') { at++; }
      }
      if (text.charAt(at) === 'e' || text.charAt(at) === 'E') {
        at++;
        if (text.charAt(at) === '+' || text.charAt(at) === '-') { at++; }
        if (!(text.charAt(at) >= '0' && text.charAt(at) <= '9')) { fail('指数部分必须有数字'); }
        while (text.charAt(at) >= '0' && text.charAt(at) <= '9') { at++; }
      }
    }

    try {
      readValue();
      skipSpace();
      if (at < text.length) { fail('内容结束后还有多余字符'); }
      return { ok: true };
    } catch (problem) {
      var index = Math.min(typeof problem.position === 'number' ? problem.position : at, text.length);
      var before = text.slice(0, index);
      return {
        ok: false,
        message: problem.reason || String(problem),
        line: before.split('\n').length,
        column: index - before.lastIndexOf('\n')
      };
    }
  }

  function where(result) {
    return result.line ? '（第 ' + result.line + ' 行第 ' + result.column + ' 列）' : '';
  }

  function validateJson(text) {
    var scan = scanJson(text);
    if (!scan.ok) { return { ok: false, message: scan.message + where(scan), line: scan.line, column: scan.column }; }
    // 扫描通过后仍以引擎解析为准，避免自己的扫描器漏判时给出错误的安全感。
    try {
      parseJson(text);
      return { ok: true, message: 'JSON 合法' };
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error), line: null, column: null };
    }
  }

  GN.register({
    id: 'json',
    group: 'codec',
    title: 'JSON',
    desc: '格式化 / 压缩 / 键排序 / 转义 / 校验',
    api: {
      format: formatJson,
      minify: minifyJson,
      sortKeys: sortJson,
      escape: escapeAsJsonString,
      unescape: unescapeJsonString,
      decodeEscapes: decodeEscapes,
      scan: scanJson,
      validate: validateJson
    },
    mount: function (root) {
      var ui = GN.ui;
      var indentKey = '2';

      var input = ui.textarea({ placeholder: '粘贴 JSON 文本…', tall: true });
      var output = ui.output();
      var message = ui.msg();

      function run(action, label) {
        var text = input.value;
        if (!text.trim()) { message.show('请先粘贴 JSON 文本', 'warn'); return; }
        var scan = scanJson(text);
        if (!scan.ok) {
          output.setText('');
          message.show('解析失败：' + scan.message + where(scan), 'error');
          return;
        }
        try {
          output.setText(action(text));
          message.show(label + '完成', 'ok');
        } catch (error) {
          output.setText('');
          message.show('失败：' + String((error && error.message) || error), 'error');
        }
      }

      var indentSelect = ui.select([
        { value: '2', label: '缩进 2 空格' },
        { value: '4', label: '缩进 4 空格' },
        { value: 'tab', label: '缩进 Tab' }
      ], indentKey, function () { indentKey = indentSelect.value; });

      root.appendChild(ui.row(
        // 先只读校验（不动数据），再结构整理，最后是互为反向的 格式化 / 压缩。
        ui.button('校验', function () {
          var result = validateJson(input.value);
          message.show(result.message, result.ok ? 'ok' : 'error');
        }),
        ui.button('键排序', function () { run(function (t) { return sortJson(t, indentKey); }, '键排序'); }),
        ui.button('格式化', function () { run(function (t) { return formatJson(t, indentKey); }, '格式化'); }),
        ui.button('压缩', function () { run(minifyJson, '压缩'); }),
        ui.spacer(),
        indentSelect
      ));
      root.appendChild(input);
      root.appendChild(ui.row(
        ui.button('转义为字符串', function () { run(escapeAsJsonString, '转义'); }),
        ui.button('去转义', function () { run(unescapeJsonString, '去转义'); }),
        ui.copyButton(function () { return output.textContent; }),
        ui.button('清空', function () {
          input.value = '';
          output.setText('');
          message.clear();
        }, 'danger'),
        ui.spacer()
      ));
      root.appendChild(message);
      root.appendChild(output);
      root.appendChild(ui.hint('转义输出带引号的 JSON 字面量；格式化会重建文本，超过 2^53 的整数可能丢精度。'))
    }
  });
})(GN);
