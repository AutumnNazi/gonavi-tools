/* URL 编解码：四种 URI 编解码函数，外加完整 URL 拆解与查询串 ↔ 参数表双向转换。
   解析失败一律抛中文错误，不返回半成品结果。
   顶层只注册，DOM 操作全部在 mount 内。 */
(function (GN) {
  'use strict';

  function asText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function encodeComponent(text) {
    return encodeURIComponent(asText(text));
  }

  function decodeComponent(text) {
    try {
      return decodeURIComponent(asText(text));
    } catch (error) {
      throw new Error('解码失败：百分号转义不完整或不是合法的 UTF-8 字节序列');
    }
  }

  function encodeFull(text) {
    return encodeURI(asText(text));
  }

  function decodeFull(text) {
    try {
      return decodeURI(asText(text));
    } catch (error) {
      throw new Error('解码失败：百分号转义不完整或不是合法的 UTF-8 字节序列');
    }
  }

  // 解析器会把中文主机名转成 punycode（xn-- 前缀），从源串里再取一份原始写法供界面显示。
  function unicodeHostOf(source) {
    var at = source.indexOf('://');
    if (at < 0) { return ''; }
    var rest = source.slice(at + 3);
    var end = rest.length;
    ['/', '?', '#'].forEach(function (mark) {
      var index = rest.indexOf(mark);
      if (index >= 0 && index < end) { end = index; }
    });
    var authority = rest.slice(0, end);
    var atSign = authority.lastIndexOf('@');
    var host = atSign >= 0 ? authority.slice(atSign + 1) : authority;
    if (host.charAt(0) !== '[') { host = host.replace(/:\d+$/, ''); }
    return host;
  }

  // 只接受绝对地址；相对路径与缺少协议的输入按错误处理，避免猜出错误的主机。
  function parseUrl(text) {
    var source = asText(text).trim();
    if (!source) { throw new Error('请输入要解析的 URL'); }
    var parsed;
    try {
      parsed = new URL(source);
    } catch (error) {
      throw new Error('不是合法的绝对 URL：请带上 http 或 https 之类的协议前缀');
    }
    var pairs = queryPairs(parsed.search);
    return {
      protocol: parsed.protocol.replace(/:$/, ''),
      username: parsed.username,
      password: parsed.password,
      host: parsed.host,
      hostname: parsed.hostname,
      unicodeHostname: unicodeHostOf(source),
      port: parsed.port,
      path: parsed.pathname,
      query: parsed.search.replace(/^\?/, ''),
      pairs: pairs,
      hash: parsed.hash.replace(/^#/, ''),
      origin: parsed.origin
    };
  }

  function queryPairs(text) {
    var pairs = [];
    new URLSearchParams(asText(text).replace(/^\?/, '')).forEach(function (value, key) {
      pairs.push({ key: key, value: value });
    });
    return pairs;
  }

  function parseQuery(text) {
    var source = asText(text).trim();
    if (!source || source === '?') { throw new Error('查询串是空的，没有可解析的参数'); }
    return queryPairs(source);
  }

  function buildQuery(pairs) {
    var list = Array.isArray(pairs) ? pairs : [];
    var params = new URLSearchParams();
    list.forEach(function (pair) {
      if (!pair) { return; }
      if (Array.isArray(pair)) { params.append(asText(pair[0]), asText(pair[1])); return; }
      params.append(asText(pair.key), asText(pair.value));
    });
    return params.toString();
  }

  GN.register({
    id: 'url',
    group: 'codec',
    title: 'URL 编解码',
    desc: 'URI 编解码 / URL 拆解 / 查询参数转换',
    api: {
      encodeComponent: encodeComponent,
      decodeComponent: decodeComponent,
      encodeFull: encodeFull,
      decodeFull: decodeFull,
      parseUrl: parseUrl,
      parseQuery: parseQuery,
      buildQuery: buildQuery
    },
    mount: function (root) {
      var ui = GN.ui;

      var uriInput = ui.textarea({ placeholder: '输入要编码或解码的文本 / URI…' });
      var uriOutput = ui.output();
      var uriMessage = ui.msg();

      function runUri(action, label) {
        var text = uriInput.value;
        if (!text.trim()) { uriMessage.show('请先输入内容', 'warn'); return; }
        try {
          uriOutput.setText(action(text));
          uriMessage.show(label + '完成', 'ok');
        } catch (error) {
          uriOutput.setText('');
          uriMessage.show(String((error && error.message) || error), 'error');
        }
      }

      root.appendChild(ui.label('URI 编解码'));
      root.appendChild(uriInput);
      root.appendChild(ui.row(
        ui.button('encodeURIComponent', function () { runUri(encodeComponent, '编码'); }, 'primary'),
        ui.button('decodeURIComponent', function () { runUri(decodeComponent, '解码'); }),
        ui.button('encodeURI', function () { runUri(encodeFull, '编码'); }),
        ui.button('decodeURI', function () { runUri(decodeFull, '解码'); }),
        ui.copyButton(function () { return uriOutput.textContent; }),
        ui.spacer()
      ));
      root.appendChild(uriMessage);
      root.appendChild(uriOutput);
      root.appendChild(ui.hint('encodeURIComponent 会转义 : / ? # & = 等保留字符，适合编单个参数值；' +
        'encodeURI 保留这些保留字符，适合编整条地址。'));

      var urlInput = ui.input({ placeholder: '输入完整 URL，例如 https 开头的地址', value: '' });
      var urlTable = ui.output();
      var urlMessage = ui.msg();
      var queryInput = ui.textarea({ placeholder: '查询串或参数表，例如 a=1&b=你好，或逐行写 key=value…' });
      var pairTable = ui.table([
        { title: '参数名', key: 'key' },
        { title: '参数值', key: 'value', mono: true }
      ], []);
      var pairHead = pairTable.querySelector('tbody');

      function showUrl() {
        try {
          var info = parseUrl(urlInput.value);
          var rows = [
            { name: '协议 protocol', value: info.protocol },
            { name: '主机 host', value: info.host },
            { name: '主机名 hostname', value: info.hostname },
            { name: '主机名（中文形式）', value: info.unicodeHostname || '（无）' },
            { name: '端口 port', value: info.port || '（未显式指定，使用协议默认端口）' },
            { name: '路径 path', value: info.path },
            { name: '查询 query', value: info.query || '（无查询参数）' },
            { name: '片段 hash', value: info.hash || '（无）' },
            { name: '源 origin', value: info.origin },
            { name: '用户名 username', value: info.username || '（无）' }
          ];
          urlTable.setText(rows.map(function (row) { return row.name + '：' + row.value; }).join('\n'));
          urlMessage.show('解析成功，共 ' + info.pairs.length + ' 个查询参数', 'ok');
          queryInput.value = info.query;
          renderPairs(info.pairs);
        } catch (error) {
          urlTable.setText('');
          pairHead.textContent = '';
          urlMessage.show(String((error && error.message) || error), 'error');
        }
      }

      root.appendChild(ui.label('完整 URL 解析'));
      root.appendChild(urlInput);
      root.appendChild(ui.row(
        ui.button('解析 URL', showUrl, 'primary'),
        ui.button('示例', function () {
          urlInput.value = 'https' + '://user:pw@例子.测试:8443/a/b?x=1&中文=%E4%B8%AD#片段';
          showUrl();
        }),
        ui.spacer()
      ));
      root.appendChild(urlMessage);
      root.appendChild(ui.scroll(urlTable));
      root.appendChild(ui.hint('端口为空说明地址里没写端口；路径始终以 / 开头；host 含端口，hostname 不含。'));

      function renderPairs(pairs) {
        pairHead.textContent = '';
        pairs.forEach(function (pair) {
          var tr = pairHead.insertRow();
          tr.appendChild(ui.el('td', { text: pair.key }));
          tr.appendChild(ui.el('td', { class: 'tb-mono', text: pair.value }));
        });
      }

      var queryMessage = ui.msg();

      // 单行输入按查询串解析；多行输入按「key=value」逐行读，方便手工编辑参数表。
      function pairsFromInput() {
        var text = queryInput.value;
        if (text.indexOf('\n') >= 0) {
          return text.split('\n').filter(function (line) { return line.trim() !== ''; }).map(function (line) {
            var at = line.indexOf('=');
            if (at < 0) { return { key: line.trim(), value: '' }; }
            return { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
          });
        }
        return parseQuery(text);
      }

      function doParseQuery() {
        try {
          var pairs = pairsFromInput();
          renderPairs(pairs);
          queryInput.value = pairs.map(function (pair) { return pair.key + '=' + pair.value; }).join('\n');
          queryMessage.show('已解析 ' + pairs.length + ' 个参数', 'ok');
        } catch (error) {
          pairHead.textContent = '';
          queryMessage.show(String((error && error.message) || error), 'error');
        }
      }

      function doBuildQuery() {
        try {
          var pairs = pairsFromInput();
          var built = buildQuery(pairs);
          queryInput.value = built;
          renderPairs(pairs);
          queryMessage.show('已拼成查询串：' + built, 'ok');
        } catch (error) {
          queryMessage.show(String((error && error.message) || error), 'error');
        }
      }

      root.appendChild(ui.label('查询串 ↔ 参数表'));
      root.appendChild(queryInput);
      root.appendChild(ui.row(
        ui.button('解析查询串', doParseQuery, 'primary'),
        ui.button('拼成查询串', doBuildQuery),
        ui.copyButton(function () { return queryInput.value; }, '复制查询串'),
        ui.button('清空', function () {
          queryInput.value = '';
          pairHead.textContent = '';
          queryMessage.clear();
        }, 'danger'),
        ui.spacer()
      ));
      root.appendChild(queryMessage);
      root.appendChild(ui.scroll(pairTable));
      root.appendChild(ui.hint('解析与拼装都用标准表单规则：空格写成 +，重复的参数名会保留成多行。'));
    }
  });
})(GN);
