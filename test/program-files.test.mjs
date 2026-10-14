/**
 * `lib/program-files.js` 的单元测试 —— 本地路径牢笼与远端路径形状检查。
 *
 * 这一层是"让模型上传/下载程序文件"这件事的安全边界，所以测的重点不是"正常路径能用"，
 * 而是**每一种逃逸都被拒绝**：`..`、目录外绝对路径、指向目录外的软链、非 `.urp`、
 * 未配置 programDir（fail closed）。
 *
 * 运行：node --test test/program-files.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_MAX_PROGRAM_BYTES,
  checkLocalPath,
  checkProgramTransfer,
  checkRemotePath,
  defaultProgramDir,
} from '../lib/program-files.js';

async function makeRoot(t) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-prog-'));
  const root = join(base, 'programs');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'pick.urp'), '<urp/>');
  await mkdir(join(root, 'sub'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, root };
}

test('相对路径按 programDir 解析；读模式带回大小', async (t) => {
  const { root } = await makeRoot(t);
  const out = checkLocalPath('pick.urp', { root, mode: 'read' });
  assert.equal(out.ok, true);
  assert.equal(out.path, join(root, 'pick.urp'));
  assert.equal(out.size, 6, '必须把大小带出来（调用方据此判上限）');
});

test('programDir 内的绝对路径可以用', async (t) => {
  const { root } = await makeRoot(t);
  const out = checkLocalPath(join(root, 'pick.urp'), { root, mode: 'read' });
  assert.equal(out.ok, true);
});

test('★ 每一种逃逸都必须被拒（这是这一层存在的理由）', async (t) => {
  const { base, root } = await makeRoot(t);
  const cases = [
    ['..\\escape.urp', '相对路径带 ..'],
    ['../escape.urp', '相对路径带 ../'],
    ['sub/../../escape.urp', '中途折返'],
    [join(base, 'outside.urp'), '目录外的绝对路径'],
    ['pick.txt', '非 .urp 扩展名'],
    ['no-extension', '没有扩展名'],
    ['missing.urp', '读一个不存在的文件'],
    ['sub', '读一个目录'],
  ];
  for (const [input, why] of cases) {
    const out = checkLocalPath(input, { root, mode: 'read' });
    assert.equal(out.ok, false, `“${input}”（${why}）必须被拒绝`);
    assert.ok(typeof out.reason === 'string' && out.reason.length > 0, '必须给出原因');
  }
});

test('★ 未配置 programDir ⇒ fail closed（不读也不写任何本地文件）', async (t) => {
  const { root } = await makeRoot(t);
  for (const bad of ['', '   ', undefined, null]) {
    const out = checkLocalPath('pick.urp', { root: bad, mode: 'read' });
    assert.equal(out.ok, false, `root=${JSON.stringify(bad)} 必须 fail closed`);
  }
  // 配置了但目录不存在同样拒绝（否则会在一个谁都不知道的位置读/写）。
  const out = checkLocalPath('pick.urp', { root: join(root, 'nope'), mode: 'read' });
  assert.equal(out.ok, false);
});

test('写模式：父目录必须在；目标文件可以先不存在', async (t) => {
  const { root } = await makeRoot(t);
  assert.equal(checkLocalPath('new.urp', { root, mode: 'write' }).ok, true);
  assert.equal(checkLocalPath('sub/nested.urp', { root, mode: 'write' }).ok, true);
  const missingParent = checkLocalPath('ghost/new.urp', { root, mode: 'write' });
  assert.equal(missingParent.ok, false, '父目录不存在必须拒绝（本插件不替调用方创建目录）');
  assert.match(missingParent.reason, /父目录不存在/);
});

test('★ 软链逃逸：字符串里没有 .. 也必须挡住（判据是 realpath 之后的结果）', async (t) => {
  const { base, root } = await makeRoot(t);
  const outside = join(base, 'outside-dir');
  await mkdir(outside, { recursive: true });
  try {
    await symlink(outside, join(root, 'link'), 'junction');
  } catch {
    t.skip('本机无法创建符号链接（Windows 需要开发者模式/权限），跳过软链逃逸用例');
    return;
  }
  const asWrite = checkLocalPath('link/planted.urp', { root, mode: 'write' });
  assert.equal(asWrite.ok, false, '父目录 realpath 落在 programDir 之外必须拒绝');
  assert.match(asWrite.reason, /programDir 之外|逃出了 programDir/);
});

test('远端路径：绝对、无 ..、且必须是 .urp', () => {
  assert.equal(checkRemotePath('/programs/pick.urp').ok, true);
  assert.equal(checkRemotePath('  /programs/pick.urp  ').path, '/programs/pick.urp', '两侧空白应被裁掉');
  for (const [bad, why] of [
    ['pick.urp', '不是绝对路径'],
    ['programs/pick.urp', '相对路径'],
    ['/programs/../etc/pick.urp', '带 .. 段'],
    ['/programs/pick.txt', '非 .urp'],
    ['C:\\programs\\pick.urp', 'Windows 盘符路径在机器人上无意义'],
    ['', '空串'],
  ]) {
    const out = checkRemotePath(bad);
    assert.equal(out.ok, false, `“${bad}”（${why}）必须被拒绝`);
  }
});

test('默认值与上限：programDir 落在 DSH 数据目录下，上限 1 MiB', () => {
  // ⚠️ 这里**不要**写"作者机器上的家目录"那种绝对路径 —— 连注释里写都会被
  // `check-package-metadata.mjs` 判成缺陷（它是按文件文本扫的，注释也算）。用相对路径测组合关系即可。
  const home = join('home', 'dev', '.dsh');
  assert.equal(defaultProgramDir(home), join(home, 'nonead-ur', 'programs'));
  assert.equal(DEFAULT_MAX_PROGRAM_BYTES, 1024 * 1024);
});

test('checkProgramTransfer：把"远端形状 + 本地牢笼 + 大小上限"串成一次判定', async (t) => {
  const { root } = await makeRoot(t);
  const upload = { local_path: 'pick.urp', remote_path: '/programs/pick.urp' };

  assert.equal(checkProgramTransfer('upload_program', upload, { root }), null, '合法上传应放行');
  assert.equal(
    checkProgramTransfer('download_program', { local_path: 'new.urp', remote_path: '/programs/pick.urp' }, { root }),
    null,
    '合法下载应放行（写模式允许目标不存在）',
  );

  assert.match(
    checkProgramTransfer('upload_program', { ...upload, remote_path: 'pick.urp' }, { root }).reason,
    /绝对路径/,
    '远端相对路径必须被拒',
  );
  assert.match(
    checkProgramTransfer('upload_program', { ...upload, local_path: '../escape.urp' }, { root }).reason,
    /programDir/,
    '本地逃逸必须被拒',
  );
  assert.match(
    checkProgramTransfer('upload_program', upload, { root, maxBytes: 3 }).reason,
    /超过上限/,
    '超过大小上限必须被拒',
  );
  assert.match(
    checkProgramTransfer('rm_rf', upload, { root }).reason,
    /未知的程序文件操作/,
    '未知 op 必须被拒（默认拒绝，不是默认放行）',
  );
  // 未配置 programDir ⇒ fail closed，连合法远端路径也不放行。
  assert.ok(checkProgramTransfer('upload_program', upload, { root: '' }) !== null);
});
