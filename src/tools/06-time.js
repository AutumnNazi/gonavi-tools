/* 时间戳工具：时间戳与日期字符串互转。
   日期字符串一律按本地时区解析，规避 new Date('2024-01-01') 被当成 UTC 零点的经典陷阱；
   时间戳按位数自动识别秒 / 毫秒，也可以手动指定。 */
(function (GN) {
  'use strict';

  var DEFAULT_PATTERN = 'yyyy-MM-dd HH:mm:ss';
  var BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;   // 北京时间固定 UTC+8，不跟随本机时区
  var MAX_MS = 8.64e15;                          // Date 能表示的毫秒上限（约公元 275760 年）
  var TOKEN = /yyyy|MM|dd|HH|mm|ss|SSS/g;
  // 只认无时区信息的本地写法；带 Z 或 +08:00 的交给引擎按显式偏移解析
  var LOCAL_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

  function pad(value, size) {
    var text = String(value);
    while (text.length < size) { text = '0' + text; }
    return text;
  }

  function detectUnit(text) {
    var digits = String(text === null || text === undefined ? '' : text).trim().split('.')[0].replace(/[^0-9]/g, '');
    // 10 位以内按秒（可表示到公元 2286 年），11 位以上按毫秒
    return digits.length > 10 ? 'ms' : 's';
  }

  function toMilliseconds(text, unit) {
    var raw = text === null || text === undefined ? '' : String(text).trim();
    if (!/^-?\d+$/.test(raw)) { throw new Error('时间戳必须是整数，收到「' + raw + '」'); }
    var mode = unit === 's' || unit === 'ms' ? unit : detectUnit(raw);
    var result = mode === 'ms' ? Number(raw) : Number(raw) * 1000;
    if (!isFinite(result) || Math.abs(result) > MAX_MS) {
      throw new Error('时间戳超出可表示范围（毫秒上限约 8.64e15）');
    }
    return result;
  }

  function toMsValue(ms) {
    var value = typeof ms === 'number' ? ms : Number(String(ms === null || ms === undefined ? '' : ms).trim());
    if (!isFinite(value)) { throw new Error('时间戳必须是整数，收到「' + ms + '」'); }
    return value;
  }

  function fromDateString(text) {
    var source = text === null || text === undefined ? '' : String(text).trim();
    if (!source) { throw new Error('日期字符串不能为空'); }
    var matched = LOCAL_PATTERN.exec(source);
    if (matched) {
      var year = Number(matched[1]);
      var month = Number(matched[2]);
      var day = Number(matched[3]);
      var hour = matched[4] === undefined ? 0 : Number(matched[4]);
      var minute = matched[5] === undefined ? 0 : Number(matched[5]);
      var second = matched[6] === undefined ? 0 : Number(matched[6]);
      // ISO 8601 里 .5 表示 500 毫秒，所以要按三位补齐
      var milli = matched[7] === undefined ? 0 : Number((matched[7] + '00').slice(0, 3));
      if (month < 1 || month > 12) { throw new Error('月份超出 1-12：' + source); }
      if (day < 1 || day > 31) { throw new Error('日期超出 1-31：' + source); }
      if (hour > 23 || minute > 59 || second > 59) { throw new Error('时间部分超出范围：' + source); }
      var date = new Date(year, month - 1, day, hour, minute, second, milli);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        throw new Error('日期不存在：' + source);
      }
      return date.getTime();
    }
    var parsed = new Date(source).getTime();
    if (!isFinite(parsed)) {
      throw new Error('无法识别的日期格式：' + source + '（支持 yyyy-MM-dd HH:mm:ss 与 ISO 8601）');
    }
    return parsed;
  }

  function formatAt(date, pattern, utc) {
    if (isNaN(date.getTime())) { throw new Error('时间戳超出可表示范围'); }
    function read(name) { return utc ? date['getUTC' + name]() : date['get' + name](); }
    var source = pattern === undefined || pattern === null || pattern === '' ? DEFAULT_PATTERN : String(pattern);
    return source.replace(TOKEN, function (token) {
      if (token === 'yyyy') { return pad(read('FullYear'), 4); }
      if (token === 'MM') { return pad(read('Month') + 1, 2); }
      if (token === 'dd') { return pad(read('Date'), 2); }
      if (token === 'HH') { return pad(read('Hours'), 2); }
      if (token === 'mm') { return pad(read('Minutes'), 2); }
      if (token === 'ss') { return pad(read('Seconds'), 2); }
      return pad(read('Milliseconds'), 3);
    });
  }

  function formatDate(ms, pattern) {
    return formatAt(new Date(toMsValue(ms)), pattern, false);
  }

  function formatAll(ms) {
    var value = toMsValue(ms);
    var date = new Date(value);
    if (isNaN(date.getTime())) { throw new Error('时间戳超出可表示范围'); }
    return {
      iso: date.toISOString(),
      local: formatAt(date, DEFAULT_PATTERN, false),
      utc: formatAt(date, DEFAULT_PATTERN, true),
      // 先按固定偏移平移再读 UTC 字段，这样北京时间与运行机器的时区无关
      beijing: formatAt(new Date(value + BEIJING_OFFSET_MS), DEFAULT_PATTERN, true)
    };
  }

  GN.register({
    id: 'time',
    group: 'time',
    title: '时间戳',
    desc: '时间戳与日期互转：本地 / UTC / 北京时间 / ISO 8601',
    api: {
      detectUnit: detectUnit,
      toMilliseconds: toMilliseconds,
      fromDateString: fromDateString,
      formatAll: formatAll,
      formatDate: formatDate
    },
    mount: function (root) {
      var ui = GN.ui;
      var message = ui.msg();
      var resultBox = ui.col();
      var nowLabel = ui.label('');
      var lastText = '';

      var stampInput = ui.input({ placeholder: '10 位秒或 13 位毫秒，例如 1704067200' });
      var unitSelect = ui.select([
        { value: 'auto', label: '自动识别' },
        { value: 's', label: '秒' },
        { value: 'ms', label: '毫秒' }
      ], 'auto');
      var dateInput = ui.input({ placeholder: 'yyyy-MM-dd HH:mm:ss 或 ISO 8601，例如 2024-01-01 08:30:00' });

      // 本机时区偏移只用于展示，不影响任何换算结果
      function zoneText() {
        var offset = -new Date().getTimezoneOffset();
        var sign = offset < 0 ? '-' : '+';
        var abs = Math.abs(offset);
        return 'UTC' + sign + pad(Math.floor(abs / 60), 2) + ':' + pad(abs % 60, 2);
      }

      function renderTable(ms, unit) {
        var all = formatAll(ms);
        var rows = [
          { name: '本地时间（本机 ' + zoneText() + '）', value: all.local },
          { name: 'UTC', value: all.utc },
          { name: '北京时间（UTC+8）', value: all.beijing },
          { name: 'ISO 8601', value: all.iso },
          { name: 'yyyy-MM-dd HH:mm:ss', value: all.local },
          { name: '识别单位', value: unit === 's' ? '秒（乘以 1000）' : '毫秒' }
        ];
        resultBox.textContent = '';
        resultBox.appendChild(ui.table(
          [{ key: 'name', title: '项目' }, { key: 'value', title: '值', mono: true }],
          rows
        ));
        lastText = rows.map(function (row) { return row.name + '：' + row.value; }).join('\n');
      }

      function convert() {
        var raw = stampInput.value.trim();
        resultBox.textContent = '';
        lastText = '';
        if (!raw) { message.clear(); return; }
        try {
          var unit = unitSelect.value === 's' || unitSelect.value === 'ms' ? unitSelect.value : detectUnit(raw);
          renderTable(toMilliseconds(raw, unitSelect.value), unit);
          message.show('转换完成', 'ok');
        } catch (error) {
          message.show('转换失败：' + String((error && error.message) || error), 'error');
        }
      }

      function fill(value, unit) {
        stampInput.value = String(value);
        unitSelect.value = unit;
        convert();
      }

      function refreshNow() {
        var now = Date.now();
        nowLabel.textContent = '当前时间戳：秒 ' + Math.floor(now / 1000) + ' ／ 毫秒 ' + now;
      }

      function parseDate() {
        try {
          var ms = fromDateString(dateInput.value);
          stampInput.value = String(ms);
          unitSelect.value = 'ms';
          convert();
          message.show('已按本地时区解析为 ' + ms + ' 毫秒', 'ok');
        } catch (error) {
          message.show('解析失败：' + String((error && error.message) || error), 'error');
        }
      }

      stampInput.addEventListener('input', convert);
      unitSelect.addEventListener('change', convert);

      root.appendChild(ui.row(
        ui.label('时间戳'), stampInput, unitSelect,
        ui.button('转换', convert, 'primary'),
        ui.button('填入当前秒', function () { fill(Math.floor(Date.now() / 1000), 's'); }),
        ui.button('填入当前毫秒', function () { fill(Date.now(), 'ms'); }),
        ui.spacer()
      ));
      root.appendChild(ui.row(
        nowLabel,
        ui.button('刷新当前时间', refreshNow),
        ui.copyButton(function () { return String(Date.now()); }, '复制当前毫秒'),
        ui.spacer()
      ));
      root.appendChild(ui.row(
        ui.label('日期字符串'), dateInput,
        ui.button('解析为时间戳', parseDate),
        ui.copyButton(function () { return lastText; }, '复制结果'),
        ui.spacer()
      ));
      root.appendChild(message);
      root.appendChild(resultBox);
      root.appendChild(ui.hint('时间戳按位数识别：10 位以内当秒，11 位以上当毫秒，也可以手动指定。' +
        '日期字符串按本地时区解析，所以 2024-01-01 就是本机 1 月 1 日 0 点，不会被当成 UTC 零点；' +
        '带 Z 或 +08:00 这类显式偏移的写法按偏移计算。北京时间固定按 UTC+8 显示，与本机时区无关。'));

      refreshNow();
    }
  });
})(GN);