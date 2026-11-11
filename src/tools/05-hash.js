/* 哈希工具：一次算出文本的 MD5 / SHA-1 / SHA-256，支持逐个复制与「粘贴哈希值反查算法」。
   算法全部是自研纯 JS（src/lib/md5.js、sha1.js、sha256.js），不用宿主 WebCrypto；
   文本统一先经 GN.lib.bytes.utf8Encode 转 UTF-8 字节，因此中文、emoji 与其它工具口径一致。
   match() 返回的算法名用小写 id（md5 / sha1 / sha256），与 hashesOfText() 的键名对应，界面再映射成显示名。 */
(function (GN) {
  'use strict';

  var ALGORITHMS = [
    { id: 'md5', label: 'MD5', bytes: function (bytes) { return GN.lib.md5(bytes); } },
    { id: 'sha1', label: 'SHA-1', bytes: function (bytes) { return GN.lib.sha1(bytes); } },
    { id: 'sha256', label: 'SHA-256', bytes: function (bytes) { return GN.lib.sha256(bytes); } }
  ];

  var HASH_LENGTHS = { '32': 'MD5', '40': 'SHA-1', '64': 'SHA-256' };

  // 沙箱与 iframe 里的 TextEncoder 由宿主注入，它产出的 Uint8Array 属于另一个 realm，
  // 过不了 lib 内部 instanceof 的品牌检查（会报"入参必须是 Uint8Array"）。
  // 这里先复制成本 realm 的 Uint8Array 再交给 lib，跨 realm 的字节也能正常参与计算。
  function toBytes(input) {
    if (input instanceof Uint8Array) { return input; }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(input) &&
        input.BYTES_PER_ELEMENT === 1 && typeof input.length === 'number') {
      return new Uint8Array(input);
    }
    if (Array.isArray(input)) {
      var list = new Uint8Array(input.length);
      for (var i = 0; i < input.length; i++) {
        var byte = input[i];
        if (typeof byte !== 'number' || !isFinite(byte) || byte < 0 || byte > 255 || Math.floor(byte) !== byte) {
          throw new Error('哈希入参必须是 0..255 之间的整数数组，第 ' + i + ' 个元素是 ' + String(byte));
        }
        list[i] = byte;
      }
      return list;
    }
    throw new Error('哈希入参必须是 Uint8Array，实际收到 ' + (input === null ? 'null' : typeof input));
  }

  // 文本 → 本 realm 的 UTF-8 字节；mount 首次渲染、每次输入与比对都走这里。
  function encodeText(text) {
    return new Uint8Array(GN.lib.bytes.utf8Encode(textOf(text)));
  }

  function md5Hex(bytes) { return GN.lib.md5(toBytes(bytes)); }
  function sha1Hex(bytes) { return GN.lib.sha1(toBytes(bytes)); }
  function sha256Hex(bytes) { return GN.lib.sha256(toBytes(bytes)); }

  function textOf(text) {
    return text === null || text === undefined ? '' : String(text);
  }

  // 比对前的归一化：去掉所有空白（含换行、中间空格），统一小写。
  function normalize(value) {
    return textOf(value).replace(/\s+/g, '').toLowerCase();
  }

  function hashesOfText(text) {
    var bytes = encodeText(text);
    return { md5: GN.lib.md5(bytes), sha1: GN.lib.sha1(bytes), sha256: GN.lib.sha256(bytes) };
  }

  // 命中的算法 id；长度与内容都对不上时返回 null（不区分大小写、忽略空白）。
  function match(hash, text) {
    var needle = normalize(hash);
    if (!needle || !/^[0-9a-f]+$/.test(needle)) { return null; }
    var hashes = hashesOfText(text);
    for (var i = 0; i < ALGORITHMS.length; i++) {
      if (hashes[ALGORITHMS[i].id] === needle) { return ALGORITHMS[i].id; }
    }
    return null;
  }

  function labelOf(id) {
    for (var i = 0; i < ALGORITHMS.length; i++) {
      if (ALGORITHMS[i].id === id) { return ALGORITHMS[i].label; }
    }
    return id;
  }

  function looksLikeHash(value) {
    var clean = normalize(value);
    return /^[0-9a-f]+$/.test(clean) && HASH_LENGTHS[String(clean.length)] !== undefined;
  }

  GN.register({
    id: 'hash',
    group: 'hash',
    title: '哈希',
    desc: 'MD5 / SHA-1 / SHA-256 计算与比对',
    api: {
      md5Hex: md5Hex,
      sha1Hex: sha1Hex,
      sha256Hex: sha256Hex,
      hashesOfText: hashesOfText,
      match: match
    },
    mount: function (root) {
      var ui = GN.ui;

      var input = ui.textarea({
        placeholder: '粘贴要计算哈希的文本（支持中文与 emoji，可多行）…',
        tall: true,
        oninput: function () { refresh(); }
      });
      var tableBox = ui.col();
      var tableMsg = ui.msg();
      var compareInput = ui.input({
        placeholder: '粘贴一个哈希值，看它属于哪种算法',
        oninput: function () { compare(); }
      });
      var compareMsg = ui.msg();

      var current = null;

      function renderRows(hashes) {
        tableBox.textContent = '';
        var rows = ALGORITHMS.map(function (item) {
          return { algorithm: item.label, hash: hashes ? hashes[item.id] : '—' };
        });
        tableBox.appendChild(ui.table([
          { title: '算法', key: 'algorithm' },
          { title: '哈希值（小写十六进制）', key: 'hash', mono: true }
        ], rows));
      }

      function copyButtonFor(item) {
        return ui.copyButton(function () {
          return current ? current[item.id] : '';
        }, '复制 ' + item.label);
      }

      function compare() {
        var value = compareInput.value;
        if (!value || !value.replace(/\s+/g, '')) { compareMsg.clear(); return; }
        if (!looksLikeHash(value)) {
          compareMsg.show('这不是十六进制哈希：长度应为 32（MD5）、40（SHA-1）或 64（SHA-256）位', 'error');
          return;
        }
        var hit = match(value, input.value);
        if (!hit) {
          compareMsg.show('不匹配：该值不等于当前文本的 MD5 / SHA-1 / SHA-256', 'error');
          return;
        }
        compareMsg.show('匹配 ' + labelOf(hit), 'ok');
      }

      function refresh() {
        var text = input.value;
        current = hashesOfText(text);
        renderRows(current);
        if (text) {
          tableMsg.show('按 UTF-8 编码计算，共 ' + encodeText(text).length + ' 字节', 'ok');
        } else {
          tableMsg.show('当前没有输入，下面是空内容的哈希值（空内容的哈希是有效结果，不是错误）', 'warn');
        }
        compare();
      }

      root.appendChild(input);
      root.appendChild(tableBox);
      root.appendChild(ui.row(
        copyButtonFor(ALGORITHMS[0]),
        copyButtonFor(ALGORITHMS[1]),
        copyButtonFor(ALGORITHMS[2]),
        ui.spacer(),
        ui.button('清空', function () {
          input.value = '';
          compareInput.value = '';
          refresh();
          compareMsg.clear();
        }, 'danger')
      ));
      root.appendChild(tableMsg);
      root.appendChild(ui.field('比对哈希值', compareInput));
      root.appendChild(compareMsg);
      root.appendChild(ui.hint('输出小写十六进制；比对时忽略大小写与空白。SHA-1 仅建议用于兼容场景。'))

      refresh();
    }
  });
})(GN);
