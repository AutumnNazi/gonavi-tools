/* 构建：把 src 下的样式、库、内核与工具模块内联成单个 HTML，
   再写成可直接安装的 gonavi.plugin.json（html.source 即该 HTML）。
   宿主 CSP 禁止一切外部子资源，所以产物必须是自包含单文件。 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const readText = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const listJs = (relative) => fs.readdirSync(path.join(root, relative))
  .filter((name) => name.endsWith('.js'))
  .sort();

const pkg = JSON.parse(readText('package.json'));

const bundle = (relative, files) => files
  .map((name) => '/* ===== ' + relative + '/' + name + ' ===== */\n' + readText(relative + '/' + name).trim())
  .join('\n\n');

const libFiles = listJs('src/lib');
const toolFiles = listJs('src/tools');
if (!toolFiles.length) { throw new Error('src/tools 下没有工具模块'); }

const styles = readText('src/styles.css').trim();
const libCode = bundle('src/lib', libFiles);
const toolCode = bundle('src/tools', toolFiles);
const appCode = readText('src/app.js').trim();

let page = readText('src/page.html');
// 用函数式替换，避免内容里的 $& / $1 被当作替换模式。
page = page
  .replace('__STYLES__', () => styles)
  .replace('__LIB__', () => libCode)
  .replace('__APP__', () => appCode)
  .replace('__TOOLS__', () => toolCode);

const leftover = page.match(/__(STYLES|LIB|APP|TOOLS)__/);
if (leftover) { throw new Error('页面里仍有未替换的占位符：' + leftover[0]); }

const pageBytes = Buffer.byteLength(page, 'utf8');
if (pageBytes > 256 * 1024) {
  throw new Error('页面体积 ' + pageBytes + ' 字节，超过宿主 html.source 的 256 KiB 上限');
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/preview.html'), page, 'utf8');

const manifest = {
  schemaVersion: 1,
  apiVersion: 1,
  // 命名空间用发布者的 GitHub 账号，与市场上其它插件的 id 风格保持一致
  id: 'gh-autumnnazi.toolbox',
  name: '开发者工具箱',
  version: pkg.version,
  description: '开发时随手要用的 15 个工具箱：JSON 格式化与校验、Cron 表达式解析与生成、时间戳转换、MD5/SHA 哈希、Base64 与 URL 编解码、JWT 解码、正则测试、文本处理与进制转换。全部在本机完成，不联网、无后端进程。',
  author: 'AutumnNazi',
  license: 'MIT',
  // 与同作者的其它插件保持一致：声明最低宿主版本，并带一个包内图标
  minHostVersion: '1.2.0',
  icon: 'icons/toolbox.png',
  permissions: ['ui.pages', 'ui.html-panel'],
  permissionNotes: {
    'ui.pages': '声明一个 workbench 标签页，并用 contributes.navigation(location: tools) 在标题栏插件菜单加入入口。',
    'ui.html-panel': '在标签页里渲染内联 HTML 工具界面；页面不联网、不读写宿主存储、不访问数据库。'
  },
  contributes: {
    pages: [
      { id: 'toolbox', title: '开发者工具箱', html: { source: page } }
    ],
    navigation: [
      { id: 'toolbox-entry', title: '开发者工具箱', page: 'toolbox', location: 'tools', order: 0 }
    ]
  }
};

const manifestText = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync(path.join(root, 'gonavi.plugin.json'), manifestText, 'utf8');

// 可安装包目录：manifest 是这类无后端静态包唯一必需的文件，
// 单独输出一份可以避免把源码、测试与构建脚本一起装进插件库。
const packageDir = path.join(root, 'dist/package');
fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(path.join(packageDir, 'icons'), { recursive: true });
fs.writeFileSync(path.join(packageDir, 'gonavi.plugin.json'), manifestText, 'utf8');
fs.copyFileSync(path.join(root, 'assets/toolbox.png'), path.join(packageDir, 'icons/toolbox.png'));

// 作者指南要求压缩包根目录随包分发 LICENSE；用了第三方资源片段还要附声明。
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES']) {
  const source = path.join(root, name);
  if (!fs.existsSync(source)) { throw new Error('缺少必须随包分发的文件：' + name); }
  fs.copyFileSync(source, path.join(packageDir, name));
}

console.log('已构建 ' + toolFiles.length + ' 个工具（lib ' + libFiles.length + ' 个文件）');
console.log('  dist/preview.html      ' + pageBytes + ' 字节 / 上限 262144');
console.log('  gonavi.plugin.json     ' + Buffer.byteLength(manifestText, 'utf8') + ' 字节');
console.log('  dist/package/          可直接安装的包目录（仅含 manifest）');
