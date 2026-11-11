/* Cron 核心：解析、校验、中文描述与下次执行时间推算，同时支持两种主流写法：
     - 5 段（分 时 日 月 周）：Linux crontab / Vixie，Kubernetes CronJob、Jenkins 同理
     - 6 段（秒 分 时 日 月 周）：Quartz、Spring @Scheduled 的写法
   按字段个数自动识别，5 段等价于把秒固定为 0。
   纯逻辑，不碰 DOM，页面与 Node 单测共用同一份实现（挂到 GN.lib.cron）。
   字段语法支持 * , - / ，月份可用 JAN-DEC ，星期可用 SUN-SAT ，? 等同 * ；
   L / W / # 与第 7 段年份不支持，遇到直接抛中文错误，绝不静默当成 * 处理。
   日与周都不以 * 开头时按 Vixie 的「或」语义计算：两者满足其一即执行。 */
(function (GN) {
  'use strict';

  // 字段用类型而非位置标识：5 段与 6 段里同一个位置的字段含义不同，靠类型才不会错位。
  var FIELD_SPECS = {
    second: { name: '秒', low: 0, high: 59, alias: null },
    minute: { name: '分钟', low: 0, high: 59, alias: null },
    hour: { name: '小时', low: 0, high: 23, alias: null },
    day: { name: '日', low: 1, high: 31, alias: null },
    month: { name: '月', low: 1, high: 12, alias: 'month' },
    week: { name: '星期', low: 0, high: 7, alias: 'week' }
  };
  var FIVE_FIELDS = ['minute', 'hour', 'day', 'month', 'week'];
  var SIX_FIELDS = ['second', 'minute', 'hour', 'day', 'month', 'week'];

  var MONTH_ALIAS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  var WEEK_ALIAS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  var WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
  var ALIAS_WORDS = /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT/g;
  // 搜索窗口：2 月 29 日最长间隔约 8 年（2096 → 2104），取 100 年足够覆盖任何真实排程。
  // 窗口固定，循环必然终止，不会因为表达式永不命中（如 2 月 30 日）而死循环。
  var MAX_SEARCH_DAYS = 366 * 100;

  function pad2(value) { return (value < 10 ? '0' : '') + value; }

  function fail(message) { throw new Error(message); }

  function fieldLabel(field, position) {
    return '第 ' + (position + 1) + ' 段（' + field.name + '）';
  }

  function stepOf(normalized) {
    var matched = /^\*\/(\d+)$/.exec(normalized);
    return matched ? parseInt(matched[1], 10) : 0;
  }

  /* ---------------- 取值格式化（中文描述用） ---------------- */

  function formatRanges(values) {
    var parts = [];
    var i = 0;
    while (i < values.length) {
      var j = i;
      while (j + 1 < values.length && values[j + 1] === values[j] + 1) { j++; }
      parts.push(j > i ? values[i] + '-' + values[j] : String(values[i]));
      i = j + 1;
    }
    return parts.join('、');
  }

  function weekRanges(values) {
    var parts = [];
    var i = 0;
    while (i < values.length) {
      var j = i;
      // 周日（0）不参与连续段，否则会拼出「周日到周三」这种读反的写法
      while (j + 1 < values.length && values[j] !== 0 && values[j + 1] === values[j] + 1) { j++; }
      parts.push(j > i ? '周' + WEEK_NAMES[values[i]] + '至周' + WEEK_NAMES[values[j]] : '周' + WEEK_NAMES[values[i]]);
      i = j + 1;
    }
    return parts.join('、');
  }

  function fieldText(field) {
    var step = stepOf(field.norm);
    var any = field.norm === '*';
    if (field.kind === 'second') {
      if (any) { return '每秒'; }
      if (step) { return '每 ' + step + ' 秒'; }
      return '第 ' + formatRanges(field.values) + ' 秒';
    }
    if (field.kind === 'minute') {
      if (any) { return '每分钟'; }
      if (step) { return '每 ' + step + ' 分钟'; }
      return '第 ' + formatRanges(field.values) + ' 分钟';
    }
    if (field.kind === 'hour') {
      if (any) { return '每小时'; }
      if (step) { return '每 ' + step + ' 小时'; }
      return formatRanges(field.values) + ' 点';
    }
    if (field.kind === 'day') {
      if (any) { return '每天（不限）'; }
      if (step) { return '每 ' + step + ' 天（从 1 号起）'; }
      return '每月 ' + formatRanges(field.values) + ' 日';
    }
    if (field.kind === 'month') {
      if (any) { return '每月'; }
      if (step) { return '每 ' + step + ' 个月'; }
      return '每年 ' + formatRanges(field.values) + ' 月';
    }
    if (any) { return '每天（不限）'; }
    if (step) { return '每 ' + step + ' 天（周日为起点）'; }
    return '每' + weekRanges(field.values);
  }

  /* ---------------- 解析 ---------------- */

  // 去掉合法名称后还剩字母，说明用了 L / W 这类扩展写法：直接报错，不当成 * 也不当成具体值。
  function rejectExtensions(kind, position, normalized, raw) {
    var rest = normalized.toUpperCase().replace(ALIAS_WORDS, '');
    if (!/[A-Z]/.test(rest)) { return; }
    var label = fieldLabel(FIELD_SPECS[kind], position);
    if (rest.indexOf('L') >= 0) { fail(label + '不支持 L（最后一天 / 最后一个星期几）扩展语法：' + raw); }
    if (rest.indexOf('W') >= 0) { fail(label + '不支持 W（离指定日期最近的工作日）扩展语法：' + raw); }
    // 其余字母交给取值解析，那里能报出更具体的原因（如步长必须为正整数）
  }

  function resolveNumber(kind, position, token, raw) {
    var text = String(token).toUpperCase();
    if (/^\d+$/.test(text)) { return parseInt(text, 10); }
    var alias = kind === 'month' ? MONTH_ALIAS[text] : (kind === 'week' ? WEEK_ALIAS[text] : undefined);
    if (alias !== undefined) { return alias; }
    fail(fieldLabel(FIELD_SPECS[kind], position) + '里的「' + token + '」不是合法取值：' + raw);
  }

  function collectRange(flags, kind, position, item, raw, low, high) {
    var label = fieldLabel(FIELD_SPECS[kind], position);
    var body = item;
    var step = 1;
    var slash = item.indexOf('/');
    if (slash >= 0) {
      body = item.slice(0, slash);
      if (item.indexOf('/', slash + 1) >= 0) { fail(label + '的「' + item + '」出现多个 /：' + raw); }
      var stepText = item.slice(slash + 1);
      if (!/^\d+$/.test(stepText)) { fail(label + '的步长「' + stepText + '」必须是正整数：' + raw); }
      step = parseInt(stepText, 10);
      if (step < 1) { fail(label + '的步长必须大于 0：' + raw); }
    }
    if (body === '') { fail(label + '的「' + item + '」缺少 / 左边的取值：' + raw); }
    var start;
    var end;
    if (body === '*') {
      start = low;
      end = high;
    } else {
      var dash = body.indexOf('-');
      if (dash >= 0) {
        if (body.indexOf('-', dash + 1) >= 0) { fail(label + '的范围「' + body + '」出现多个横线：' + raw); }
        start = resolveNumber(kind, position, body.slice(0, dash), raw);
        end = resolveNumber(kind, position, body.slice(dash + 1), raw);
        if (end < start) { fail(label + '的范围「' + body + '」起始值大于结束值：' + raw); }
      } else {
        start = resolveNumber(kind, position, body, raw);
        // 「N/步长」按 N 到该字段最大值处理，与常见实现保持一致
        end = slash >= 0 ? high : start;
      }
    }
    if (start < low || start > high) { fail(label + '的取值 ' + start + ' 超出 ' + low + '-' + high + '：' + raw); }
    if (end < low || end > high) { fail(label + '的取值 ' + end + ' 超出 ' + low + '-' + high + '：' + raw); }
    for (var value = start; value <= end; value += step) { flags.push(value); }
  }

  function parseField(kind, position, raw) {
    var spec = FIELD_SPECS[kind];
    // ? 等同 *：语义就是「不限」，写法沿用 Quartz 习惯
    var normalized = String(raw).replace(/\?/g, '*');
    if (!normalized) { fail(fieldLabel(spec, position) + '是空的：' + raw); }
    if (normalized.indexOf('#') >= 0) { fail(fieldLabel(spec, position) + '不支持 #（第几个星期几）扩展语法：' + raw); }
    rejectExtensions(kind, position, normalized, raw);
    var flags = [];
    normalized.split(',').forEach(function (item) {
      if (item === '') { fail(fieldLabel(spec, position) + '有多余的逗号：' + raw); }
      collectRange(flags, kind, position, item, raw, spec.low, spec.high);
    });
    var hit = [];
    flags.forEach(function (value) { hit[value] = true; });
    // 星期里 7 与 0 都是周日，统一收进 0，判定与显示用同一份数据
    if (kind === 'week' && hit[7]) { hit[0] = true; hit[7] = false; }
    var values = [];
    for (var value = spec.low; value <= spec.high; value++) { if (hit[value]) { values.push(value); } }
    var field = {
      kind: kind,
      name: spec.name,
      position: position,
      raw: String(raw),
      norm: normalized,
      // 与 Vixie cron 一致：字段以 * 开头即算「不限」，它决定日与周之间是与还是或
      star: normalized.charAt(0) === '*',
      values: values
    };
    field.text = fieldText(field);
    return field;
  }

  function parse(expr) {
    var source = expr === null || expr === undefined ? '' : String(expr);
    var trimmed = source.trim();
    if (!trimmed) { fail('表达式不能为空'); }
    var parts = trimmed.split(/\s+/);
    var kinds;
    if (parts.length === 5) { kinds = FIVE_FIELDS; }
    else if (parts.length === 6) { kinds = SIX_FIELDS; }
    else {
      fail('必须是 5 个字段（分 时 日 月 周）或 6 个字段（秒 分 时 日 月 周），当前 ' + parts.length + ' 个：' + trimmed);
    }
    var fields = parts.map(function (part, index) { return parseField(kinds[index], index, part); });
    // 数组上带一个标记，调用方据此决定时间描述的粒度
    fields.hasSeconds = parts.length === 6;
    return fields;
  }

  function indexFields(fields) {
    var by = {};
    fields.forEach(function (field) { by[field.kind] = field; });
    return by;
  }

  function validate(expr) {
    try {
      parse(expr);
      return { ok: true, message: '表达式合法' };
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error) };
    }
  }

  /* ---------------- 中文描述 ---------------- */

  function monthPhrase(field) {
    if (field.norm === '*') { return ''; }
    var step = stepOf(field.norm);
    if (step) { return '每 ' + step + ' 个月'; }
    return '每年 ' + formatRanges(field.values) + ' 月';
  }

  // scoped 为真表示月份已单独限定，日就不能再重复说「每月」
  function dayPhrase(dom, dow, scoped) {
    var domAny = dom.norm === '*';
    var dowAny = dow.norm === '*';
    if (domAny && dowAny) { return { text: '每天', any: true, note: '' }; }
    if (domAny) { return { text: '每' + weekRanges(dow.values), any: false, note: '' }; }
    var domText = (scoped ? '' : '每月 ') + formatRanges(dom.values) + ' 日';
    if (dowAny) { return { text: domText, any: false, note: '' }; }
    return {
      text: domText + '或每' + weekRanges(dow.values),
      any: false,
      note: '（日期与星期按标准 cron 的「或」语义：满足其一即执行）'
    };
  }

  function hourText(hour) {
    var step = stepOf(hour.norm);
    if (step) { return '每 ' + step + ' 小时'; }
    return formatRanges(hour.values) + ' 点';
  }

  function clockText(hours, minutes, seconds) {
    var list = [];
    for (var h = 0; h < hours.length; h++) {
      for (var m = 0; m < minutes.length; m++) {
        if (!seconds) {
          list.push(pad2(hours[h]) + ':' + pad2(minutes[m]));
          continue;
        }
        for (var s = 0; s < seconds.length; s++) {
          list.push(pad2(hours[h]) + ':' + pad2(minutes[m]) + ':' + pad2(seconds[s]));
        }
      }
    }
    if (list.length > 12) { return list.slice(0, 12).join('、') + ' 等 ' + list.length + ' 个时刻'; }
    return list.join('、');
  }

  function timePhrase(minute, hour, second) {
    var minuteAny = minute.norm === '*';
    var hourAny = hour.norm === '*';
    var minuteStep = stepOf(minute.norm);
    var hourStep = stepOf(hour.norm);
    if (minuteAny && hourAny) { return { text: '每分钟', clock: false, everyMinute: true }; }
    if (hourAny) {
      if (minuteStep) { return { text: '每 ' + minuteStep + ' 分钟', clock: false, everyMinute: false }; }
      return { text: '每小时的第 ' + formatRanges(minute.values) + ' 分钟', clock: false, everyMinute: false };
    }
    if (minuteAny) { return { text: hourText(hour) + '的每分钟', clock: false, everyMinute: false }; }
    if (hourStep && minuteStep) { return { text: '每 ' + hourStep + ' 小时的每 ' + minuteStep + ' 分钟', clock: false, everyMinute: false }; }
    if (hourStep) { return { text: '每 ' + hourStep + ' 小时的第 ' + formatRanges(minute.values) + ' 分钟', clock: false, everyMinute: false }; }
    if (minuteStep) { return { text: formatRanges(hour.values) + ' 点的每 ' + minuteStep + ' 分钟', clock: false, everyMinute: false }; }
    return {
      text: clockText(hour.values, minute.values, second ? second.values : null),
      clock: true,
      everyMinute: false
    };
  }

  // 6 段写法下把秒并进时间描述：秒固定就写进时刻，秒是范围或步长就单独说。
  function mergeSeconds(time, second) {
    if (!second) { return time; }
    var secAny = second.norm === '*';
    var secStep = stepOf(second.norm);
    if (secAny) {
      if (time.everyMinute) { return { text: '每秒', clock: false, everyMinute: true }; }
      return { text: time.text + '的每一秒', clock: false, everyMinute: time.everyMinute };
    }
    if (secStep) {
      if (time.everyMinute) { return { text: '每 ' + secStep + ' 秒', clock: false, everyMinute: false }; }
      return { text: time.text + '的每 ' + secStep + ' 秒', clock: false, everyMinute: false };
    }
    if (time.clock) {
      // 时刻里已经带了秒，text 由 clockText 生成
      return { text: time.text, clock: true, everyMinute: false };
    }
    // 秒固定为 0 时不再赘述：0 * * * * * 与 5 段写法的 * * * * * 语义相同
    if (second.values.length === 1 && second.values[0] === 0) {
      return { text: time.text, clock: false, everyMinute: time.everyMinute };
    }
    return { text: time.text + '的第 ' + formatRanges(second.values) + ' 秒', clock: false, everyMinute: false };
  }

  function describe(expr) {
    var fields = parse(expr);
    var by = indexFields(fields);
    var day = dayPhrase(by.day, by.week, by.month.norm !== '*');
    var time = mergeSeconds(timePhrase(by.minute, by.hour, by.second), by.second);
    var month = monthPhrase(by.month);
    var prefix = '';
    var dayPart = day.any ? '' : day.text + '的';
    if (month) {
      // 日部分以数字开头时留一个空格，中文与数字之间才不挤在一起
      prefix = month + '的' + (/^\d/.test(dayPart) ? ' ' : '') + dayPart;
    } else if (!day.any) { prefix = dayPart; }
    var sentence = prefix
      ? prefix + (time.clock ? ' ' : '') + time.text
      : (time.clock ? '在 ' + time.text : time.text);
    return sentence + (time.clock ? ' ' : '') + '执行' + day.note;
  }

  /* ---------------- 下次执行时间（本地时区） ---------------- */

  function nextRuns(expr, count, fromDate) {
    var fields = parse(expr);
    var by = indexFields(fields);
    var total = count === undefined || count === null ? 10 : Number(count);
    if (!isFinite(total) || Math.floor(total) !== total || total < 1) { fail('次数必须是正整数'); }
    if (total > 1000) { total = 1000; }
    var from = fromDate === undefined || fromDate === null ? new Date()
      : (fromDate instanceof Date ? fromDate : new Date(fromDate));
    if (isNaN(from.getTime())) { fail('起始时间无效'); }
    var fromTime = from.getTime();

    // 5 段写法没有秒字段，等价于只匹配第 0 秒
    var secondValues = by.second ? by.second.values : [0];
    var minuteValues = by.minute.values;
    var hourValues = by.hour.values;
    var monthValues = by.month.values;
    var dom = by.day;
    var dow = by.week;
    // 日与周都以具体值开头才算「都被限定」，此时用或；只要有一边以 * 开头，另一边单独决定结果
    var dayOrMode = !dom.star && !dow.star;

    var cachedYear = -1;
    var cachedMonth = -1;
    var cachedDays = 0;

    function daysInMonth(year, month) {
      if (year !== cachedYear || month !== cachedMonth) {
        cachedYear = year;
        cachedMonth = month;
        cachedDays = new Date(year, month, 0).getDate();
      }
      return cachedDays;
    }

    function dayMatches(year, month, day, weekDay) {
      // 「每月 31 日」遇到小月直接跳过，不能让它滚到下个月 1 号
      if (day > daysInMonth(year, month)) { return false; }
      var domHit = dom.values.indexOf(day) >= 0;
      var dowHit = dow.values.indexOf(weekDay) >= 0;
      return dayOrMode ? (domHit || dowHit) : (domHit && dowHit);
    }

    var results = [];
    var year = from.getFullYear();
    var month = from.getMonth() + 1;
    var day = from.getDate();
    var weekDay = new Date(year, month - 1, day).getDay();
    // 起始当天只取严格晚于起始时刻的点，之后的整天从头开始；按秒计，5 段写法秒恒为 0
    var cutoff = from.getHours() * 3600 + from.getMinutes() * 60 + from.getSeconds();

    for (var offset = 0; offset <= MAX_SEARCH_DAYS && results.length < total; offset++) {
      if (monthValues.indexOf(month) >= 0 && dayMatches(year, month, day, weekDay)) {
        for (var h = 0; h < hourValues.length && results.length < total; h++) {
          for (var m = 0; m < minuteValues.length && results.length < total; m++) {
            for (var s = 0; s < secondValues.length; s++) {
              if (offset === 0 && hourValues[h] * 3600 + minuteValues[m] * 60 + secondValues[s] <= cutoff) { continue; }
              var candidate = new Date(year, month - 1, day, hourValues[h], minuteValues[m], secondValues[s], 0);
              // 夏令时跳变会把不存在的本地时刻挪到别的钟点，这类时刻跳过而不是报错
              if (candidate.getHours() !== hourValues[h] || candidate.getMinutes() !== minuteValues[m] ||
                candidate.getSeconds() !== secondValues[s]) { continue; }
              if (candidate.getTime() <= fromTime) { continue; }
              results.push(candidate);
              if (results.length >= total) { break; }
            }
          }
        }
      }
      // 自己推进日月年，跨月、跨年、闰年全部由 daysInMonth 兜住
      day++;
      if (day > daysInMonth(year, month)) { day = 1; month++; if (month > 12) { month = 1; year++; } }
      weekDay = weekDay === 6 ? 0 : weekDay + 1;
    }

    if (results.length < total) {
      fail('在约 100 年内只找到 ' + results.length + ' 次执行时间（表达式可能永远不会命中，例如指定了 2 月 30 日）');
    }
    return results;
  }

  GN.lib.cron = {
    validate: validate,
    parse: parse,
    describe: describe,
    nextRuns: nextRuns
  };
})(GN);
