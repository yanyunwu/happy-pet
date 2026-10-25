const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testCatalogUI(admin, origin, out, checks) {
  await admin.getByRole('menuitem', { name: '关卡模板' }).click();
  await admin.getByRole('heading', { name: '关卡模板', exact: true }).waitFor();
  await admin.getByRole('button', { name: '新增模板' }).click();
  await admin.getByLabel('模板名称', { exact: true }).fill('测试用五格布局');
  await admin.getByLabel('棋盘列数', { exact: true }).fill('5');
  await admin.getByRole('button', { name: '填满本层', exact: true }).click();
  await admin.getByRole('button', { name: '保存模板', exact: true }).click();
  await admin.getByText('模板已保存', { exact: true }).waitFor();
  await admin.screenshot({ path: path.join(out, 'admin-layout-template.png'), fullPage: true });
  await admin.goto(origin + '/admin/levels');
  await admin.getByRole('tab', { name: '挑战模式', exact: true }).click();
  await admin.locator('.ant-table-tbody tr[data-row-key]').first().waitFor();
  assert.equal(await admin.locator('.ant-table-tbody tr[data-row-key]').count(), 6);
  await admin.getByRole('button', { name: '新增关卡' }).click();
  await admin.getByLabel('关卡名称', { exact: true }).fill('导入布局独立快照');
  await admin.getByLabel('首次通关金币奖励', { exact: true }).fill('37');
  await admin.getByLabel('提示免费次数', { exact: true }).fill('5');
  await admin.getByLabel('消除规则 1', { exact: true }).fill('3+2');
  await admin.getByRole('button', { name: '添加规则', exact: true }).click();
  await admin.getByLabel('消除规则 2', { exact: true }).fill('4');
  await admin.getByLabel('选择布局模板', { exact: true }).click();
  await admin.getByText('测试用五格布局', { exact: true }).click();
  await admin.getByRole('button', { name: '导入布局', exact: true }).click();
  await admin.getByRole('button', { name: '确认导入', exact: true }).click();
  assert.equal(await admin.getByLabel('鼠数量', { exact: true }).inputValue(), '3');
  assert.equal(await admin.getByLabel('首次通关金币奖励', { exact: true }).inputValue(), '37');
  assert.equal(await admin.getByLabel('提示免费次数', { exact: true }).inputValue(), '5');
  assert.equal(await admin.getByLabel('棋盘列数', { exact: true }).inputValue(), '5');
  await admin.getByRole('button', { name: '保存草稿', exact: true }).click();
  await admin.getByText('草稿已保存', { exact: true }).waitFor();
  const list = await (await admin.request.get(origin + '/api/v1/admin/levels')).json();
  const imported = list.find((level) => level.title === '导入布局独立快照');
  assert(imported && imported.entry === 'standard');
  assert.equal(imported.ordinal, 3);
  assert.equal(imported.config.layers[0].cells.length, 5);
  assert.equal(imported.config.counts[0], 3);
  assert.equal(imported.config.rewardCoins, 37);
  assert.equal(imported.config.freeTools.hint, 5);
  assert.deepEqual(imported.config.rules, [[3, 2], [4]]);
  await admin.screenshot({ path: path.join(out, 'admin-catalog-import.png'), fullPage: true });
  await admin.goto(origin + '/admin/level-templates');
  const row = admin.locator('.ant-table-tbody tr').filter({ hasText: '测试用五格布局' });
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await admin.getByLabel('棋盘列数', { exact: true }).fill('6');
  await admin.getByRole('button', { name: '填满本层', exact: true }).click();
  let releaseSave;
  const saveHeld = new Promise((resolve) => {
    releaseSave = resolve;
  });
  await admin.route('**/api/v1/admin/level-templates/*', async (route) => {
    if (route.request().method() === 'PUT') await saveHeld;
    await route.continue();
  });
  await admin.getByLabel('棋盘行数', { exact: true }).hover();
  const rowStep = await admin
    .locator('.layout-editor .ant-input-number')
    .nth(1)
    .getByRole('button', { name: 'Increase Value' })
    .boundingBox();
  assert(rowStep);
  const rowsBeforeSave = await admin.getByLabel('棋盘行数', { exact: true }).inputValue();
  await admin.getByRole('button', { name: '保存模板', exact: true }).click();
  assert(await admin.getByLabel('模板名称', { exact: true }).isDisabled());
  assert(await admin.getByRole('button', { name: '填满本层', exact: true }).isDisabled());
  await admin.mouse.click(rowStep.x + rowStep.width / 2, rowStep.y + rowStep.height / 2);
  assert.equal(
    await admin.getByLabel('棋盘行数', { exact: true }).inputValue(),
    rowsBeforeSave,
    'stepper clicks cannot change geometry while saving',
  );
  releaseSave();
  await admin.getByText('模板已保存', { exact: true }).waitFor();
  await admin.unroute('**/api/v1/admin/level-templates/*');
  await admin.getByRole('button', { name: '关闭', exact: true }).click();
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await admin.getByRole('button', { name: '删除模板', exact: true }).click();
  await row.waitFor({ state: 'hidden' });
  const after = await (await admin.request.get(origin + '/api/v1/admin/levels')).json();
  assert.deepEqual(after.find((level) => level.id === imported.id).config, imported.config);
  checks.push('challenge/campaign catalog and geometry-only template CRUD/import snapshots');
  await admin.goto(origin + '/admin/levels');
};
