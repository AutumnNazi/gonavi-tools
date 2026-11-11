/* SHA-256（FIPS 180-4）纯 JS 实现：入参 Uint8Array，返回小写十六进制字符串。
   不依赖宿主 WebCrypto，页面不透明源沙箱内也能独立运行；K 常量按标准定值硬编码。 */
(function (GN) {
  'use strict';

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  var HEX = '0123456789abcdef';

  function toBytes(input) {
    if (input instanceof Uint8Array) { return input; }
    if (Array.isArray(input)) { return new Uint8Array(input); }
    throw new Error('SHA-256 入参必须是 Uint8Array');
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

  function rotr(value, count) {
    return (value >>> count) | (value << (32 - count));
  }

  function sha256(input) {
    var data = toBytes(input);
    var buffer = fill(data);
    var w = new Int32Array(64);

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (var offset = 0; offset < buffer.length; offset += 64) {
      for (var i = 0; i < 16; i++) {
        var at = offset + i * 4;
        w[i] = (buffer[at] << 24) | (buffer[at + 1] << 16) | (buffer[at + 2] << 8) | buffer[at + 3];
      }
      for (var j = 16; j < 64; j++) {
        var x = w[j - 15];
        var y = w[j - 2];
        var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }

      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

      for (var t = 0; t < 64; t++) {
        var upper = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var choose = (e & f) ^ (~e & g);
        var temp1 = (h + upper + choose + K[t] + w[t]) | 0;
        var lower = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var majority = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (lower + majority) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
      h5 = (h5 + f) | 0;
      h6 = (h6 + g) | 0;
      h7 = (h7 + h) | 0;
    }

    return wordsToHex([h0, h1, h2, h3, h4, h5, h6, h7]);
  }

  GN.lib.sha256 = sha256;
})(GN);
