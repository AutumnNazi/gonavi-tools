/* 静态自检：不启动宿主，只按宿主会执行的规则检查构建产物。
   manifest 的权威校验请另用 GoNavi SDK 的 ValidateManifest（见 README）。 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) { failures.push(message); }
}

const manifestPath = path.join(root, 'gonavi.plugin.json');
if (!fs.existsSync(manifestPath)) {
  console.error('gonavi.plugin.json 不存在，请先执行 npm run build');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

check(manifest.schemaVersion === 1 && manifest.apiVersion === 1, 'schemaVersion/apiVersion 必须为 1');
check(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(manifest.id || ''), 'id 不符合宿主命名规则：' + manifest.id);
check(/^\d+\.\d+\.\d+$/.test(manifest.version || ''), 'version 必须是三段数字 semver：' + manifest.version);
check(typeof manifest.name === 'string' && manifest.name.trim().length > 0, 'name 不能为空');
check(!manifest.backend, '本插件声明为无后端静态包，不应出现 backend');

const permissions = (manifest.permissions || []).slice().sort().join(',');
check(permissions === 'ui.html-panel,ui.pages', '权限应恰为 ui.pages + ui.html-panel，实际：' + permissions);
check(!JSON.stringify(manifest).includes('"host.'), '纯前端工具不应声明任何 host.* 权限');

const notesKeys = Object.keys(manifest.permissionNotes || {});
notesKeys.forEach((key) => {
  check((manifest.permissions || []).includes(key), 'permissionNotes 存在未声明权限：' + key);
  check(Buffer.byteLength(manifest.permissionNotes[key], 'utf8') <= 160, 'permissionNotes 超过 160 字节：' + key);
});

const pages = (manifest.contributes && manifest.contributes.pages) || [];
const navigation = (manifest.contributes && manifest.contributes.navigation) || [];
check(pages.length >= 1 && pages.length <= 32, 'pages 数量必须在 1..32');
check(navigation.length >= 1 && navigation.length <= 32, 'navigation 数量必须在 1..32');

const pageIds = pages.map((page) => page.id);
check(new Set(pageIds).size === pageIds.length, 'page id 必须唯一');
navigation.forEach((entry) => {
  check(pageIds.includes(entry.page), 'navigation 引用了未声明的 page：' + entry.page);
  check(entry.location === 'tools', 'navigation.location 只能是 tools：' + entry.location);
  check(Number.isInteger(entry.order) && entry.order >= -1000 && entry.order <= 1000, 'navigation.order 超出 -1000..1000');
});

// 宿主对 HTML 页面用 sandbox="allow-scripts" + 不透明源 + CSP，以下用法在运行期必然失败。
// 规则同样约束注释文本，因此源码里不要出现这些字面量。
const forbidden = [
  [/https?:\/\//, '外部 http(s) 资源引用'],
  [/\bfetch\s*\(/, '网络请求调用'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/WebSocket/, 'WebSocket'],
  [/localStorage/, 'localStorage'],
  [/sessionStorage/, 'sessionStorage'],
  [/document\.cookie/, 'document.cookie'],
  [/importScripts/, 'importScripts'],
  [/@import/, 'CSS @import'],
  [/crypto\.subtle/, 'WebCrypto subtle 接口'],
];

pages.forEach((page) => {
  check(page.body === undefined || page.html === undefined, 'page 的 body 与 html 只能二选一：' + page.id);
  if (!page.html) { return; }
  const source = page.html.source;
  const size = Buffer.byteLength(source, 'utf8');
  check(size > 0, 'html.source 不能为空：' + page.id);
  check(size <= 256 * 1024, 'html.source 超过 256 KiB：' + page.id + ' ' + size);
  check(!source.includes('\u0000'), 'html.source 不得包含 NUL：' + page.id);

  forbidden.forEach((pair) => {
    const hit = source.match(pair[0]);
    check(!hit, '页面出现被禁止的用法（' + pair[1] + '）：' + (hit && hit[0]));
  });

  const toolCount = (source.match(/===== src\/tools\//g) || []).length;
  notes.push('页面 ' + page.id + '：' + size + ' 字节，工具模块 ' + toolCount + ' 个');
});

if (failures.length) {
  console.error('自检失败（' + failures.length + ' 项）：');
  failures.forEach((message) => console.error('  - ' + message));
  process.exit(1);
}

notes.forEach((note) => console.log(note));
console.log('自检通过：manifest 声明与页面 CSP 约束均符合宿主 v1 契约');
