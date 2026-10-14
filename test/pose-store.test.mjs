/**
 * `lib/pose-store.js` 的单元测试 —— 命名位姿表的**名字牢笼**与保存前校验。
 *
 * 测的重点不是"正常名字能用"，而是每一种**逃逸与畸形**都被挡住：名字里的路径分隔符、
 * 只有点号的怪名字、目录不存在、把文件当目录、向量形状不对、以及"只给名字不给数值"的空位姿。
 *
 * 运行：node --test test/pose-store.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import {
  DEFAULT_MAX_POSES,
  MAX_POSE_FILE_BYTES,
  checkPoseForSave,
  checkPoseName,
  checkPoseQuota,
  checkPoseVector,
  countPoses,
  defaultPoseDir,
  ensurePoseDir,
  resolvePosePath,
} from '../lib/pose-store.js';

async function makeRoot(t) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-poses-'));
  const root = join(base, 'poses');
  await mkdir(root, { recursive: true });
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, root };
}

test('位姿名白名单：中文可用，路径分隔符 / Windows 非法字符 / 保留名一律拒绝', () => {
  for (const good of ['home', 'Home_1', 'pick.up', 'a-b', '工位 1', '取料位', 'x'.repeat(64)]) {
    assert.equal(checkPoseName(good).ok, true, `“${good}” 应放行`);
  }
  for (const bad of ['', '   ', 'a/b', 'a\\b', '../evil', 'a..b/c', 'x'.repeat(65),
    ' home', 'home ', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', '.hidden', '-dash',
    'a\nb', 'a\tb', 'CON', 'nul', 'Com1', 5, null, undefined]) {
    const out = checkPoseName(bad);
    assert.equal(out.ok, false, `“${String(bad)}” 应被拒绝`);
    assert.ok(typeof out.reason === 'string' && out.reason.length > 0, '必须给出原因');
  }
});

test('★ 两层防线：怪名字在名字层被拒；被放行的名字一定落在目录内（不变量）', async (t) => {
  const { root } = await makeRoot(t);

  // 第一层（名字白名单）：必须字母/数字开头 —— `..`、`.`、`...`、`-dash`、`.hidden` 都在这里被拒。
  for (const weird of ['..', '.', '...', '-dash', '.hidden']) {
    const out = resolvePosePath(weird, { root });
    assert.equal(out.ok, false, `“${weird}” 必须在名字层就被拒绝`);
    assert.match(out.reason, /位姿名/, '拒绝理由要指向名字规则');
  }

  // 第二层（结构判定）是**纵深防御**：名字规则收紧后它已不可达，但只要将来放宽名字规则，它仍拦得住。
  // 这里验证的是真正有意义的不变量 —— 凡是名字层放行的名字，解析结果必然落在位姿目录内。
  for (const good of ['home', 'a..b', '工位 1', 'x'.repeat(64)]) {
    const out = resolvePosePath(good, { root });
    assert.equal(out.ok, true, `“${good}” 应放行`);
    assert.ok(out.path.startsWith(out.dir + sep), `结果必须落在位姿目录内：${out.path}`);
    assert.ok(out.path.endsWith('.json'), '必须是 .json 文件');
    assert.equal(relative(out.dir, out.path), `${good}.json`, '文件名就是"名字 + .json"，不含任何目录成分');
  }
});

test('★ 未配置、或目录不存在／不是目录 ⇒ fail closed（不猜位置、不自动创建）', async (t) => {
  const { base, root } = await makeRoot(t);
  assert.equal(resolvePosePath('home', { root: '' }).ok, false);
  assert.equal(resolvePosePath('home', { root: '   ' }).ok, false);
  assert.match(resolvePosePath('home', { root: '' }).reason, /fail closed/);
  assert.equal(resolvePosePath('home', { root: join(base, 'nope') }).ok, false, '目录不存在必须拒绝');
  const asFile = join(base, 'not-a-dir');
  await writeFile(asFile, 'x');
  assert.equal(resolvePosePath('home', { root: asFile }).ok, false, '把文件当目录必须拒绝');
});

test('resolvePosePath：正常解析出目录内的 .json 绝对路径', async (t) => {
  const { root } = await makeRoot(t);
  const out = resolvePosePath('home', { root });
  assert.equal(out.ok, true);
  assert.equal(out.name, 'home');
  assert.equal(out.path, join(out.dir, 'home.json'));
});

test('★ checkPoseVector：必须正好 6 个有限数', () => {
  assert.deepEqual(checkPoseVector([0, 0, 0, 0, 0, 0], 'pose').value, [0, 0, 0, 0, 0, 0]);
  for (const bad of [[1, 2, 3], [1, 2, 3, 4, 5, 6, 7], 'x', null,
    [1, 2, 3, 4, 5, Number.NaN], [1, 2, 3, 4, 5, Number.POSITIVE_INFINITY],
    [1, 2, 3, 4, 5, '6']]) {
    assert.equal(checkPoseVector(bad, 'pose').ok, false, `${JSON.stringify(bad)} 应被拒绝`);
  }
});

test('★ checkPoseForSave：空位姿没有意义；capture=true 时才允许不给数值', async (t) => {
  const { root } = await makeRoot(t);
  const empty = checkPoseForSave({ name: 'home', root });
  assert.equal(empty.ok, false, '只给名字不给任何数值必须拒绝');
  assert.match(empty.reason, /没有意义/);

  const captured = checkPoseForSave({ name: 'home', capture: true, root });
  assert.equal(captured.ok, true, '要求从机器人捕获时允许不给数值');
  assert.equal(captured.path, join(captured.dir, 'home.json'));

  const withPose = checkPoseForSave({ name: 'home', pose: [0.1, 0.2, 0.3, 0, 0, 0], root });
  assert.equal(withPose.ok, true);
  assert.deepEqual(withPose.pose, [0.1, 0.2, 0.3, 0, 0, 0]);

  const both = checkPoseForSave({
    name: 'home', pose: [0, 0, 0, 0, 0, 0], joints: [0, -1.57, 0, -1.57, 0, 0], root,
  });
  assert.equal(both.ok, true);
  assert.ok(Array.isArray(both.joints), '两个都给时应都带上');

  assert.equal(
    checkPoseForSave({ name: 'home', pose: [1, 2], root }).ok,
    false,
    '位姿形状不对必须拒绝',
  );
  assert.equal(
    checkPoseForSave({ name: '../evil', pose: [0, 0, 0, 0, 0, 0], root }).ok,
    false,
    '名字不合法时必须在写盘之前就拒绝',
  );
});

test('位姿条目上限：到顶了就明确拒绝，并告诉调用方怎么办', () => {
  assert.equal(checkPoseQuota(0).ok, true);
  assert.equal(checkPoseQuota(DEFAULT_MAX_POSES - 1).ok, true);
  const full = checkPoseQuota(DEFAULT_MAX_POSES);
  assert.equal(full.ok, false);
  assert.match(full.reason, /ur_delete_pose/);
  assert.equal(checkPoseQuota(Number.NaN).ok, true, '数不出来时不要误拦');
});

test('★ countPoses：只数 .json；目录不存在算 0 条；**读不了则拒绝而不退化成 0**', async (t) => {
  const { base, root } = await makeRoot(t);
  await writeFile(join(root, 'home.json'), '{}');
  await writeFile(join(root, 'work.json'), '{}');
  await writeFile(join(root, 'notes.txt'), 'x');
  assert.deepEqual(countPoses(root), { ok: true, count: 2 });

  // 带名字时一并回报"这个名字是否已存在" —— 表满时更新已有位姿仍应允许。
  assert.equal(countPoses(root, { name: 'home' }).existing, true);
  assert.equal(countPoses(root, { name: 'nope' }).existing, false);

  assert.deepEqual(
    countPoses(join(base, 'missing')),
    { ok: true, count: 0, existing: false },
    '目录不存在 ≠ 读失败',
  );
  assert.deepEqual(
    countPoses('whatever', { deps: { readdir: () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } } }),
    { ok: true, count: 0, existing: false },
  );

  // ★ 关键：真的读不了时**不能**当成 0 条 —— 那会让配额静默失效，而调用方以为一切正常。
  const denied = countPoses('whatever', {
    deps: { readdir: () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; } },
  });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /EACCES/);
  assert.match(denied.reason, /拒绝写入/);
});

test('★ 配额：表满了拒绝**新增**，但**更新已有**位姿仍然放行', () => {
  assert.equal(checkPoseQuota(DEFAULT_MAX_POSES, DEFAULT_MAX_POSES).ok, false);
  assert.equal(
    checkPoseQuota(DEFAULT_MAX_POSES, DEFAULT_MAX_POSES, { existing: true }).ok,
    true,
    '表满时更新一条已存在的位姿不该被拒（否则连改一下再存都做不了）',
  );
});

test('★ ensurePoseDir：首次保存时自建数据目录；建不出来则如实拒绝', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-poses-ensure-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const target = join(base, 'a', 'b', 'poses');
  assert.equal(existsSync(target), false, '前置条件：目录还不存在');
  const made = ensurePoseDir(target);
  assert.equal(made.ok, true);
  assert.equal(existsSync(made.dir), true, '应把多级目录一次建出来');
  // 已存在时是幂等的。
  assert.equal(ensurePoseDir(target).ok, true);
  assert.equal(ensurePoseDir('').ok, false, '未配置必须 fail closed');
  const denied = ensurePoseDir('whatever', {
    deps: { mkdir: () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; } },
  });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /EACCES/);
});

test('默认值与上限：位姿目录在 DSH 数据目录下，单文件上限 64 KiB', () => {
  // ⚠️ 这里不要写"作者机器上的家目录"那种绝对路径 —— check-package-metadata 是按文件文本扫的。
  const home = join('home', 'dev', '.dsh');
  assert.equal(defaultPoseDir(home), join(home, 'nonead-ur', 'poses'));
  assert.equal(MAX_POSE_FILE_BYTES, 64 * 1024);
});
