/**
 * scripts/check-package-metadata.mjs — the release would be broken if these disagree.
 *
 * Checks the declarations that DSH and npm actually act on, and that only a runtime
 * mistake would break:
 *   - every path declared in `dsh` / `exports` / `main` exists
 *   - the client bundle's `__ModuleLoader__` id is the package name (DSH resolves the
 *     client half by that id)
 *   - the `files` allow-list covers everything the runtime needs, and does NOT include
 *     the machine-local `python/sitecustomize.py`
 *   - no source file hardcodes an absolute path from the author's machine
 *
 * Run: node scripts/check-package-metadata.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let failed = false;
const ok = (m) => console.log(`PASS  ${m}`);
const bad = (m) => {
  failed = true;
  console.log(`FAIL  ${m}`);
};

for (const [label, path] of [
  ['main', pkg.main],
  ['exports["."]', pkg.exports['.']],
  ['exports["./client"]', pkg.exports['./client']],
  ['dsh.bundle.patch', pkg.dsh?.bundle?.patch],
]) {
  if (path === undefined) bad(`${label} 未声明`);
  else if (!existsSync(join(root, path))) bad(`${label} 指向不存在的文件：${path}`);
  else ok(`${label} -> ${path} 存在`);
}

// The client half is looked up by module id in the built bundle.
const bundle = readFileSync(join(root, pkg.exports['./client']), 'utf8');
const id = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(bundle)?.[1];
if (id === pkg.name) ok(`client bundle module id 与包名一致（${id}）`);
else bad(`client bundle 的模块 id 是 ${id}，包名是 ${pkg.name} —— 客户端半不会加载`);

// `files` must cover the runtime and must not leak the machine-local shim.
const needed = ['lib', 'assets', 'cordis.patch.yml', 'python/ur_worker.py',
  'python/URBasic/rtdeConfiguration.xml', 'python/URBasic/rtdeConfigurationDefault.xml'];
for (const want of needed) {
  const covered = pkg.files.some((f) => f === want || want.startsWith(f.replace('/**/*.py', '')));
  if (covered) ok(`files 覆盖 ${want}`);
  else bad(`files 未覆盖 ${want} —— 发布包里会缺文件`);
}
if (pkg.files.some((f) => /sitecustomize/.test(f))) bad('files 含 sitecustomize.py（本机私货，绝不能发布）');
else ok('files 不含 sitecustomize.py');

// Absolute paths from the author's machine must never reach shipped code.
const ABS = /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+/;
const offenders = [];
const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__',
  // Not shipped, not tracked: the PDFs and their extracted text, the generated meshes,
  // and the gitignored `.superpowers/` design scratch all legitimately mention local paths.
  'ScriptManual', 'assets', 'docs', '.superpowers', '.pnpm-store', '.dsh-project-memory',
]);
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(js|mjs|py|yml|json|md)$/.test(entry)) continue;
    const text = readFileSync(full, 'utf8');
    if (ABS.test(text)) offenders.push(relative(root, full).replace(/\\/g, '/'));
  }
};
walk(root);
// Two documented exceptions: the local interpreter shim (whose whole purpose is to point
// at this machine's site-packages) and the changelog, which quotes the historical
// hardcoded path it removed.
const ALLOWED = new Set(['python/sitecustomize.py', 'CHANGELOG.md', 'CHANGELOG.zh.md']);
const real = offenders.filter((f) => !ALLOWED.has(f));
if (real.length === 0) ok(`没有源文件硬编码作者机器的绝对路径（允许的例外：${[...ALLOWED].join(', ')}）`);
else bad(`以下文件硬编码了绝对路径：${real.join(', ')}`);

process.exit(failed ? 1 : 0);
