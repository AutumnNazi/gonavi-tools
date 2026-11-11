/* Base64 编解码：文本与 Base64 字面量双向转换，UTF-8 正确，可选 URL-safe 字母表。
   解码走严格路径——宁可抛中文错误，也不返回被截断或被替换成 U+FFFD 的"看起来成功"结果：
   非法字符、非法长度、非法 UTF-8 字节一律抛错。
   顶层只注册，DOM 操作全部在 mount 内。 */
(function (GN) {
  'use strict';

  var bytes = GN.lib.bytes;

  // 输入里的空白与换行只是排版，先剔除；其余字符一律按字面校验。
  function stripWhitespace(text) {
    return String(text).replace(/[\s\uFEFF]/g, '');
  }

  function padTo4(text) {
    return text + '===='.slice(0, (4 - (text.length % 4)) % 4);
  }

  function encodeText(text, urlSafe) {
    return urlSafe ? bytes.toBase64Url(bytes.utf8Encode(text)) : bytes.toBase64(bytes.utf8Encode(text));
  }

  function checkLength(body, total, name) {
    if (body.length % 4 === 1) { throw new Error('不是合法的 ' + name + '：有效字符数余 1，长度不合法'); }
    if (total > body.length && total % 4 !== 0) {
      throw new Error('不是合法的 ' + name + '：= 填充数量不正确（填充后长度必须是 4 的整数倍）');
    }
  }

  function decodeStandard(clean) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
      throw new Error('不是合法的 Base64：含有字母表之外的字符，或 = 填充位置不对');
    }
    var body = clean.replace(/=+$/, '');
    checkLength(body, clean.length, 'Base64');
    return bytes.fromBase64(padTo4(clean));
  }

  function decodeText(text, urlSafe) {
    var clean = stripWhitespace(text);
    if (!clean) { throw new Error('输入为空，没有可解码的内容'); }
    var raw;
    if (urlSafe) {
      // URL-safe 场景下填充本来就是可选的，这里对 = 完全宽容，只管正文。
      var body = clean.replace(/=+$/, '');
      if (!/^[A-Za-z0-9_-]+$/.test(body)) {
        throw new Error('不是合法的 Base64URL：含有字母表之外的字符（只允许 A-Z a-z 0-9 - _）');
      }
      if (body.length % 4 === 1) { throw new Error('不是合法的 Base64URL：有效字符数余 1，长度不合法'); }
      raw = bytes.fromBase64Url(body);
    } else {
      raw = decodeStandard(clean);
    }
    try {
      return bytes.utf8Decode(raw);
    } catch (error) {
      throw new Error('解码得到的字节不是合法的 UTF-8 文本，可能是二进制数据或密钥');
    }
  }

  GN.register({
    id: 'base64',
    group: 'codec',
    title: 'Base64',
    desc: '文本与 Base64 双向转换，支持 URL-safe',
    api: {
      encodeText: encodeText,
      decodeText: decodeText
    },
    mount: function (root) {
      var ui = GN.ui;
      var urlSafe = false;

      var input = ui.textarea({ placeholder: '输入要编码的文本，或要解码的 Base64（可含空格与换行）…', tall: true });
      var output = ui.output();
      var message = ui.msg();

      function run(action, label) {
        var text = input.value;
        if (!text.trim()) { message.show('请先输入内容', 'warn'); return; }
        try {
          output.setText(action(text));
          message.show(label + '完成' + (urlSafe ? '（URL-safe）' : ''), 'ok');
        } catch (error) {
          output.setText('');
          message.show(String((error && error.message) || error), 'error');
        }
      }

      function swap() {
        var text = output.textContent;
        if (!text) { message.show('还没有结果可以带回输入框', 'warn'); return; }
        input.value = text;
        message.show('已把结果放回输入框', 'ok');
      }

      root.appendChild(ui.row(
        ui.button('编码为 Base64', function () { run(function (t) { return encodeText(t, urlSafe); }, '编码'); }),
        ui.button('解码为文本', function () { run(function (t) { return decodeText(t, urlSafe); }, '解码'); }),
        ui.checkbox('URL-safe（- _ 且去掉 = 填充）', false, function (event) { urlSafe = event.target.checked; }),
        ui.spacer()
      ));
      root.appendChild(input);
      root.appendChild(ui.row(
        ui.copyButton(function () { return output.textContent; }),
        ui.button('结果放回输入框', swap),
        ui.button('清空', function () {
          input.value = '';
          output.setText('');
          message.clear();
        }, 'danger'),
        ui.spacer()
      ));
      root.appendChild(message);
      root.appendChild(output);
      root.appendChild(ui.hint('按 UTF-8 编解码；URL-safe 用 - 和 _ 并去掉 = 填充。非法输入会报错，而不是返回空串。'))
    }
  });
})(GN);
