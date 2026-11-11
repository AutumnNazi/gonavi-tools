/* MD5（RFC 1321）纯 JS 实现：入参 Uint8Array，返回小写十六进制字符串。
   不依赖宿主 WebCrypto，页面不透明源沙箱内也能独立运行；轮常量按 RFC 定值硬编码。 */
(function (GN) {
  'use strict';

  // 每轮的循环左移位数（第 1/2/3/4 轮各 16 次）
  var SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  // K[j] = floor(abs(sin(j + 1)) * 2^32)，写成定值避免运行期浮点差异
  var K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];

  var HEX = '0123456789abcdef';

  function toBytes(input) {
    if (input instanceof Uint8Array) { return input; }
    if (Array.isArray(input)) { return new Uint8Array(input); }
    throw new Error('MD5 入参必须是 Uint8Array');
  }

  // 分组填充：补 0x80，补 0 到 56 字节余数，最后 8 字节写比特长度（小端）
  function fill(data) {
    var blocks = ((data.length + 8) >> 6) + 1;
    var out = new Uint8Array(blocks * 64);
    out.set(data);
    out[data.length] = 0x80;
    var bits = data.length * 8;
    var low = bits >>> 0;
    var high = Math.floor(bits / 4294967296);
    var tail = blocks * 64 - 8;
    out[tail] = low & 255;
    out[tail + 1] = (low >>> 8) & 255;
    out[tail + 2] = (low >>> 16) & 255;
    out[tail + 3] = (low >>> 24) & 255;
    out[tail + 4] = high & 255;
    out[tail + 5] = (high >>> 8) & 255;
    out[tail + 6] = (high >>> 16) & 255;
    out[tail + 7] = (high >>> 24) & 255;
    return out;
  }

  function wordsToHex(words) {
    var hex = '';
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      for (var byteIndex = 0; byteIndex < 4; byteIndex++) {
        var byte = (word >>> (byteIndex * 8)) & 255;
        hex += HEX[(byte >> 4) & 15] + HEX[byte & 15];
      }
    }
    return hex;
  }

  function md5(input) {
    var data = toBytes(input);
    var buffer = fill(data);
    var m = new Int32Array(16);

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    for (var offset = 0; offset < buffer.length; offset += 64) {
      for (var i = 0; i < 16; i++) {
        var at = offset + i * 4;
        m[i] = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16) | (buffer[at + 3] << 24);
      }

      var a = a0, b = b0, c = c0, d = d0;
      for (var j = 0; j < 64; j++) {
        var f, g;
        if (j < 16) { f = (b & c) | (~b & d); g = j; }
        else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
        else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * j) % 16; }

        var sum = (a + f + K[j] + m[g]) | 0;
        var shift = SHIFTS[j];
        a = d;
        d = c;
        c = b;
        b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      }

      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    return wordsToHex([a0, b0, c0, d0]);
  }

  GN.lib.md5 = md5;
})(GN);
