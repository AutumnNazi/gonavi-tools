/* 颜色转换工具：解析 HEX / rgb() / rgba() / hsl() / hsla()，输出全套表示法，
   带色块预览与按相对亮度（WCAG）算出的可读性提示。
   解析一律先归一化成 { r, g, b, a }，所有输出都从这一份数据派生，保证各种格式互相一致。 */
(function (GN) {
  'use strict';

  var HEX_DIGITS = '0123456789abcdef';
  var DARK_TEXT_LUMINANCE = 0.179;  // 高于该亮度用深色文字更清楚（WCAG 常用分界）

  function textOf(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function dup(ch) {
    return parseInt(ch + ch, 16);
  }

  function byteHex(value) {
    var n = Math.round(value);
    if (n < 0) { n = 0; }
    if (n > 255) { n = 255; }
    return HEX_DIGITS.charAt((n >> 4) & 15) + HEX_DIGITS.charAt(n & 15);
  }

  function clampByte(value) {
    var n = Math.round(Number(value));
    if (!(n >= 0)) { return 0; }
    return n > 255 ? 255 : n;
  }

  function clampAlpha(value) {
    var n = Number(value);
    if (!(n >= 0)) { return 0; }
    return n > 1 ? 1 : n;
  }

  function parseHex(source) {
    var body = source.charAt(0) === '#' ? source.slice(1) : source;
    if (!/^[0-9a-fA-F]+$/.test(body)) { throw new Error('十六进制颜色含有非法字符：' + source); }

    var r, g, b, a = 1;
    if (body.length === 3 || body.length === 4) {
      r = dup(body.charAt(0));
      g = dup(body.charAt(1));
      b = dup(body.charAt(2));
      if (body.length === 4) { a = dup(body.charAt(3)) / 255; }
    } else if (body.length === 6 || body.length === 8) {
      r = parseInt(body.slice(0, 2), 16);
      g = parseInt(body.slice(2, 4), 16);
      b = parseInt(body.slice(4, 6), 16);
      if (body.length === 8) { a = parseInt(body.slice(6, 8), 16) / 255; }
    } else {
      throw new Error('十六进制颜色必须是 3 / 4 / 6 / 8 位，实际 ' + body.length + ' 位');
    }
    return { r: r, g: g, b: b, a: a };
  }

  // 逗号、空格、斜杠都当作参数分隔符，兼容 rgb(1, 2, 3) 与 rgb(1 2 3 / 50%)。
  function splitArgs(body) {
    return textOf(body).trim().split(/[,\s\/]+/).filter(function (item) { return item !== ''; });
  }

  function readChannel(token, label) {
    var percent = token.charAt(token.length - 1) === '%';
    var raw = percent ? token.slice(0, -1) : token;
    var value = Number(raw);
    if (raw === '' || !isNumber(value)) { throw new Error(label + '不是数字：' + token); }
    var result = percent ? Math.round(value * 255 / 100) : Math.round(value);
    if (result < 0 || result > 255) { throw new Error(label + '必须在 0..255 之间（也可用 0%..100%）'); }
    return result;
  }

  function readPercent(token, label) {
    var raw = token.charAt(token.length - 1) === '%' ? token.slice(0, -1) : token;
    var value = Number(raw);
    if (raw === '' || !isNumber(value)) { throw new Error(label + '不是数字：' + token); }
    if (value < 0 || value > 100) { throw new Error(label + '必须在 0..100% 之间'); }
    return value;
  }

  function readAlpha(token) {
    var percent = token.charAt(token.length - 1) === '%';
    var raw = percent ? token.slice(0, -1) : token;
    var value = Number(raw);
    if (raw === '' || !isNumber(value)) { throw new Error('透明度不是数字：' + token); }
    if (percent) { value = value / 100; }
    if (value < 0 || value > 1) { throw new Error('透明度必须在 0..1 之间（也可用 0%..100%）'); }
    return value;
  }

  function readHue(token) {
    var raw = textOf(token).replace(/deg$/i, '');
    var value = Number(raw);
    if (raw === '' || !isNumber(value)) { throw new Error('色相不是数字：' + token); }
    return ((value % 360) + 360) % 360;
  }

  function hslToRgb(h, s, l) {
    var light = l / 100;
    var sat = s / 100;
    var c = (1 - Math.abs(2 * light - 1)) * sat;
    var hp = h / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = light - c / 2;
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }

  function rgbToHsl(color) {
    var r = color.r / 255, g = color.g / 255, b = color.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var light = (max + min) / 2;
    var delta = max - min;
    var h = 0, s = 0;
    if (delta !== 0) {
      s = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      if (max === r) { h = (g - b) / delta + (g < b ? 6 : 0); }
      else if (max === g) { h = (b - r) / delta + 2; }
      else { h = (r - g) / delta + 4; }
      h = h * 60;
    }
    return { h: h, s: s * 100, l: light * 100 };
  }

  // h/s/l 保留最多 1 位小数：整数百分比会把通道最多挪动 4 个色阶（实测 #f5ef03 这类高饱和色），
  // 一位小数把偏差压到 1 个色阶以内，常用色（如 #3399cc）仍然输出整数形式。
  function fmtHsl(value) {
    return String(Math.round(value * 10) / 10);
  }

  function parse(text) {
    var source = textOf(text).trim();
    if (!source) { throw new Error('请输入颜色，例如 #3399cc 或 rgb(51, 153, 204)'); }
    if (source.charAt(0) === '#' || /^[0-9a-fA-F]{3,8}$/.test(source)) { return parseHex(source); }

    var call = /^([a-zA-Z]+)\s*\(([\s\S]*)\)$/.exec(source);
    if (!call) { throw new Error('无法识别的颜色格式：' + source); }
    var name = call[1].toLowerCase();
    var parts = splitArgs(call[2]);

    if (name === 'rgb' || name === 'rgba') {
      var expected = name === 'rgba' ? 4 : 3;
      if (parts.length !== expected) {
        throw new Error(name + '() 需要 ' + expected + ' 个参数，实际收到 ' + parts.length + ' 个');
      }
      return {
        r: readChannel(parts[0], '红色分量'),
        g: readChannel(parts[1], '绿色分量'),
        b: readChannel(parts[2], '蓝色分量'),
        a: expected === 4 ? readAlpha(parts[3]) : 1
      };
    }
    if (name === 'hsl' || name === 'hsla') {
      var count = name === 'hsla' ? 4 : 3;
      if (parts.length !== count) {
        throw new Error(name + '() 需要 ' + count + ' 个参数，实际收到 ' + parts.length + ' 个');
      }
      var rgb = hslToRgb(readHue(parts[0]), readPercent(parts[1], '饱和度'), readPercent(parts[2], '亮度'));
      return {
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        a: count === 4 ? readAlpha(parts[3]) : 1
      };
    }
    throw new Error('不支持的颜色函数：' + call[1] + '()');
  }

  // 内部统一入口：字符串走解析，已经是颜色对象时只做范围校验。
  function asColor(input) {
    if (input && typeof input === 'object') {
      var r = Number(input.r), g = Number(input.g), b = Number(input.b);
      if (!isNumber(r) || !isNumber(g) || !isNumber(b) ||
        r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
        throw new Error('RGB 分量必须是 0..255 的数字');
      }
      var a = input.a === undefined || input.a === null ? 1 : Number(input.a);
      if (!isNumber(a) || a < 0 || a > 1) { throw new Error('透明度必须在 0..1 之间'); }
      return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: a };
    }
    return parse(input);
  }

  function formatAlpha(a) {
    return String(Math.round(a * 1000) / 1000);
  }

  function toHex(color) {
    var c = asColor(color);
    var base = '#' + byteHex(c.r) + byteHex(c.g) + byteHex(c.b);
    return c.a >= 1 ? base : base + byteHex(c.a * 255);
  }

  function toRgb(color) {
    var c = asColor(color);
    return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
  }

  function toRgba(color) {
    var c = asColor(color);
    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + formatAlpha(c.a) + ')';
  }

  function toHsl(color) {
    var hsl = rgbToHsl(asColor(color));
    return 'hsl(' + fmtHsl(hsl.h) + ', ' + fmtHsl(hsl.s) + '%, ' + fmtHsl(hsl.l) + '%)';
  }

  function toHsla(color) {
    var c = asColor(color);
    var hsl = rgbToHsl(c);
    return 'hsla(' + fmtHsl(hsl.h) + ', ' + fmtHsl(hsl.s) + '%, ' + fmtHsl(hsl.l) + '%, ' + formatAlpha(c.a) + ')';
  }

  function formatAll(text) {
    var c = parse(text);
    return {
      hex: toHex(c),
      rgb: toRgb(c),
      rgba: toRgba(c),
      hsl: toHsl(c),
      hsla: toHsla(c)
    };
  }

  function srgbChannel(value) {
    var v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function luminance(color) {
    var c = asColor(color);
    return 0.2126 * srgbChannel(c.r) + 0.7152 * srgbChannel(c.g) + 0.0722 * srgbChannel(c.b);
  }

  function contrastRatio(lumA, lumB) {
    var high = Math.max(lumA, lumB);
    var low = Math.min(lumA, lumB);
    return (high + 0.05) / (low + 0.05);
  }

  function readability(color) {
    var lum = luminance(color);
    var withWhiteText = contrastRatio(1, lum);
    var withBlackText = contrastRatio(0, lum);
    var darkText = lum > DARK_TEXT_LUMINANCE;
    var contrast = darkText ? withBlackText : withWhiteText;
    var level = contrast >= 7 ? 'AAA' : contrast >= 4.5 ? 'AA' : contrast >= 3 ? 'AA（大号文字）' : '不达标';
    return {
      luminance: lum,
      withWhiteText: withWhiteText,
      withBlackText: withBlackText,
      darkText: darkText,
      textColor: darkText ? '深色文字' : '浅色文字',
      sample: darkText ? '#1f2937' : '#ffffff',
      contrast: contrast,
      level: level
    };
  }

  function randomColor(random) {
    var next = typeof random === 'function' ? random : Math.random;
    return {
      r: clampByte(next() * 256),
      g: clampByte(next() * 256),
      b: clampByte(next() * 256),
      a: 1
    };
  }

  GN.register({
    id: 'color',
    group: 'misc',
    title: '颜色转换',
    desc: 'HEX / RGB(A) / HSL(A) 互转 + 色块预览与可读性提示',
    api: {
      parse: parse,
      toHex: toHex,
      toRgb: toRgb,
      toRgba: toRgba,
      toHsl: toHsl,
      toHsla: toHsla,
      formatAll: formatAll,
      luminance: luminance,
      readability: readability,
      contrastRatio: contrastRatio,
      randomColor: randomColor
    },
    mount: function (root) {
      var ui = GN.ui;
      var lastText = '';

      var swatch = ui.badge('—');
      swatch.setAttribute('style', 'padding:3px 12px');
      var readout = ui.hint('等待颜色…');
      var message = ui.msg();
      var output = ui.output();
      var input = ui.input({ value: '#3399cc', oninput: run });

      function paint(all) {
        var info = readability(all.hex);
        swatch.textContent = all.hex;
        swatch.setAttribute('style', 'padding:3px 12px;background:' + all.hex +
          ';color:' + info.sample + ';border-color:' + all.hex);
        readout.textContent = '相对亮度 ' + info.luminance.toFixed(3) +
          ' · 建议 ' + info.textColor + '（' + info.sample + '）' +
          ' · 对比度 ' + info.contrast.toFixed(2) + '，等级 ' + info.level;
      }

      function clear() {
        lastText = '';
        output.setText('');
        readout.textContent = '';
        swatch.textContent = '—';
        swatch.setAttribute('style', 'padding:3px 12px');
      }

      function run() {
        try {
          var all = formatAll(input.value);
          lastText = ['HEX  ' + all.hex, 'RGB  ' + all.rgb, 'RGBA ' + all.rgba, 'HSL  ' + all.hsl, 'HSLA ' + all.hsla].join('\n');
          output.setText(lastText);
          paint(all);
          message.show('解析成功', 'ok');
        } catch (error) {
          clear();
          message.show('解析失败：' + ((error && error.message) || error), 'error');
        }
      }

      root.appendChild(ui.row(
        ui.label('颜色'),
        input,
        ui.button('转换', run, 'primary'),
        ui.button('随机颜色', function () {
          input.value = toHex(randomColor());
          run();
        }),
        ui.spacer(),
        ui.copyButton(function () { return lastText; })
      ));
      root.appendChild(ui.row(swatch, readout, ui.spacer()));
      root.appendChild(message);
      root.appendChild(output);
      root.appendChild(ui.hint('支持 #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba() / hsl() / hsla()，' +
        '其中十六进制的 alpha 为两位（如 #3399cc80 表示半透明）。' +
        '可读性按相对亮度（WCAG）计算：亮度高于 0.179 建议用深色文字，否则用浅色文字。'));
      run();
    }
  });
})(GN);
