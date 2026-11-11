/* Cron 解析：把表达式拆成五个字段、给出中文描述与接下来 10 次执行时间。
   解析与推算全部复用 GN.lib.cron（纯逻辑层），本文件只做界面与错误提示；
   api 里的包装一律 try/catch，非法表达式只提示不抛异常。 */
(function (GN) {
  'use strict';

  var cron = GN.lib.cron;
  var RUN_COUNT = 10;
  var WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var TEMPLATES = [
    { label: '每 30 秒', expr: '*/30 * * * * *' },
    { label: '每天 9 点整（含秒）', expr: '0 0 9 * * *' },
    { label: '每分钟', expr: '* * * * *' },
    { label: '每 5 分钟', expr: '*/5 * * * *' },
    { label: '每小时整点', expr: '0 * * * *' },
    { label: '每天 0 点', expr: '0 0 * * *' },
    { label: '每周一 9 点', expr: '0 9 * * 1' },
    { label: '每月 1 号 0 点', expr: '0 0 1 * *' }
  ];

  function pad(value) { return (value < 10 ? '0' : '') + value; }

  function formatLocal(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function zoneText() {
    var offset = -new Date().getTimezoneOffset();
    var sign = offset < 0 ? '-' : '+';
    var abs = Math.abs(offset);
    return 'UTC' + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  function text(error) { return String((error && error.message) || error); }

  // 给单测用的纯函数：非法表达式返回空数组而不是抛异常
  function fieldRows(expr) {
    var fields;
    try { fields = cron.parse(expr); } catch (error) { return []; }
    return fields.map(function (field) {
      return { name: field.name, raw: field.raw, text: field.text };
    });
  }

  GN.register({
    id: 'cron',
    group: 'time',
    title: 'Cron 解析',
    desc: '拆解 5 段（crontab）或 6 段（Quartz / Spring）表达式',
    api: {
      validate: function (expr) { return cron.validate(expr); },
      parse: function (expr) {
        try { return cron.parse(expr); } catch (error) { return null; }
      },
      describe: function (expr) {
        try { return cron.describe(expr); } catch (error) { return '表达式无效：' + text(error); }
      },
      nextRuns: function (expr, count, fromDate) {
        try { return cron.nextRuns(expr, count, fromDate); } catch (error) { return []; }
      },
      fieldRows: fieldRows,
      templates: TEMPLATES
    },
    mount: function (root) {
      var ui = GN.ui;
      var input = ui.input({
        placeholder: '5 段：0 9 * * 1-5 ｜ 6 段（含秒）：0 0 9 * * 1-5',
        value: '0 0 9 * * 1-5'
      });
      var message = ui.msg();
      var descOut = ui.output();
      var fieldBox = ui.col();
      var runBox = ui.col();
      var runTitle = ui.label('接下来 ' + RUN_COUNT + ' 次执行时间（本地时区 ' + zoneText() + '）');

      function render() {
        var expr = input.value.trim();
        fieldBox.textContent = '';
        runBox.textContent = '';
        descOut.setText('');
        if (!expr) { message.clear(); return; }
        var checked = cron.validate(expr);
        if (!checked.ok) {
          message.show('表达式无效：' + checked.message, 'error');
          return;
        }
        message.show('表达式合法', 'ok');
        fieldBox.appendChild(ui.table(
          [{ key: 'name', title: '字段' }, { key: 'raw', title: '原始值', mono: true }, { key: 'text', title: '中文含义' }],
          fieldRows(expr)
        ));
        descOut.setText(cron.describe(expr));
        var runs;
        try {
          runs = cron.nextRuns(expr, RUN_COUNT);
        } catch (error) {
          runs = [];
          message.show(text(error), 'warn');
        }
        if (!runs.length) {
          runBox.appendChild(ui.hint('找不到后续执行时间：这个表达式可能永远不会命中。'));
          return;
        }
        runBox.appendChild(ui.table(
          [{ key: 'index', title: '#' }, { key: 'time', title: '本地时间', mono: true }, { key: 'week', title: '星期' }],
          runs.map(function (date, index) {
            return { index: index + 1, time: formatLocal(date), week: WEEK_NAMES[date.getDay()] };
          })
        ));
      }

      var templateRow = ui.row(ui.label('常用模板'));
      TEMPLATES.forEach(function (item) {
        templateRow.appendChild(ui.button(item.label, function () {
          input.value = item.expr;
          render();
        }));
      });

      input.addEventListener('input', render);

      root.appendChild(ui.row(
        ui.label('表达式'), input,
        ui.button('解析', render),
        ui.copyButton(function () { return input.value; }, '复制表达式'),
        ui.spacer()
      ));
      root.appendChild(templateRow);
      root.appendChild(message);
      root.appendChild(ui.label('中文描述'));
      root.appendChild(descOut);
      root.appendChild(ui.label('字段拆解'));
      root.appendChild(ui.scroll(fieldBox));
      root.appendChild(runTitle);
      root.appendChild(ui.scroll(runBox));
      root.appendChild(ui.hint('5 段与 6 段按字段个数识别；支持 * , - / 与月份、星期的英文名，? 等同 *。L / W / # 与年份会报错。'))

      render();
    }
  });
})(GN);