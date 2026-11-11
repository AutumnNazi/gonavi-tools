/* 进制转换工具：2/8/10/16/36 互转，全程用 BigInt 计算，不经过 Number，
   所以超过 2^53 的整数也能精确往返（Number 路线会在第 16 位十进制数字上丢精度）。
   顺带展示二进制 4 位分组、位宽/字节数与 UTF-8 解码结果。 */
(function (GN) {
  'use strict';

  var BASES = [2, 8, 10, 16, 36];
  var DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
  var PREFIX = { 2: '0b', 8: '0o', 16: '0x' };
  var MAX_DECODE_BYTES = 1024;  // 解码显示上限：再大的整数只报字节数，避免把界面卡死

  function isBase(value) {
    return BASES.indexOf(Number(value)) >= 0;
  }

  function textOf(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function allowedChars(base) {
    return base <= 10 ? '0-' + String(base - 1) : '0-9、a-' + DIGITS.charAt(base - 1);
  }

  function padTo(text, width) {
    var out = text;
    while (out.length < width) { out = '0' + out; }
    return out;
  }

  /* 解析文本为 BigInt：
     - 允许最前面一个正负号，符号出现在别处直接报错；
     - 0x / 0b / 0o 前缀自动识别，与手选进制冲突时报错而不是猜；
     - 非法字符报出具体字符与进制。 */
  function parseBigInt(text, radix) {
    var source = textOf(text).trim();
    if (!source) { throw new Error('内容为空，请输入待转换的整数'); }

    var auto = radix === 'auto' || radix === undefined || radix === null || radix === '' || radix === 0;
    var base = auto ? null : Number(radix);
    if (!auto && !isBase(base)) { throw new Error('不支持的进制：' + textOf(radix) + '（仅支持 2/8/10/16/36）'); }

    var negative = false;
    if (source.charAt(0) === '+' || source.charAt(0) === '-') {
      negative = source.charAt(0) === '-';
      source = source.slice(1);
    }

    var head = source.slice(0, 2).toLowerCase();
    var prefixBase = head === '0x' ? 16 : head === '0b' ? 2 : head === '0o' ? 8 : 0;
    if (prefixBase) {
      if (base !== null && base !== prefixBase) {
        throw new Error('前缀 ' + PREFIX[prefixBase] + ' 与所选 ' + base + ' 进制不一致');
      }
      base = prefixBase;
      source = source.slice(2);
    }
    if (base === null) { base = 10; }
    if (!source) { throw new Error('只有进制前缀，缺少数字'); }

    var value = BigInt(0);
    var step = BigInt(base);
    for (var i = 0; i < source.length; i++) {
      var ch = source.charAt(i);
      if (ch === '+' || ch === '-') { throw new Error('正负号只能出现在最前面'); }
      if (ch === '.') { throw new Error('只支持整数，不支持小数点'); }
      var digit = DIGITS.indexOf(ch.toLowerCase());
      if (digit < 0) { throw new Error('出现非法字符「' + ch + '」，' + base + ' 进制只允许 ' + allowedChars(base)); }
      if (digit >= base) { throw new Error('字符「' + ch + '」不是 ' + base + ' 进制的合法数字'); }
      value = value * step + BigInt(digit);
    }
    return negative ? -value : value;
  }

  function signOf(value) {
    return value < BigInt(0) ? '-' : '';
  }

  function convert(text, from, to) {
    var target = Number(to);
    if (!isBase(target)) { throw new Error('不支持的进制：' + textOf(to) + '（仅支持 2/8/10/16/36）'); }
    var value = parseBigInt(text, from);
    var abs = value < BigInt(0) ? -value : value;
    return signOf(value) + abs.toString(target);
  }

  // 每 4 位一组，最左一组左补 0 补齐，便于按十六进制半字节肉眼核对。
  function groupBinary(bits) {
    var groups = [];
    for (var end = bits.length; end > 0; end -= 4) {
      var start = end - 4 < 0 ? 0 : end - 4;
      groups.unshift(padTo(bits.slice(start, end), 4));
    }
    return groups.join(' ');
  }

  function toBinaryGrouped(text, radix) {
    var value = parseBigInt(text, radix);
    var abs = value < BigInt(0) ? -value : value;
    return (value < BigInt(0) ? '- ' : '') + groupBinary(abs.toString(2));
  }

  // 大端最小字节序列：位宽不是 8 的倍数时，最高字节只保留实际有效位。
  function bytesOf(value, length) {
    var out = new Uint8Array(length);
    var rest = value;
    var mask = BigInt(255);
    for (var i = length - 1; i >= 0; i--) {
      out[i] = Number(rest & mask);
      rest = rest >> BigInt(8);
    }
    return out;
  }

  function decodeUtf8(value, byteLength) {
    if (value === BigInt(0)) { return { ok: false, reason: '数值为 0，没有可解码的字节' }; }
    if (byteLength > MAX_DECODE_BYTES) {
      return { ok: false, reason: '超过 ' + MAX_DECODE_BYTES + ' 字节，已跳过大文本解码' };
    }
    var bytes = bytesOf(value, byteLength);
    var lib = GN.lib && GN.lib.bytes;
    try {
      // 优先用页面的公共字节库；它可能因脚本初始化顺序而在宿主页面里缺席，
      // 这里兜底到同一个标准解码器，保证「UTF-8 解码」不因外部模块缺席而失效。
      var text = lib && typeof lib.utf8Decode === 'function'
        ? lib.utf8Decode(bytes)
        : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { ok: true, text: text };
    } catch (error) {
      return { ok: false, reason: '不是合法的 UTF-8 字节序列' };
    }
  }

  function describe(text, radix) {
    var value = parseBigInt(text, radix);
    var negative = value < BigInt(0);
    var abs = negative ? -value : value;
    var binary = abs.toString(2);
    var bitLength = abs === BigInt(0) ? 1 : binary.length;
    var byteLength = Math.ceil(bitLength / 8);
    var bases = {};
    BASES.forEach(function (base) { bases[base] = abs.toString(base); });
    return {
      decimal: value.toString(),
      negative: negative,
      bitLength: bitLength,
      byteLength: byteLength,
      binary: binary,
      grouped: (negative ? '- ' : '') + groupBinary(binary),
      hex: '0x' + abs.toString(16),
      bases: bases,
      utf8: decodeUtf8(abs, byteLength)
    };
  }

  function withPrefix(text, radix) {
    var prefix = PREFIX[Number(radix)] || '';
    if (!prefix) { return text; }
    return text.charAt(0) === '-' ? '-' + prefix + text.slice(1) : prefix + text;
  }

  GN.register({
    id: 'radix',
    group: 'misc',
    title: '进制转换',
    desc: '2/8/10/16/36 互转（BigInt 大整数）+ 二进制分组 / UTF-8 解码',
    api: {
      parseBigInt: parseBigInt,
      convert: convert,
      toBinaryGrouped: toBinaryGrouped,
      groupBinary: groupBinary,
      describe: describe,
      withPrefix: withPrefix,
      BASES: BASES
    },
    mount: function (root) {
      var ui = GN.ui;
      var baseOptions = BASES.map(function (base) {
        return { value: String(base), label: base + ' 进制' };
      });

      var input = ui.input({ value: '9007199254740993', placeholder: '例如 0x1f、0b1010、9007199254740993' });
      var fromSelect = ui.select([{ value: 'auto', label: '自动识别前缀' }].concat(baseOptions), 'auto');
      var toSelect = ui.select(baseOptions, '16');
      var message = ui.msg();
      var output = ui.output();
      var details = ui.col();

      function radixOf(select) {
        return select.value === 'auto' ? 'auto' : Number(select.value);
      }

      function renderDetails(info) {
        details.textContent = '';
        details.appendChild(ui.table(
          [{ key: 'base', title: '全部进制' }, { key: 'value', title: '结果', mono: true }],
          BASES.map(function (base) { return { base: base + ' 进制', value: info.bases[base] }; })
        ));
        details.appendChild(ui.table(
          [{ key: 'key', title: '附带信息' }, { key: 'value', title: '值', mono: true }],
          [
            { key: '二进制（4 位分组）', value: info.grouped },
            { key: '位宽', value: info.bitLength + ' 位' },
            { key: '字节数', value: info.byteLength + ' 字节' },
            { key: 'UTF-8 解码', value: info.utf8.ok ? '「' + info.utf8.text + '」' : '不可解码（' + info.utf8.reason + '）' }
          ]
        ));
      }

      function run() {
        var text = input.value;
        if (!text.trim()) {
          output.setText('');
          details.textContent = '';
          message.show('请输入待转换的整数', 'warn');
          return;
        }
        try {
          var from = radixOf(fromSelect);
          var to = Number(toSelect.value);
          var info = describe(text, from);
          output.setText(withPrefix(convert(text, from, to), to));
          message.show('转换完成：' + info.decimal + '（' + info.bitLength + ' 位 / ' + info.byteLength + ' 字节）', 'ok');
          renderDetails(info);
        } catch (error) {
          output.setText('');
          details.textContent = '';
          message.show('转换失败：' + ((error && error.message) || error), 'error');
        }
      }

      root.appendChild(ui.grid(
        ui.field('待转换的数', input),
        ui.field('源进制', fromSelect),
        ui.field('目标进制', toSelect)
      ));
      root.appendChild(ui.row(
        ui.button('转换', run),
        ui.button('清空', function () {
          input.value = '';
          output.setText('');
          details.textContent = '';
          message.clear();
        }, 'danger'),
        ui.spacer(),
        ui.copyButton(function () { return output.textContent; })
      ));
      root.appendChild(message);
      root.appendChild(output);
      root.appendChild(details);
      root.appendChild(ui.hint('自动识别 0x / 0b / 0o 前缀；全程 BigInt，超过 2^53 不会丢精度。'))
      run();
    }
  });
})(GN);
