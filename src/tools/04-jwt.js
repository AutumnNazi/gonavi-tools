/* JWT 解码：把 header / payload 段落做 Base64URL 解码后格式化展示，并解释 iat / nbf / exp。
   本工具只解码，不做任何签名校验——界面必须一直显示这条提醒，避免被人当成验签结果信任。
   顶层只注册，DOM 操作全部在 mount 内。 */
(function (GN) {
  'use strict';

  var bytes = GN.lib.bytes;

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // 时间戳按本机时区展示，与应用实际运行环境一致；格式固定 yyyy-MM-dd HH:mm:ss。
  function formatLocal(seconds) {
    var date = new Date(seconds * 1000);
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  // 相对时长文案：从大到小取两个单位，够用又不啰嗦。
  function formatDuration(seconds) {
    var rest = Math.abs(Math.floor(seconds));
    var units = [
      { size: 86400, name: '天' },
      { size: 3600, name: '小时' },
      { size: 60, name: '分钟' },
      { size: 1, name: '秒' }
    ];
    var parts = [];
    for (var i = 0; i < units.length && parts.length < 2; i++) {
      var value = Math.floor(rest / units[i].size);
      if (value > 0) { parts.push(value + units[i].name); }
      rest -= value * units[i].size;
    }
    return parts.length ? parts.join(' ') : '不足 1 秒';
  }

  function decodeSegment(segment, name) {
    var clean = String(segment).replace(/[\s\uFEFF]/g, '').replace(/=+$/, '');
    if (!clean) { throw new Error(name + ' 段是空的'); }
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) {
      throw new Error(name + ' 段不是合法的 Base64URL：含有字母表之外的字符');
    }
    if (clean.length % 4 === 1) {
      throw new Error(name + ' 段不是合法的 Base64URL：有效字符数余 1，长度不合法');
    }
    var text;
    try {
      text = bytes.utf8Decode(bytes.fromBase64Url(clean));
    } catch (error) {
      throw new Error(name + ' 段的字节不是合法的 UTF-8 文本');
    }
    var value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(name + ' 段不是合法的 JSON：' + text.slice(0, 60));
    }
    return value;
  }

  function readClaim(payload, key) {
    var value = payload ? payload[key] : undefined;
    if (typeof value === 'number' && isFinite(value)) { return value; }
    return null;
  }

  function decode(token, now) {
    var source = String(token === null || token === undefined ? '' : token).trim();
    if (!source) { throw new Error('请输入 JWT 令牌'); }
    var parts = source.split('.');
    if (parts.length !== 3) {
      throw new Error('JWT 必须由点号分成三段（header.payload.signature），当前是 ' + parts.length + ' 段');
    }
    var header = decodeSegment(parts[0], 'header');
    var payload = decodeSegment(parts[1], 'payload');
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('payload 段必须是 JSON 对象（键值对）');
    }
    var signature = String(parts[2]).replace(/[\s\uFEFF]/g, '');
    var seconds = typeof now === 'number' ? now : Math.floor(Date.now() / 1000);
    var exp = readClaim(payload, 'exp');
    return {
      header: header,
      payload: payload,
      signature: signature,
      segments: {
        header: parts[0],
        payload: parts[1],
        signature: parts[2]
      },
      timestamps: {
        iat: readClaim(payload, 'iat'),
        nbf: readClaim(payload, 'nbf'),
        exp: exp
      },
      expired: exp !== null ? exp <= seconds : false
    };
  }

  function timestampRows(result, now) {
    var seconds = typeof now === 'number' ? now : Math.floor(Date.now() / 1000);
    var rows = [];
    [['iat', '签发时间'], ['nbf', '生效时间'], ['exp', '过期时间']].forEach(function (pair) {
      var value = result.timestamps[pair[0]];
      if (value === null) { return; }
      var state = pair[0] === 'exp'
        ? (value <= seconds ? '已过期，' + formatDuration(seconds - value) + '前过期'
          : '还有 ' + formatDuration(value - seconds) + '过期')
        : (value > seconds ? '尚未生效，还有 ' + formatDuration(value - seconds)
          : '已生效，' + formatDuration(seconds - value) + '前生效');
      rows.push({ key: pair[0], label: pair[1], raw: String(value), local: formatLocal(value), state: state });
    });
    return rows;
  }

  GN.register({
    id: 'jwt',
    group: 'codec',
    title: 'JWT 解码',
    desc: '拆解 header / payload，解释 iat / nbf / exp，不验签',
    api: {
      decode: decode,
      formatLocal: formatLocal,
      formatDuration: formatDuration,
      timestampRows: timestampRows
    },
    mount: function (root) {
      var ui = GN.ui;

      var input = ui.textarea({ placeholder: '粘贴 JWT 令牌（形如 xxx.yyy.zzz）…', tall: true });
      var message = ui.msg();
      var warning = ui.msg().show('本工具只做 Base64URL 解码，不校验签名，也不检查签发方是否可信。' +
        '任何经过 Base64 篡改的令牌都能在这里解出内容，请勿据此信任令牌。', 'warn');

      var headerOut = ui.output();
      var payloadOut = ui.output();
      var signatureOut = ui.output();
      var timesOut = ui.output();

      function clearAll() {
        headerOut.setText('');
        payloadOut.setText('');
        signatureOut.setText('');
        timesOut.setText('');
      }

      function run() {
        var now = Math.floor(Date.now() / 1000);
        var result;
        try {
          result = decode(input.value, now);
        } catch (error) {
          clearAll();
          message.show(String((error && error.message) || error), 'error');
          return;
        }
        headerOut.setText(JSON.stringify(result.header, null, 2));
        payloadOut.setText(JSON.stringify(result.payload, null, 2));
        signatureOut.setText(result.signature
          ? result.signature + '（' + result.signature.length + ' 个字符，仅原样展示，未校验）'
          : '（签名为空：这是 alg=none 的无签名令牌，更不可信）');

        var rows = timestampRows(result, now);
        if (result.timestamps.exp === null) {
          rows.push({ key: 'exp', label: '过期时间', raw: '（无 exp）', local: '令牌未声明过期时间，默认长期有效', state: '未过期判定不可用' });
        }
        timesOut.setText(rows.map(function (row) {
          return row.key + '（' + row.label + '）：' + row.raw + ' → ' + row.local + ' · ' + row.state;
        }).join('\n'));

        var badge = result.timestamps.exp === null
          ? '未声明 exp'
          : (result.expired ? '已过期' : '未过期');
        message.show('解码完成 · ' + badge, result.expired && result.timestamps.exp !== null ? 'warn' : 'ok');
      }

      root.appendChild(warning);
      root.appendChild(input);
      root.appendChild(ui.row(
        ui.button('解码', run, 'primary'),
        ui.copyButton(function () { return payloadOut.textContent; }, '复制 payload'),
        ui.button('清空', function () {
          input.value = '';
          clearAll();
          message.clear();
        }, 'danger'),
        ui.spacer()
      ));
      root.appendChild(message);

      root.appendChild(ui.col(
        ui.label('Header'),
        ui.scroll(headerOut)
      ));
      root.appendChild(ui.col(
        ui.label('Payload'),
        ui.scroll(payloadOut)
      ));
      root.appendChild(ui.col(
        ui.label('时间声明'),
        timesOut
      ));
      root.appendChild(ui.col(
        ui.label('签名'),
        signatureOut
      ));
      root.appendChild(ui.hint('签名段在这里只做展示：JWT 的签名校验需要密钥，本插件不联网也不读取任何密钥。' +
        'exp / nbf 按本机时区显示，相对时间以打开或刷新时刻为准。'));
    }
  });
})(GN);
