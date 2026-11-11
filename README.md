# 开发者工具箱（GoNavi 插件）

一个纯前端的 GoNavi 插件：JSON、Cron、时间戳、哈希、Base64、URL、JWT、正则、文本与进制转换等
15 个日常开发工具，全部在一页里完成。

- **没有后端进程**：不需要编译 Go，也不会有子进程常驻。
- **不联网**：页面里所有计算都在本机完成，一个字节都不会发出去。
- **不申请任何敏感权限**：只声明 `ui.pages`（注册页面与菜单入口）和 `ui.html-panel`（用沙箱 HTML 渲染），
  没有 `host.*` 权限，插件看不到你的数据库连接与数据。

## 安装

### 一、在设置里本地安装（推荐）

1. 构建产物（仓库里已包含，改了源码再执行）：

   ```powershell
   npm run build
   ```

2. 打开 GoNavi → **设置 → 插件 → 本地安装**，选择本仓库的 `dist/package` 目录。
   这个目录里只有一份 `gonavi.plugin.json`，安装进去不会带上源码和测试文件。
3. 安装预览里会列出两条权限与说明，确认后接受信任、启用插件。
4. 打开标题栏的**「插件」菜单 → 开发者工具箱**；插件卡片上的「打开」按钮也能进。

### 二、不想装也能先看

直接用浏览器打开 `dist/preview.html`，内容与插件页面完全一致（只是少了宿主提供的提示条）。

### 三、命令行安装（可选，未在本机实测）

依据 GoNavi 插件文档，管理命令是 CLI 的 `plugin` 路由，需要含该路由的 CLI 构建；
安装要求先 `inspect` 拿到 digest 再显式信任。桌面端在运行时是插件库的 owner，两者互斥：

```powershell
gonavi plugin --root <插件根> check dist/package
gonavi plugin --root <插件根> inspect dist/package
gonavi plugin --root <插件根> install --digest <上一步的 digest> --trust dist/package
gonavi plugin --root <插件根> enable gh-autumnnazi.toolbox
```

## 工具清单

| 分组 | 工具 | 能做什么 |
|---|---|---|
| 编码转换 | **JSON** | 格式化（2/4 空格或 Tab）、压缩、键排序、转义为字符串字面量、去转义、带**准确行列**的语法校验 |
| 编码转换 | **Base64** | 文本 ↔ Base64，UTF-8 与中文正确，支持 URL-safe，解码失败给明确原因 |
| 编码转换 | **URL 编解码** | 单段/整串编码解码、URL 各部件解析、查询串 ↔ 参数表 |
| 编码转换 | **JWT 解码** | 拆出 header/payload 并格式化，标出 iat/nbf/exp 与是否过期（**只解码，不验证签名**） |
| 加密哈希 | **哈希** | 一次算出 MD5 / SHA-1 / SHA-256，可复制、可与粘贴的哈希比对 |
| 时间日期 | **时间戳** | 秒/毫秒自动识别，本地 / UTC / 北京时间三种对照，日期串与时间戳互转 |
| 时间日期 | **Cron 解析** | 5 段与 6 段自动识别、字段逐项拆解、中文描述、接下来 10 次执行时间、常用模板 |
| 时间日期 | **Cron 生成** | 按字段可视化拼装表达式（默认 6 段，可切换到 5 段），实时给出描述与下次执行时间 |
| 文本处理 | **正则测试** | 匹配高亮、匹配清单与捕获分组、替换预览（支持 $1） |
| 文本处理 | **文本统计** | 字符数、UTF-8 字节数、行数、词数、中文字数、最长行 |
| 文本处理 | **文本对比** | 行级 diff，标注新增/删除并统计 |
| 文本处理 | **行处理** | 去重、排序、反转、trim、去空行、加前后缀、合并、生成 IN 列表 |
| 其他工具 | **UUID / 随机串** | 批量 UUID v4、NanoID 风格串、随机十六进制 |
| 其他工具 | **进制转换** | 2/8/10/16/36 互转，BigInt 支持超过 2^53 的大整数 |
| 其他工具 | **颜色转换** | HEX / RGB / RGBA / HSL / HSLA 互转，带预览与可读性提示 |

## 目录结构

```
gonavi.plugin.json        构建产物：清单 + 内联页面（安装用的就是这个文件）
dist/preview.html         构建产物：可用浏览器直接打开的单文件页面
dist/package/             构建产物：可直接安装的包目录
src/page.html             页面骨架（含 __STYLES__ / __LIB__ / __APP__ / __TOOLS__ 占位符）
src/styles.css            设计系统（对齐 GoNavi 品牌绿，跟随系统深浅色）
src/app.js                内核：注册表、分组标签导航、UI 基元、剪贴板与提示降级
src/lib/*.js              可复用的纯逻辑（字节编码、哈希、Cron、diff）
src/tools/*.js            每个文件一个工具，文件名前缀决定标签顺序
scripts/build.mjs         内联打包：源码 → 单文件 HTML → manifest
scripts/check.mjs         静态自检：按宿主会执行的规则检查产物
scripts/test-loader.mjs   测试加载器：在 Node 里用浏览器相同方式加载工具模块
test/*.test.mjs           单测（Node 内置 test runner，零依赖）
```

## 构建与验证

```powershell
npm run build     # 生成 dist/preview.html、dist/package/ 与 gonavi.plugin.json
npm test          # 跑全部单测
npm run check     # 静态自检：清单字段、权限、体积、沙箱禁用用法
npm run verify    # 上面三步串起来跑
```

### 用宿主 SDK 做权威校验（可选）

`scripts/check.mjs` 只检查本地能确定的规则。真正的契约判定在 GoNavi 的 Go SDK 里，
可以写一个临时程序调用 `ParseManifest` 与 `ValidateManifest`（module 路径
`github.com/Syngnat/GoNavi/sdk/go`，用 `replace` 指向本机 GoNavi 仓库的 `sdk/go`），
对 `gonavi.plugin.json` 跑一遍就能确认宿主会接受这份清单。

## 加一个新工具

1. 在 `src/tools/` 下按顺序前缀新建文件（例如 `16-hmac.js`），照 `01-json.js` 的结构写：

   ```js
   (function (GN) {
     'use strict';
     GN.register({
       id: 'hmac', group: 'hash', title: 'HMAC',
       desc: '一句话说明',
       api: { compute: compute },          // 纯函数，给单测用，不许碰 DOM
       mount: function (root) {            // 首次切到该标签时才调用
         root.appendChild(GN.ui.textarea({ placeholder: '输入…' }));
       }
     });
   })(GN);
   ```

2. 在 `test/` 下加一个 `*.test.mjs`，用 `loadTool('src/tools/16-hmac.js')` 直接测 `api`。
3. 执行 `npm run verify`。
4. 页面体积上限是 256 KiB（当前约 40 KiB），`npm run check` 会守住这条线。

写工具时必须遵守的沙箱约束（违反会在运行期直接失败）：

- 模块顶层不能碰 `document` / `window` / `navigator`，DOM 操作只能写在 `mount` 里；
- 不能用 ESM 语法、不能发起任何网络请求、不能用本地存储、不能引用任何外部资源；
- 不能用浏览器 WebCrypto 的 subtle 接口（不透明源沙箱下可用性无保证），哈希一律自研纯 JS；
- 界面只能用 `GN.ui` 提供的基元构造，样式类名沿用 `src/styles.css`。

两个容易踩的坑（都真实发生过，已由 `test/page.test.mjs` 守住）：

- **脚本块顺序是「引导 → lib → app → tools」**。`src/page.html` 顶部那行
  `var GN = { tools: [], lib: {}, groups: [] };` 是必需的：lib 与 tools 模块都以
  `(function (GN) {...})(GN)` 直接引用全局标识符 `GN`，一旦 lib 排在引导之前，
  整个 lib 块会 ReferenceError 中断、`GN.lib` 全空。
  注意单测的加载器是**注入** GN 的，所以顺序错误在单测里完全看不出来——这正是
  `test/page.test.mjs` 存在的理由：它不注入，按浏览器顺序执行构建产物。
- **`GN.ui.table(columns, rows)` 返回的就是 `<table>` 元素本身**，没有 `.tbody` 属性。
  要更新表体得先 `var body = table.querySelector('tbody')` 再操作它，否则错误分支里
  一个 `table.tbody.textContent = ''` 就会抛 TypeError，把真正的中文错误盖掉。

## 主题与外观跟随宿主

插件页读取宿主注入的 `window.gonaviHostPrefs`，把宿主的主题映射到页面自己的 CSS 变量上，
并监听 `gonavi:host-preferences` 事件——你在设置里换主题时页面会立即跟着变：

- `theme` → `data-theme="light" | "dark"`，整套深浅色变量随之切换；
- `palette` 的 `bg / panel / code / text / muted / border / border1 / accent / accentSoft / ok / warn / hover`
  分别映射到页面背景、文字、边框、品牌色、状态色与悬停底色；品牌色上该用黑字还是白字按相对亮度自动选，
  所以把主题色改成浅色也不会出现白字压白底；
- `appearance` 的 `fontFamily / monoFontFamily / radius` 映射到页面字体与圆角。

没有宿主时（例如直接用浏览器打开 `dist/preview.html`）退回系统深浅色偏好。

## 已知边界

- **没有持久化**：宿主把页面放在不透明源的沙箱 iframe 里，本地存储与 Cookie 都不可用，
  所以没有历史记录、也不会记住上次输入或主题偏好。
- **不联网**：页面无法发起请求，所以没有在线字典、云端校验之类的能力。
- **单文件上限 256 KiB**：所有工具代码都内联在这一页里，工具数量继续增长时要注意体积。
- **Cron 支持两种写法**：5 段（分 时 日 月 周，Linux crontab）与 6 段（秒 分 时 日 月 周，Quartz / Spring），
  按字段个数自动识别，5 段等价于把秒固定为 0；`L`、`W`、`#` 与第 7 段年份不支持，遇到会明确报错。
  日与周同时限定时按 Vixie cron 的「或」语义计算——注意 Quartz 会拒绝这种写法，要求其中一个写 `?`。
- **哈希只提供 MD5 / SHA-1 / SHA-256**：需要 SHA-512 或 HMAC 时按上面的步骤自己加。
- **JWT 只解码不验签**，不要用它判断令牌是否可信。
- **格式化 JSON 会先解析再重建**：超过 2^53 的整数可能丢精度，这类数据请用「校验」而不是「格式化」。

## 许可

MIT，见 [LICENSE](LICENSE)。清单里的 `id`、`author` 与版权人可按自己的情况修改。
