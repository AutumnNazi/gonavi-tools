/* UUID / 随机串工具：批量 UUID v4、NanoID 风格短随机串、随机十六进制串。
   随机源按注入方式设计（api 的 random 参数就是 () => [0,1)），界面默认取宿主内建随机数
   发生器，取不到时退回 Math.random 并在界面上明确标注「降级为伪随机」，
   避免把伪随机当真随机用（生成令牌、密钥这类场景必须知道自己在用什么）。 */
(function (GN) {
  'use strict';

  var HEX = '0123456789abcdef';
  // NanoID 默认字符表（64 个 URL 安全字符），与上游 nanoid 的取值分布保持一致。
  var NANOID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  var NANOID_DEFAULT_SIZE = 21;
  var HEX_BYTE_DEFAULT = 16;
  var LIMITS = { countMin: 1, countMax: 1000, sizeMin: 1, sizeMax: 512, uuidBytes: 16 };
  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function isInt(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
  }

  function textOf(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  // 把 [0,1) 的随机值映射到 0..size-1；注入函数若返回闭区间上界 1，夹紧而不是越界。
  function pickIndex(value, size) {
    var index = Math.floor(Number(value) * size);
    if (!(index >= 0)) { return 0; }
    return index >= size ? size - 1 : index;
  }

  function hostCrypto() {
    var host = typeof globalThis !== 'undefined' ? globalThis : null;
    return host && host.crypto ? host.crypto : null;
  }

  /* 随机源工厂：cryptoLike 提供 getRandomValues 才算真随机，否则降级并打标记。
     真随机路径按 64 个 32 位整数一批取数，避免每个字节都进一次宿主调用。 */
  function createSource(cryptoLike) {
    if (!cryptoLike || typeof cryptoLike.getRandomValues !== 'function') {
      return { next: function () { return Math.random(); }, degraded: true, label: 'Math.random' };
    }
    var pool = new Uint32Array(64);
    var index = pool.length;
    return {
      next: function () {
        if (index >= pool.length) { cryptoLike.getRandomValues(pool); index = 0; }
        return pool[index++] / 4294967296;
      },
      degraded: false,
      label: '内建随机数发生器'
    };
  }

  var defaultSource = null;
  function ensureDefaultSource() {
    if (!defaultSource) { defaultSource = createSource(hostCrypto()); }
    return defaultSource;
  }

  // 没注入随机函数时用默认随机源；注入了就直接用，保证批量生成共享同一条序列。
  function sourceOf(random) {
    return typeof random === 'function' ? random : ensureDefaultSource().next;
  }

  function isUuidV4(text) {
    return UUID_PATTERN.test(textOf(text).toLowerCase());
  }

  function uuidV4(random) {
    var next = sourceOf(random);
    var bytes = [];
    for (var i = 0; i < LIMITS.uuidBytes; i++) { bytes.push(pickIndex(next(), 256)); }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;  // 版本位固定为 4（随机版本）
    bytes[8] = (bytes[8] & 0x3f) | 0x80;  // 变体位固定为 10xx（RFC 4122）

    var hex = '';
    for (i = 0; i < LIMITS.uuidBytes; i++) {
      hex += HEX.charAt((bytes[i] >> 4) & 15) + HEX.charAt(bytes[i] & 15);
    }
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) +
      '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function uuidV4Batch(count, random) {
    var total = count === undefined || count === null || count === '' ? 1 : Number(count);
    if (!isInt(total) || total < LIMITS.countMin || total > LIMITS.countMax) {
      throw new Error('数量必须是 ' + LIMITS.countMin + '..' + LIMITS.countMax + ' 的整数');
    }
    var next = sourceOf(random);
    var list = [];
    for (var i = 0; i < total; i++) { list.push(uuidV4(next)); }
    return list;
  }

  function nanoid(size, random) {
    var length = size === undefined || size === null || size === '' ? NANOID_DEFAULT_SIZE : Number(size);
    if (!isInt(length) || length < LIMITS.sizeMin || length > LIMITS.sizeMax) {
      throw new Error('随机串长度必须是 ' + LIMITS.sizeMin + '..' + LIMITS.sizeMax + ' 的整数');
    }
    var next = sourceOf(random);
    var out = '';
    for (var i = 0; i < length; i++) {
      out += NANOID_ALPHABET.charAt(pickIndex(next(), NANOID_ALPHABET.length));
    }
    return out;
  }

  function randomHex(bytes, random) {
    var count = bytes === undefined || bytes === null || bytes === '' ? HEX_BYTE_DEFAULT : Number(bytes);
    if (!isInt(count) || count < LIMITS.sizeMin || count > LIMITS.sizeMax) {
      throw new Error('字节数必须是 ' + LIMITS.sizeMin + '..' + LIMITS.sizeMax + ' 的整数');
    }
    var next = sourceOf(random);
    var out = '';
    for (var i = 0; i < count; i++) {
      out += HEX.charAt(pickIndex(next(), 16)) + HEX.charAt(pickIndex(next(), 16));
    }
    return out;
  }

  // 展示用的整形：去连字符、转大写只影响呈现，不改变随机结果本身。
  function shapeUuid(text, options) {
    var value = textOf(text);
    if (options && options.hyphens === false) { value = value.replace(/-/g, ''); }
    if (options && options.upper === true) { value = value.toUpperCase(); }
    return value;
  }

  GN.register({
    id: 'uuid',
    group: 'misc',
    title: 'UUID / 随机串',
    desc: '批量 UUID v4 / NanoID 风格随机串 / 随机十六进制',
    api: {
      uuidV4: uuidV4,
      uuidV4Batch: uuidV4Batch,
      nanoid: nanoid,
      randomHex: randomHex,
      shapeUuid: shapeUuid,
      isUuidV4: isUuidV4,
      createSource: createSource,
      hostCrypto: hostCrypto,
      NANOID_ALPHABET: NANOID_ALPHABET,
      LIMITS: LIMITS
    },
    mount: function (root) {
      var ui = GN.ui;
      var source = createSource(hostCrypto());
      var options = { upper: false, hyphens: true };

      var countInput = ui.input({ type: 'number', value: '10', placeholder: '1..1000' });
      var sizeInput = ui.input({ type: 'number', value: String(NANOID_DEFAULT_SIZE), placeholder: '1..512' });
      var hexInput = ui.input({ type: 'number', value: String(HEX_BYTE_DEFAULT), placeholder: '1..512' });
      var upperCheck = ui.checkbox('大写', false, function () { options.upper = this.checked; });
      var hyphenCheck = ui.checkbox('去连字符', false, function () { options.hyphens = !this.checked; });

      var message = ui.msg();
      var output = ui.output();

      function show(text, label) {
        output.setText(text);
        message.show(label, 'ok');
      }

      function fail(error) {
        output.setText('');
        message.show('生成失败：' + ((error && error.message) || error), 'error');
      }

      function generateUuid() {
        try {
          var list = uuidV4Batch(Number(countInput.value), source.next).map(function (item) {
            return shapeUuid(item, options);
          });
          show(list.join('\n'), '已生成 ' + list.length + ' 个 UUID v4');
        } catch (error) { fail(error); }
      }

      function generateNanoid() {
        try {
          var value = nanoid(Number(sizeInput.value), source.next);
          show(value, '已生成 ' + value.length + ' 位 NanoID 随机串');
        } catch (error) { fail(error); }
      }

      function generateHex() {
        try {
          var value = randomHex(Number(hexInput.value), source.next);
          if (options.upper) { value = value.toUpperCase(); }
          show(value, '已生成 ' + (value.length / 2) + ' 字节随机十六进制');
        } catch (error) { fail(error); }
      }

      root.appendChild(ui.grid(
        ui.field('UUID 数量（1..1000）', countInput),
        ui.field('NanoID 长度（1..512）', sizeInput),
        ui.field('随机十六进制字节数（1..512）', hexInput)
      ));
      root.appendChild(ui.row(
        ui.button('生成 UUID v4', generateUuid),
        ui.button('生成 NanoID 随机串', generateNanoid),
        ui.button('生成随机十六进制', generateHex),
        ui.spacer(),
        ui.copyButton(function () { return output.textContent; })
      ));
      root.appendChild(ui.row(
        upperCheck,
        hyphenCheck,
        ui.spacer(),
        ui.badge(source.degraded ? '降级为伪随机' : '内建强随机', source.degraded ? 'error' : 'ok')
      ));
      root.appendChild(message);
      root.appendChild(output);
      root.appendChild(ui.hint('宿主未提供随机源时会降级为伪随机，不要用于密钥或令牌。'))
    }
  });
})(GN);
