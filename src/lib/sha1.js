/* SHA-1（RFC 3174）纯 JS 实现：入参 Uint8Array，返回小写十六进制字符串。
   SHA-1 已不再适合签名场景，此处按需求提供：文件校验、Git 对象名等兼容用途。
   不依赖宿主 WebCrypto，页面不透明源沙箱内也能独立运行。 */
(function (GN) {
  'use strict';

  var HEX = '0123456789abcdef';

  function toBytes(input) {
    if (input instanceof Uint8Array) { return input; }
    if (Array.isArray(input)) { return new Uint8Array(input); }
    throw new Error('SHA-1 入参必须是 Uint8Array');
  }

  // 分组填充：补 0x80，补 0 到 56 字节余数，最后 8 字节写比特长度（大端）
  function fill(data) {
    var blocks = ((data.length + 8) >> 6) + 1;
    var out = new Uint8Array(blocks * 64);
    out.set(data);
    out[data.length] = 0x80;
    var bits = data.length * 8;
    var low = bits >>> 0;
    var high = Math.floor(bits / 4294967296);
    var tail = blocks * 64 - 8;
    out[tail] = (high >>> 24) & 255;
    out[tail + 1] = (high >>> 16) & 255;
    out[tail + 2] = (high >>> 8) & 255;
    out[tail + 3] = high & 255;
    out[tail + 4] = (low >>> 24) & 255;
    out[tail + 5] = (low >>> 16) & 255;
    out[tail + 6] = (low >>> 8) & 255;
    out[tail + 7] = low & 255;
    return out;
  }

  function wordsToHex(words) {
    var hex = '';
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      for (var shift = 28; shift >= 0; shift -= 4) {
        hex += HEX[(word >>> shift) & 15];
      }
    }
    return hex;
  }

  function sha1(input) {
    var data = toBytes(input);
    var buffer = fill(data);
    var w = new Int32Array(80);

    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

    for (var offset = 0; offset < buffer.length; offset += 64) {
      for (var i = 0; i < 16; i++) {
        var at = offset + i * 4;
        w[i] = (buffer[at] << 24) | (buffer[at + 1] << 16) | (buffer[at + 2] << 8) | buffer[at + 3];
      }
      for (var j = 16; j < 80; j++) {
        var mixed = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
        w[j] = (mixed << 1) | (mixed >>> 31);
      }

      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (var t = 0; t < 80; t++) {
        var f, k;
        if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }

        var temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) | 0;
        e = d;
        d = c;
        c = (b << 30) | (b >>> 2);
        b = a;
        a = temp;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
    }

    return wordsToHex([h0, h1, h2, h3, h4]);
  }

  GN.lib.sha1 = sha1;
})(GN);
