/* 工具箱内核：注册表、分组标签导航、通用 UI 基元、剪贴板与提示的降级实现。
   加载顺序是 引导脚本 → lib → app → tools。page.html 顶部的引导脚本先建立全局 GN，
   因为 lib 模块以 (function (GN) {...})(GN) 的形式直接引用它；app.js 复用同一对象继续填充。

   工具模块契约（每个文件一个工具，详见 README）：
     (function (GN) {
       'use strict';
       GN.register({
         id:    'json',                 // 全局唯一，小写短横线
         group: 'codec',                // codec | hash | time | text | misc
         title: 'JSON',                 // 标签名
         desc:  '格式化 / 压缩 / 转义 / 校验',   // 一句话说明
         api:   { format: format },     // 纯函数，供 Node 单测直接调用（不得触碰 DOM）
         mount: function (root) { ... } // 只在标签首次激活时调用一次，root 是内容容器
       });
     })(GN);

   硬约束（宿主沙箱决定，违反即运行失败）：
     - 模块顶层不得触碰 document/window/navigator，DOM 操作只能出现在 mount 内；
     - 不得使用 import/export、任何网络请求 API、任何本地存储 API、任何外链资源；
     - 不得依赖浏览器 WebCrypto 的 subtle 接口（页面是不透明源沙箱，可用性无保证），哈希一律自研纯 JS。 */

(function (global) {
  'use strict';

  var GN = global.GN || (global.GN = {});

  GN.groups = [
    { id: 'codec', title: '编码转换' },
    { id: 'hash', title: '加密哈希' },
    { id: 'time', title: '时间日期' },
    { id: 'text', title: '文本处理' },
    { id: 'misc', title: '其他工具' }
  ];
  GN.tools = [];
  GN.lib = GN.lib || {};

  GN.register = function (tool) {
    if (!tool || !tool.id || typeof tool.mount !== 'function') {
      throw new Error('工具注册失败：缺少 id 或 mount');
    }
    for (var i = 0; i < GN.tools.length; i++) {
      if (GN.tools[i].id === tool.id) { throw new Error('工具 id 重复：' + tool.id); }
    }
    GN.tools.push(tool);
  };

  /* ---------------- DOM 工厂 ---------------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) { return; }
        if (key === 'class') { node.className = value; }
        else if (key === 'text') { node.textContent = value; }
        else if (key === 'value') { node.value = value; }
        else if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2), value);
        } else if (value === true) { node.setAttribute(key, ''); }
        else { node.setAttribute(key, value); }
      });
    }
    appendAll(node, children);
    return node;
  }

  function appendAll(node, children) {
    if (children === null || children === undefined) { return; }
    var list = Array.isArray(children) ? children : [children];
    list.forEach(function (child) {
      if (child === null || child === undefined || child === false) { return; }
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
  }

  function bindInput(node, handler) {
    if (typeof handler === 'function') { node.addEventListener('input', handler); }
    return node;
  }

  /* ---------------- 跟随宿主主题 ----------------
     宿主在页面脚本之前注入 window.gonaviHostPrefs = { locale, theme, palette?, appearance? }，
     切换主题时再派发 gonavi:host-preferences 事件；没有宿主（浏览器预览）时按系统偏好。 */

  var HOST_PALETTE_VARS = {
    bg: '--bg', panel: '--bg-soft', code: '--bg-sunken', input: '--bg-input',
    text: '--text', muted: '--text-weak',
    border1: '--border', border: '--border-strong',
    accent: '--brand', accentSoft: '--brand-soft',
    ok: '--ok', warn: '--warn', hover: '--hover'
  };
  var HOST_APPEARANCE_VARS = { fontFamily: '--sans', monoFontFamily: '--mono' };

  function prefersDark() {
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // 品牌色上该配黑字还是白字：按 sRGB 相对亮度选，保证按钮文字始终可读。
  function readableOn(color) {
    var match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(color));
    if (!match) { return ''; }
    function channel(value) {
      var ratio = Number(value) / 255;
      return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
    }
    // 0.179 是 WCAG 判定"该配深色文字"的相对亮度分界；用 0.45 会让亮色品牌色压白字（对比度不足 3）。
    var luminance = 0.2126 * channel(match[1]) + 0.7152 * channel(match[2]) + 0.0722 * channel(match[3]);
    return luminance > 0.179 ? '#10241a' : '#ffffff';
  }

  function applyHostPreferences(preferences) {
    var root = document.documentElement;
    var theme = preferences && (preferences.theme === 'dark' || preferences.theme === 'light')
      ? preferences.theme
      : (prefersDark() ? 'dark' : 'light');
    root.setAttribute('data-theme', theme);

    var palette = preferences && preferences.palette;
    Object.keys(HOST_PALETTE_VARS).forEach(function (key) {
      var value = palette && palette[key];
      if (value) { root.style.setProperty(HOST_PALETTE_VARS[key], value); }
    });
    if (palette && palette.accent) {
      var onAccent = readableOn(palette.accent);
      if (onAccent) { root.style.setProperty('--brand-text', onAccent); }
    }

    var appearance = preferences && preferences.appearance;
    if (appearance) {
      Object.keys(HOST_APPEARANCE_VARS).forEach(function (key) {
        if (appearance[key]) { root.style.setProperty(HOST_APPEARANCE_VARS[key], appearance[key]); }
      });
      if (typeof appearance.radius === 'number') {
        root.style.setProperty('--radius', appearance.radius + 'px');
        root.style.setProperty('--radius-sm', Math.max(0, appearance.radius - 2) + 'px');
      }
    }
  }

  applyHostPreferences(global.gonaviHostPrefs);
  global.addEventListener('gonavi:host-preferences', function () {
    applyHostPreferences(global.gonaviHostPrefs);
  });
  if (global.matchMedia) {
    var darkQuery = global.matchMedia('(prefers-color-scheme: dark)');
    var followSystem = function () {
      // 宿主给了主题就以宿主为准，只有浏览器预览时才跟随系统变化。
      var host = global.gonaviHostPrefs;
      if (!host || (host.theme !== 'dark' && host.theme !== 'light')) { applyHostPreferences(null); }
    };
    if (darkQuery.addEventListener) { darkQuery.addEventListener('change', followSystem); }
    else if (darkQuery.addListener) { darkQuery.addListener(followSystem); }
  }

  /* ---------------- 通用能力 ---------------- */

  var toastBox = null;

  function toast(message, type) {
    if (!toastBox) {
      toastBox = el('div', { class: 'tb-toast' });
      document.body.appendChild(toastBox);
    }
    var item = el('div', { class: 'tb-toast-item' + (type ? ' tb-toast-item--' + type : ''), text: message });
    toastBox.appendChild(item);
    global.setTimeout(function () {
      if (item.parentNode) { item.parentNode.removeChild(item); }
    }, 1800);
  }

  function notify(message, type) {
    // 在 GoNavi 内运行时优先用宿主提示；浏览器预览或宿主调用失败时退回页内浮层。
    var host = global.gonavi;
    if (host && typeof host.notify === 'function') {
      try { host.notify(String(message), type || 'info'); return; } catch (error) { /* 退回本地提示 */ }
    }
    toast(String(message), type);
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  function copy(text) {
    text = text === null || text === undefined ? '' : String(text);
    if (!text) { return Promise.resolve(false); }
    var clipboard = global.navigator && global.navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      // 不透明源沙箱下 clipboard API 可能被拒绝，失败时退回 execCommand。
      return clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  var statusNode = null;
  function status(text) {
    if (!statusNode) { statusNode = document.getElementById('tb-status'); }
    if (statusNode) { statusNode.textContent = text; }
  }

  /* ---------------- UI 基元（工具模块只应通过这里构造界面） ---------------- */

  var ui = GN.ui = {
    el: el,
    col: function () { return el('div', { class: 'tb-col' }, Array.prototype.slice.call(arguments)); },
    row: function () { return el('div', { class: 'tb-row' }, Array.prototype.slice.call(arguments)); },
    grid: function () { return el('div', { class: 'tb-grid' }, Array.prototype.slice.call(arguments)); },
    split: function (left, right) { return el('div', { class: 'tb-split' }, [left, right]); },
    scroll: function (node) { return el('div', { class: 'tb-scroll-y' }, node); },
    spacer: function () { return el('span', { class: 'tb-spacer' }); },

    label: function (text) { return el('span', { class: 'tb-label', text: text }); },
    hint: function (text) { return el('div', { class: 'tb-hint', text: text }); },

    field: function (labelText, control) {
      return el('label', { class: 'tb-field' }, [el('span', { class: 'tb-label', text: labelText }), control]);
    },

    input: function (options) {
      options = options || {};
      return bindInput(el('input', {
        class: 'tb-input',
        type: options.type || 'text',
        value: options.value === undefined ? '' : options.value,
        placeholder: options.placeholder || '',
        spellcheck: 'false',
        autocomplete: 'off'
      }), options.oninput);
    },

    textarea: function (options) {
      options = options || {};
      var node = el('textarea', {
        class: 'tb-textarea' + (options.tall ? ' tb-textarea--tall' : ''),
        placeholder: options.placeholder || '',
        spellcheck: 'false',
        readonly: options.readonly === true
      });
      node.value = options.value === undefined ? '' : options.value;
      return bindInput(node, options.oninput);
    },

    select: function (options, value, onchange) {
      var node = el('select', { class: 'tb-select' },
        (options || []).map(function (item) { return el('option', { value: item.value, text: item.label }); }));
      if (value !== undefined && value !== null) { node.value = String(value); }
      if (typeof onchange === 'function') { node.addEventListener('change', onchange); }
      return node;
    },

    button: function (label, onclick, kind, title) {
      var node = el('button', {
        class: 'tb-btn' + (kind ? ' tb-btn--' + kind : ''),
        type: 'button',
        text: label,
        title: title || ''
      });
      if (typeof onclick === 'function') { node.addEventListener('click', onclick); }
      return node;
    },

    checkbox: function (labelText, checked, onchange) {
      var box = el('input', { type: 'checkbox' });
      box.checked = checked === true;
      if (typeof onchange === 'function') { box.addEventListener('change', onchange); }
      return el('label', { class: 'tb-check' }, [box, el('span', { text: labelText })]);
    },

    output: function (options) {
      options = options || {};
      var node = el('div', { class: 'tb-output' });
      node.setText = function (text) {
        node.textContent = text === null || text === undefined ? '' : String(text);
        return node;
      };
      if (options.value !== undefined) { node.setText(options.value); }
      return node;
    },

    msg: function () {
      var node = el('div', { class: 'tb-msg' });
      node.show = function (text, kind) {
        node.textContent = text || '';
        node.className = 'tb-msg' + (kind ? ' tb-msg--' + kind : '');
        return node;
      };
      node.clear = function () { return node.show(''); };
      return node;
    },

    badge: function (text, kind) {
      return el('span', { class: 'tb-badge' + (kind ? ' tb-badge--' + kind : ''), text: text });
    },

    table: function (columns, rows) {
      var head = el('tr', null, (columns || []).map(function (column) {
        return el('th', { text: column.title });
      }));
      var body = (rows || []).map(function (row) {
        return el('tr', null, (columns || []).map(function (column) {
          var value = row[column.key];
          return el('td', {
            class: column.mono ? 'tb-mono' : '',
            text: value === null || value === undefined ? '' : String(value)
          });
        }));
      });
      return el('table', { class: 'tb-table' }, [el('thead', null, head), el('tbody', null, body)]);
    },

    copyButton: function (getText, label) {
      return ui.button(label || '复制', function () {
        var value = typeof getText === 'function' ? getText() : getText;
        copy(value).then(function (ok) {
          notify(ok ? '已复制到剪贴板' : '复制失败，请手动选中后按 Ctrl+C', ok ? 'success' : 'error');
        });
      });
    }
  };

  GN.util = {
    copy: copy,
    notify: notify,
    status: status,
    toast: toast
  };

  /* ---------------- 分组与标签导航 ---------------- */

  var activeToolId = null;
  var activeGroupId = GN.groups.length ? GN.groups[0].id : null;
  var query = '';
  var searchInput, groupsNav, tabsNav, panel;

  function findTool(toolId) {
    for (var i = 0; i < GN.tools.length; i++) {
      if (GN.tools[i].id === toolId) { return GN.tools[i]; }
    }
    return null;
  }

  function visibleTools() {
    if (!query) {
      return GN.tools.filter(function (tool) { return tool.group === activeGroupId; });
    }
    var needle = query.toLowerCase();
    return GN.tools.filter(function (tool) {
      return (tool.id + ' ' + tool.title + ' ' + (tool.desc || '')).toLowerCase().indexOf(needle) >= 0;
    });
  }

  function renderGroups() {
    groupsNav.textContent = '';
    if (query) {
      groupsNav.appendChild(el('span', { class: 'tb-empty', text: '搜索结果：' + visibleTools().length + ' 个工具' }));
      return;
    }
    GN.groups.forEach(function (group) {
      var count = 0;
      GN.tools.forEach(function (tool) { if (tool.group === group.id) { count++; } });
      if (!count) { return; }
      var button = el('button', {
        class: 'tb-group' + (group.id === activeGroupId ? ' is-active' : ''),
        type: 'button',
        text: group.title
      });
      button.appendChild(el('span', { class: 'tb-tab-count', text: String(count) }));
      button.addEventListener('click', function () {
        activeGroupId = group.id;
        activeToolId = null;
        renderGroups();
        activateFirst();
      });
      groupsNav.appendChild(button);
    });
  }

  function renderTabs() {
    tabsNav.textContent = '';
    var list = visibleTools();
    if (!list.length) {
      tabsNav.appendChild(el('span', { class: 'tb-empty', text: '没有匹配的工具' }));
      return;
    }
    list.forEach(function (tool) {
      var button = el('button', {
        class: 'tb-tab' + (tool.id === activeToolId ? ' is-active' : ''),
        type: 'button',
        title: tool.desc || tool.title,
        text: tool.title
      });
      button.addEventListener('click', function () { activate(tool.id); });
      tabsNav.appendChild(button);
    });
  }

  function activate(toolId) {
    var tool = findTool(toolId);
    if (!tool) { return; }
    activeToolId = toolId;

    Array.prototype.forEach.call(panel.children, function (section) {
      var isTarget = section.getAttribute('data-tool') === toolId;
      section.classList.toggle('is-active', isTarget);
      if (isTarget && !section.mounted) {
        section.mounted = true;
        try {
          tool.mount(section.toolBody);
        } catch (error) {
          section.toolBody.appendChild(
            ui.msg().show('工具初始化失败：' + (error && error.message ? error.message : error), 'error')
          );
        }
      }
    });

    renderTabs();
    status(tool.title + ' · ' + (tool.desc || ''));
  }

  function activateFirst() {
    var list = visibleTools();
    if (list.length) { activate(list[0].id); }
  }

  function buildSections() {
    GN.tools.forEach(function (tool) {
      var section = el('section', { class: 'tb-section', 'data-tool': tool.id });
      section.appendChild(el('div', { class: 'tb-tool-head' }, [
        el('span', { class: 'tb-tool-title', text: tool.title }),
        el('span', { class: 'tb-tool-desc', text: tool.desc || '' })
      ]));
      section.toolBody = el('div', { class: 'tb-col tb-grow' });
      section.appendChild(section.toolBody);
      panel.appendChild(section);
    });
  }

  function start() {
    searchInput = document.getElementById('tb-search');
    groupsNav = document.getElementById('tb-groups');
    tabsNav = document.getElementById('tb-tabs');
    panel = document.getElementById('tb-panel');

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        query = searchInput.value.trim();
        renderGroups();
        activateFirst();
      });
    }

    buildSections();
    renderGroups();
    activateFirst();
    status('就绪 · 共 ' + GN.tools.length + ' 个工具');
  }

  GN.start = start;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
