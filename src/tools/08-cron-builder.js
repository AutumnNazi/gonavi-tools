/* Cron 生成：五个字段各一组「预设 + 参数」控件，实时拼出表达式并给出校验结果、中文描述与后 5 次执行时间。
   参数输入框只在当前预设需要时才挂到界面上，并且都带中文标签写明用途与格式，
   避免出现「填了却不生效」或「不知道这是什么」的输入框。
   拼装逻辑是纯函数（挂在 api.build 上），单测直接调用它验证每种预设都能产出合法表达式。 */
(function (GN) {
  'use strict';

  var cron = GN.lib.cron;
  var RUN_COUNT = 5;
  var WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var STEP_MAX = 59;   // 步长上限取分钟字段的最大值，防止拼出没有意义的 */N

  // modes 里：param 表示该预设需要额外参数（step 数字框 / custom 文本框），
  // fixed 描述不需要参数的预设最终固定成什么。
  var FIELD_CONFIG = [
    {
      key: 'minute',
      name: '分钟',
      def: 'every',
      step: 5,
      custom: '0,30',
      modes: [
        { id: 'every', label: '每分钟', value: '*', fixed: '每分钟' },
        { id: 'step', label: '每隔 N 分钟', param: 'step', paramLabel: '每隔 N 分钟（填 1-59 的整数）' },
        { id: 'custom', label: '指定分钟', param: 'custom', paramLabel: '分钟列表（如 0,15,30 或 0-30/5）' }
      ]
    },
    {
      key: 'hour',
      name: '小时',
      def: 'every',
      step: 2,
      custom: '9,18',
      modes: [
        { id: 'every', label: '每小时', value: '*', fixed: '每小时' },
        { id: 'step', label: '每隔 N 小时', param: 'step', paramLabel: '每隔 N 小时（填 1-59 的整数）' },
        { id: 'custom', label: '指定小时', param: 'custom', paramLabel: '小时列表（如 9,18 或 9-17）' }
      ]
    },
    {
      key: 'day',
      name: '日',
      def: 'every',
      step: 2,
      custom: '1,15',
      modes: [
        { id: 'every', label: '每天', value: '*', fixed: '每天' },
        { id: 'step', label: '每隔 N 天', param: 'step', paramLabel: '每隔 N 天（填 1-59 的整数，从每月 1 号起数）' },
        { id: 'custom', label: '指定几号', param: 'custom', paramLabel: '几号（如 1,15 或 1-7）' }
      ]
    },
    {
      key: 'month',
      name: '月',
      def: 'every',
      step: 1,
      custom: '1,6,12',
      modes: [
        { id: 'every', label: '每月', value: '*', fixed: '每月' },
        { id: 'custom', label: '指定月份', param: 'custom', paramLabel: '月份（如 1,6,12 或 JAN-JUN）' }
      ]
    },
    {
      key: 'week',
      name: '周',
      def: 'every',
      step: 1,
      custom: '1,3,5',
      modes: [
        { id: 'every', label: '每天（不限定）', value: '*', fixed: '每天（不限定）' },
        { id: 'workday', label: '工作日', value: '1-5', fixed: '1-5（周一至周五）' },
        { id: 'custom', label: '指定星期', param: 'custom', paramLabel: '星期（如 1,3,5 或 MON-FRI；0 和 7 都是周日）' }
      ]
    }
  ];

  function findMode(config, id) {
    for (var i = 0; i < config.modes.length; i++) {
      if (config.modes[i].id === id) { return config.modes[i]; }
    }
    return null;
  }

  function defaultStates() {
    return FIELD_CONFIG.map(function (config) {
      return { mode: config.def, step: config.step, custom: config.custom };
    });
  }

  function stepText(step) {
    var number = Math.floor(Number(step));
    if (!isFinite(number) || number < 1) { number = 1; }
    if (number > STEP_MAX) { number = STEP_MAX; }
    return '*/' + number;
  }

  function fieldExpression(config, state) {
    var current = state || {};
    var mode = findMode(config, current.mode) || findMode(config, config.def);
    if (mode.id === 'step') { return stepText(current.step); }
    if (mode.id === 'custom') {
      // 自定义留空时退回「不限」，保证拼出来的表达式仍然合法
      var custom = String(current.custom === undefined || current.custom === null ? '' : current.custom).trim();
      return custom || '*';
    }
    return mode.value;
  }

  function buildExpression(states) {
    var list = states && states.length === FIELD_CONFIG.length ? states : defaultStates();
    return FIELD_CONFIG.map(function (config, index) {
      return fieldExpression(config, list[index]);
    }).join(' ');
  }

  function pad(value) { return (value < 10 ? '0' : '') + value; }

  function formatLocal(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  GN.register({
    id: 'cron-builder',
    group: 'time',
    title: 'Cron 生成',
    desc: '按字段预设拼出表达式，实时校验并预览执行时间',
    api: {
      fields: FIELD_CONFIG,
      defaults: defaultStates,
      build: buildExpression
    },
    mount: function (root) {
      var ui = GN.ui;
      var states = defaultStates();
      var selects = [];
      var stepInputs = [];
      var customInputs = [];
      var slots = [];
      var fieldTexts = [];
      var renderedMode = [];
      var message = ui.msg();
      var exprOut = ui.output();
      var checkBox = ui.row();
      var descOut = ui.output();
      var runBox = ui.col();

      // 五个字段铺成网格卡片：一行能放下多个字段，避免五个字段各占三行把界面撑长
      var fieldGrid = ui.grid();
      root.appendChild(ui.hint('每个卡片是一个 Cron 字段：先选预设；只有预设需要用参数时才会出现输入框，输入框上方写了它的用途和可填格式。'));

      FIELD_CONFIG.forEach(function (config, index) {
        var select = ui.select(
          config.modes.map(function (mode) { return { value: mode.id, label: mode.label }; }),
          states[index].mode,
          function () {
            states[index].mode = select.value;
            update();
          }
        );
        var stepInput = ui.input({
          type: 'number',
          value: String(config.step),
          oninput: function () {
            states[index].step = stepInput.value;
            update();
          }
        });
        var customInput = ui.input({
          value: config.custom,
          placeholder: '例如 ' + config.custom,
          oninput: function () {
            states[index].custom = customInput.value;
            update();
          }
        });
        selects.push(select);
        stepInputs.push(stepInput);
        customInputs.push(customInput);
        slots.push(ui.col());
        fieldTexts.push(ui.label(''));
        fieldGrid.appendChild(ui.col(ui.label(config.name), select, slots[index], fieldTexts[index]));
      });
      root.appendChild(fieldGrid);

      function currentMode(index) {
        var config = FIELD_CONFIG[index];
        return findMode(config, states[index].mode) || findMode(config, config.def);
      }

      // 参数控件只挂到当前预设真正用到的那个输入框上，其余输入框不进入 DOM：
      // 既不会让用户以为填了会生效，也不会在界面上留下没有标签的输入框。
      function syncParam(index) {
        var mode = currentMode(index);
        if (renderedMode[index] === mode.id) { return; }
        renderedMode[index] = mode.id;
        var slot = slots[index];
        slot.textContent = '';
        if (mode.param === 'step') { slot.appendChild(ui.field(mode.paramLabel, stepInputs[index])); return; }
        if (mode.param === 'custom') { slot.appendChild(ui.field(mode.paramLabel, customInputs[index])); return; }
        slot.appendChild(ui.hint('固定为「' + (mode.fixed || mode.label) + '」，不需要额外参数'));
      }

      function update() {
        for (var i = 0; i < FIELD_CONFIG.length; i++) { syncParam(i); }
        var expr = buildExpression(states);
        exprOut.setText(expr);
        checkBox.textContent = '';
        var checked = cron.validate(expr);
        checkBox.appendChild(ui.badge(
          checked.ok ? '通过校验：' + checked.message : '未通过：' + checked.message,
          checked.ok ? 'ok' : 'error'
        ));
        runBox.textContent = '';
        var parsed = checked.ok ? cron.parse(expr) : null;
        for (var k = 0; k < fieldTexts.length; k++) {
          // 每个字段当前实际生成的取值与中文含义，直接写在字段行里
          fieldTexts[k].textContent = parsed ? '= ' + parsed[k].text : '';
        }
        if (!checked.ok) {
          descOut.setText('');
          message.show('生成的表达式未通过校验：' + checked.message, 'error');
          return;
        }
        message.clear();
        descOut.setText(cron.describe(expr));
        var runs = [];
        try { runs = cron.nextRuns(expr, RUN_COUNT); } catch (error) { runs = []; }
        if (!runs.length) {
          runBox.appendChild(ui.hint('这个表达式在可预见的未来不会命中（例如指定了 2 月 30 日），换个预设试试。'));
          return;
        }
        runBox.appendChild(ui.table(
          [{ key: 'index', title: '#' }, { key: 'time', title: '本地时间', mono: true }, { key: 'week', title: '星期' }],
          runs.map(function (date, index) {
            return { index: index + 1, time: formatLocal(date), week: WEEK_NAMES[date.getDay()] };
          })
        ));
      }

      function reset() {
        states = defaultStates();
        FIELD_CONFIG.forEach(function (config, index) {
          selects[index].value = states[index].mode;
          stepInputs[index].value = String(states[index].step);
          customInputs[index].value = states[index].custom;
        });
        update();
      }

      root.appendChild(ui.row(
        ui.label('生成表达式'),
        ui.copyButton(function () { return buildExpression(states); }, '复制表达式'),
        ui.button('重置为默认', reset),
        ui.spacer()
      ));
      root.appendChild(exprOut);
      root.appendChild(ui.row(ui.label('校验'), checkBox, ui.spacer()));
      root.appendChild(ui.label('中文描述'));
      root.appendChild(descOut);
      root.appendChild(ui.label('接下来 ' + RUN_COUNT + ' 次执行时间（本地时区）'));
      root.appendChild(ui.scroll(runBox));
      root.appendChild(message);
      root.appendChild(ui.hint('日与周都写成具体值时，按标准 cron 的「或」语义执行：满足其一即执行。' +
        '自定义输入框留空会退回「不限」，所以任何时候生成的表达式都能通过校验。'));

      update();
    }
  });
})(GN);