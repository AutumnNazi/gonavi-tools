/* 字节与编码基础：UTF-8、十六进制、Base64。零依赖，浏览器与 Node 通用。 */
(function (GN) {
  'use strict';

  var HEX = '0123456789abcdef';

  function utf8Encode(text) {
    return new TextEncoder().encode(String(text));
  }

  // fatal 模式：非法 UTF-8 直接抛错，避免静默替换成 U+FFFD 造成"看起来成功"。
  function utf8Decode(bytes) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += HEX[(bytes[i] >> 4) & 15] + HEX[bytes[i] & 15];
    }
    return out;
  }

  function fromHex(text) {
    var clean = String(text).replace(/[^0-9a-fA-F]/g, '');
    if (clean.length % 2 !== 0) { throw new Error('十六进制长度必须是偶数'); }
    var out = new Uint8Array(clean.length / 2);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
  }

  // 分块拼接，避免大输入触发 btoa 的栈溢出。
  function toBase64(bytes) {
    var chunk = 8192;
    var binary = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    var binary = atob(String(text).replace(/\s+/g, ''));
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) { out[i] = binary.charCodeAt(i); }
    return out;
  }

  function toBase64Url(bytes) {
    return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    var normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) { normalized += '='; }
    return fromBase64(normalized);
  }

  GN.lib.bytes = {
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    toHex: toHex,
    fromHex: fromHex,
    toBase64: toBase64,
    fromBase64: fromBase64,
    toBase64Url: toBase64Url,
    fromBase64Url: fromBase64Url
  };
})(GN);
