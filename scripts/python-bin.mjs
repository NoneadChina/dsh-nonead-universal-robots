/**
 * scripts/python-bin.mjs — 找到**真正可用**的 Python 解释器。
 *
 * ## 为什么需要它（真机踩出来的）
 * `npm run check:ops` 直接用裸名字 `python`，在 Windows 上会撞两种很常见的坏环境：
 *
 *   1. **Microsoft Store 的占位别名**：`C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\python.exe`
 *      排在 PATH 前面，但真正执行时报 `exit 9009`（不是 Python 报错，是 cmd 找不到可执行体）——
 *      npm 只会告诉你 `npm error code 9009`，看不出是"解释器没装"。
 *   2. **`py` 启动器指向已删除的解释器**：注册表里留着旧版本（例如 3.14），`py` 默认取它，
 *      于是 `py --version` 报 `Unable to create process using 'C:\Python314\python.exe'`（exit 101）。
 *
 * 所以"能不能用"不能按名字判断，只能**真的跑一下**（`-c "import sys; print(sys.executable)"`），
 * 并且按下面的顺序找：显式环境变量 → 项目内虚拟环境 → PATH 上的规范名字 → `py` 启动器 →
 * `py -0p` 列出的已注册安装 → 常见安装目录。
 *
 * 纯 Node（只用 node: 内置模块），`run`/`exists` 可注入，因此不装 Python 也能被单测钉住。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';

/** 验证解释器用的代码：打印真实可执行体路径。打印成功 = 真的能启动。 */
const VERIFY_CODE = 'import sys; print(sys.executable)';

/**
 * 收集候选解释器（按优先级）。每一项是 `{ label, command, prefixArgs }`。
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env=process.env]
 * @param {string} [options.cwd=process.cwd()]
 * @param {(p: string) => boolean} [options.exists=existsSync]
 * @param {(cmd: string, args: string[]) => {status: number|null, stdout?: string}} [options.run]
 *   用于 `py -0p` 这类"先问一下装在哪"的探测（注入点，测试里不需要真的装 Python）
 * @returns {Array<{label: string, command: string, prefixArgs: string[]}>}
 */
export function candidateList(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const run = options.run ?? defaultRun;
  const isWindows = process.platform === 'win32';
  const out = [];
  const push = (label, command, prefixArgs = []) => {
    if (typeof command !== 'string' || command === '') return;
    if (!out.some((c) => c.command === command && c.prefixArgs.join('\u0000') === prefixArgs.join('\u0000'))) {
      out.push({ label, command, prefixArgs });
    }
  };

  // 1) 显式指定优先：README 与 test/selftest.test.mjs 一直用 `UR_PYTHON || PYTHON`
  if (env.UR_PYTHON) push('UR_PYTHON', env.UR_PYTHON);
  if (env.PYTHON) push('PYTHON', env.PYTHON);

  // 2) 项目内虚拟环境：`python -m venv .venv` 之后直接可用，不必动系统 PATH
  for (const venv of ['.venv', 'venv']) {
    push(`${venv}`, join(cwd, venv, isWindows ? join('Scripts', 'python.exe') : join('bin', 'python')));
  }

  // 3) PATH 上的规范名字（POSIX 上通常就是 `python3`）
  push('python3', 'python3');
  push('python', 'python');

  // 4) Windows 启动器：`py -3` 取最新已装版本；`py -0p` 列出全部注册安装
  if (isWindows) {
    push('py -3', 'py', ['-3']);
    let listed = '';
    try {
      const res = run('py', ['-0p']);
      listed = typeof res?.stdout === 'string' ? res.stdout : '';
    } catch {
      listed = '';
    }
    // 形如 ` -V:3.12 *        C:\...\python.exe`：取行尾那个绝对路径，且必须真的存在。
    for (const line of listed.split(/\r?\n/)) {
      const match = line.match(/([A-Za-z]:\\.*?python\.exe)\s*$/i);
      if (match && exists(match[1])) push(`py -0p → ${match[1]}`, match[1]);
    }

    // 5) 常见安装目录（`py -0p` 也可能什么都没登记）
    const programDirs = [
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Python'),
      'C:\\Program Files\\Python',
      'C:\\',
    ].filter(Boolean);
    for (const dir of programDirs) {
      let names = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names.filter((n) => /^Python3\d*$/i.test(n)).sort().reverse()) {
        const exe = join(dir, name, 'python.exe');
        if (exists(exe)) push(`扫描发现 ${exe}`, exe);
      }
    }
  }
  return out;
}

/** 默认探测实现：只用于 `py -0p` 这类"问装在哪"，不用于执行用户脚本。 */
function defaultRun(command, args) {
  try {
    return spawnSync(command, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  } catch {
    return { status: null, stdout: '' };
  }
}

/**
 * 解析出一个**真的能启动**的解释器。
 *
 * @param {object} [options] 同 {@link candidateList}，另有：
 * @param {(candidate: {label: string, command: string, prefixArgs: string[]}) => {status: number|null, stdout?: string, stderr?: string}} [options.spawn]
 *   实际执行探测代码的函数（注入点；默认 `spawnSync(..., { stdio: 'pipe' })`）
 * @param {string[]} [options.extraArgs] 额外透传的探测参数（一般不用）
 * @returns {{ok: boolean, command: string, prefixArgs: string[], executable: string|null, label: string|null,
 *            tried: Array<{label: string, command: string, status: number|null, reason: string}>, reason: string}}
 */
export function resolvePython(options = {}) {
  const spawn = options.spawn ?? defaultSpawn;
  const candidates = candidateList(options);
  const tried = [];

  for (const candidate of candidates) {
    let res;
    try {
      res = spawn(candidate, ['-c', VERIFY_CODE]);
    } catch (error) {
      const code = error?.code ?? error?.message ?? String(error);
      tried.push({ ...candidate, status: null, reason: `无法启动（${code}）` });
      continue;
    }
    const status = res?.status ?? null;
    const stdout = typeof res?.stdout === 'string' ? res.stdout.trim() : '';
    if (status === 0 && stdout !== '') {
      return {
        ok: true,
        command: candidate.command,
        prefixArgs: candidate.prefixArgs,
        executable: stdout.split(/\r?\n/).pop() ?? null,
        label: candidate.label,
        tried,
        reason: '',
      };
    }
    const stderr = typeof res?.stderr === 'string' ? res.stderr.trim().split(/\r?\n/).pop() ?? '' : '';
    // `status === null` 表示**没能启动**（而不是"跑起来但退出码非 0"）：最常见的是沙箱拒绝建管道
    // （EPERM/ENOENT），或该路径根本不是可执行文件。这两种必须分开报，否则会误以为是解释器坏了。
    const spawnError = typeof res?.error === 'string' && res.error !== '' ? res.error : '';
    // 9009 = cmd 找不到可执行体（Store 占位别名就是这样）；101/103 = py 启动器找不到解释器
    const hint = status === null
      ? spawnError ? `（无法启动：${spawnError}）` : '（无法启动：没有拿到退出码）'
      : status === 9009 ? '（cmd 9009：这不是 Python 报错，是可执行文件不存在——多半是 Microsoft Store 的占位别名）'
        : status === 101 || status === 103 ? '（py 启动器指向的解释器不存在）'
          : stderr ? `（${stderr}）` : '';
    tried.push({ ...candidate, status, reason: status === null ? hint.replace(/^（|）$/g, '') : `exit ${status}${hint}` });
  }

  const lines = tried.map((t) => `  - ${t.label.padEnd(24)} ${t.command}  → ${t.reason}`);
  return {
    ok: false,
    command: '',
    prefixArgs: [],
    executable: null,
    label: null,
    tried,
    reason:
      '找不到可用的 Python 解释器。已按顺序尝试：\n' +
      (lines.length > 0 ? `${lines.join('\n')}\n` : '  （没有可尝试的候选）\n') +
      '修复方式（任选其一）：\n' +
      '  1) 建项目虚拟环境并装依赖：\n' +
      '       python -m venv .venv\n' +
      '       .venv\\Scripts\\python.exe -m pip install -r requirements.txt   （Windows）\n' +
      '       .venv/bin/python -m pip install -r requirements.txt           （macOS / Linux）\n' +
      '  2) 显式指定解释器：UR_PYTHON=C:\\Path\\to\\python.exe\n' +
      '  3) 修好 PATH 上的 `python`（注意 Windows 上 Microsoft Store 的占位别名会报 exit 9009）',
  };
}

function defaultSpawn(candidate, args) {
  try {
    return spawnSync(candidate.command, [...candidate.prefixArgs, ...args], {
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
    });
  } catch (error) {
    // 把"为什么启动不了"带回去：沙箱拒绝建管道（EPERM）与"文件不存在"必须能区分开。
    return {
      status: null,
      stdout: '',
      stderr: String(error?.message ?? error),
      error: String(error?.code ?? error?.message ?? error),
    };
  }
}
