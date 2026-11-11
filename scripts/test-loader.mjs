/* 测试加载器：在 Node 里用与浏览器相同的方式执行 src 下的 IIFE 模块。
   src 模块不依赖 ESM，而是通过 GN 参数注入，因此 new Function 就能复现页面运行环境。
   放在 scripts/ 而不是 test/，避免被 node --test 的目录扫描当成测试文件。 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

export function loadGN(files) {
  const GN = {
    tools: [],
    lib: {},
    groups: [],
    register(tool) { this.tools.push(tool); }
  };
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    new Function('GN', source)(GN);
  }
  return GN;
}

// 加载指定工具模块（可先加载它依赖的 lib），返回该工具对象。
export function loadTool(file, libFiles = []) {
  const gn = loadGN([...libFiles, file]);
  if (!gn.tools.length) { throw new Error(file + ' 未调用 GN.register'); }
  return { GN: gn, tool: gn.tools[gn.tools.length - 1] };
}
