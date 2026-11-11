/* 页面级验收：直接跑构建产物里的脚本，验证装配顺序、命名空间与每个工具的挂载/交互。
   这一层是单测覆盖不到的：单测给模块注入 GN，只有这里才会暴露"脚本块顺序错了"这类问题。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPage, readBuiltPage, expectedToolCount, findByTag } from '../scripts/page-runner.mjs';

const result = runPage(readBuiltPage());
const toolCount = expectedToolCount();

test('所有脚本块按页面顺序执行且都不抛错', () => {
  assert.deepEqual(result.errors, [], '脚本块异常：' + JSON.stringify(result.errors));
});

test('引导脚本建立了全局 GN，lib 命名空间已装配', () => {
  assert.ok(result.GN, '全局 GN 未建立');
  assert.equal(typeof result.GN.lib, 'object');
  assert.equal(typeof result.GN.lib.bytes, 'object', 'lib/bytes.js 未装配，说明 lib 块执行失败或顺序错误');
});

test('全部工具模块注册成功', () => {
  assert.equal(result.GN.tools.length, toolCount, '注册工具数 ' + result.GN.tools.length + '，src/tools 下有 ' + toolCount + ' 个文件');
  const ids = result.GN.tools.map((tool) => tool.id);
  assert.equal(new Set(ids).size, ids.length, '工具 id 重复：' + ids.join(','));
});

test('每个工具都满足注册契约', () => {
  for (const tool of result.GN.tools) {
    assert.ok(tool.id, '缺少 id');
    assert.ok(tool.title, tool.id + ' 缺少 title');
    assert.ok(['codec', 'hash', 'time', 'text', 'misc'].includes(tool.group), tool.id + ' 的 group 非法：' + tool.group);
    assert.equal(typeof tool.mount, 'function', tool.id + ' 缺少 mount');
    assert.equal(typeof tool.api, 'object', tool.id + ' 缺少 api');
  }
});

test('每个工具都能挂载，且空输入与非法输入下的按钮点击都不抛错', () => {
  const failures = [];
  for (const tool of result.GN.tools) {
    const host = result.document.createElement('div');
    try {
      tool.mount(host);
    } catch (error) {
      failures.push(tool.id + ' 挂载失败：' + error.message);
      continue;
    }

    const clickAll = (label) => {
      for (const button of findByTag(host, 'button')) {
        try {
          button.click();
        } catch (error) {
          failures.push(tool.id + ' [' + label + '] 点击按钮「' + button.textContent + '」抛错：' + error.message);
        }
      }
    };

    clickAll('空输入');

    for (const field of [...findByTag(host, 'textarea'), ...findByTag(host, 'input')]) {
      if (field.tagName === 'INPUT' && field.type === 'checkbox') { continue; }
      field.value = field.tagName === 'TEXTAREA' ? '{"bad": } 中文 🚀\n第二行' : 'not-a-valid-value';
    }
    clickAll('非法输入');
  }
  assert.deepEqual(failures, []);
});

test('跟随宿主主题：注入的 theme / palette / appearance 落到页面上', () => {
  const themed = runPage(readBuiltPage(), {
    hostPreferences: {
      locale: 'zh-CN',
      theme: 'dark',
      palette: { accent: 'rgb(22, 163, 74)', bg: 'rgb(27, 29, 31)', text: 'rgb(230, 232, 234)' },
      appearance: { fontFamily: '"Segoe UI", sans-serif', radius: 8 },
    },
  });
  const rootNode = themed.document.documentElement;
  assert.equal(rootNode.getAttribute('data-theme'), 'dark');
  assert.equal(rootNode.style.getPropertyValue('--brand'), 'rgb(22, 163, 74)');
  assert.equal(rootNode.style.getPropertyValue('--bg'), 'rgb(27, 29, 31)');
  assert.equal(rootNode.style.getPropertyValue('--text'), 'rgb(230, 232, 234)');
  assert.equal(rootNode.style.getPropertyValue('--sans'), '"Segoe UI", sans-serif');
  assert.equal(rootNode.style.getPropertyValue('--radius'), '8px');
  // 品牌绿的相对亮度高于 WCAG 的 0.179 分界，按钮文字应为深色以保证对比度。
  assert.equal(rootNode.style.getPropertyValue('--brand-text'), '#10241a');
});

test('宿主切换主题时页面实时跟随 gonavi:host-preferences', () => {
  const themed = runPage(readBuiltPage(), { hostPreferences: { locale: 'zh-CN', theme: 'dark' } });
  const rootNode = themed.document.documentElement;
  assert.equal(rootNode.getAttribute('data-theme'), 'dark');

  // 模拟宿主改主意：切浅色并换一个浅色品牌色。
  themed.sandbox.gonaviHostPrefs = { locale: 'zh-CN', theme: 'light', palette: { accent: 'rgb(240, 240, 240)' } };
  themed.sandbox.dispatchEvent({ type: 'gonavi:host-preferences' });

  assert.equal(rootNode.getAttribute('data-theme'), 'light');
  assert.equal(rootNode.style.getPropertyValue('--brand'), 'rgb(240, 240, 240)');
  assert.equal(rootNode.style.getPropertyValue('--brand-text'), '#10241a', '浅色品牌色应换成深色文字');
});

test('没有宿主时按系统偏好决定主题（浏览器预览路径）', () => {
  const plain = runPage(readBuiltPage());
  assert.ok(['light', 'dark'].includes(plain.document.documentElement.getAttribute('data-theme')));

  const darkSystem = runPage(readBuiltPage(), { prefersDark: true });
  assert.equal(darkSystem.document.documentElement.getAttribute('data-theme'), 'dark');
});

test('沙箱内的字节类型与页面同 realm（防止验证环境制造假阳性）', () => {
  // 真实浏览器是单 realm：new TextEncoder().encode() 的结果 instanceof Uint8Array 必须为 true。
  // 若这里失败，说明验证环境注入的是宿主实现，任何 instanceof 检查都会假报错。
  assert.equal(result.evaluate("GN.lib.bytes.utf8Encode('中') instanceof Uint8Array"), true);
  assert.equal(result.evaluate("GN.lib.bytes.utf8Encode('中').length"), 3);
  assert.equal(result.evaluate('typeof GN.lib.md5'), 'function');
  assert.equal(result.evaluate("GN.lib.bytes.toHex(GN.lib.bytes.utf8Encode('abc'))"), '616263');
});

test('没有任何工具在挂载期使用 innerHTML 注入', () => {
  const used = [];
  for (const tool of result.GN.tools) {
    const host = result.document.createElement('div');
    tool.mount(host);
    const scan = (node) => {
      if (node.innerHTMLWasUsed) { used.push(tool.id + ' → ' + node.tagName); }
      for (const child of node.childNodes || []) { if (child.tagName) { scan(child); } }
    };
    scan(host);
  }
  assert.deepEqual(used, [], '以下位置使用了 innerHTML：' + used.join('; '));
});
