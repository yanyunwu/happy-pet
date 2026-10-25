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
  const ruleChoice = (name) => admin.getByRole('radio', { name, exact: true });
  const selectRule = (name) =>
    admin
      .locator('.rule-editor label')
      .filter({ has: ruleChoice(name) })
      .click();
  const customRule = admin.getByLabel('其他消除组合', { exact: true });
  const saveDraft = admin.getByRole('button', { name: /保存草稿$/ });
  const preview = admin.getByRole('button', { name: '校验并预览', exact: true });
  for (const name of ['4', '2+2', '3']) {
    await selectRule(name);
    assert(await ruleChoice(name).isChecked());
    assert.equal(await admin.locator('.rule-editor input[type="radio"]:checked').count(), 1);
  }
  assert.equal(await admin.getByRole('button', { name: '添加规则', exact: true }).count(), 0);
  await selectRule('其他');
  await customRule.fill('2++2');
  assert(await saveDraft.isDisabled());
  assert(await preview.isDisabled());
  await customRule.fill('');
  await customRule.pressSequentially('3+2');
  assert(await ruleChoice('其他').isChecked());
  assert(await saveDraft.isEnabled());
  await admin.getByLabel('选择布局模板', { exact: true }).click();
  await admin.getByText('测试用五格布局', { exact: true }).click();
  await admin.getByRole('button', { name: '导入布局', exact: true }).click();
  await admin.getByRole('button', { name: '确认导入', exact: true }).click();
  assert.equal(await admin.getByLabel('鼠数量', { exact: true }).inputValue(), '3');
  assert.equal(await admin.getByLabel('首次通关金币奖励', { exact: true }).inputValue(), '37');
  assert.equal(await admin.getByLabel('提示免费次数', { exact: true }).inputValue(), '5');
  assert.equal(await admin.getByLabel('棋盘列数', { exact: true }).inputValue(), '5');
  let releaseLevelSave;
  const levelSaveHeld = new Promise((resolve) => {
    releaseLevelSave = resolve;
  });
  let levelSaveStarted;
  const levelSavePending = new Promise((resolve) => {
    levelSaveStarted = resolve;
  });
  await admin.route('**/api/v1/admin/levels', async (route) => {
    if (route.request().method() === 'POST') {
      levelSaveStarted();
      await levelSaveHeld;
    }
    await route.continue();
  });
  await saveDraft.click();
  await levelSavePending;
  for (const name of ['3', '4', '2+2', '其他']) assert(await ruleChoice(name).isDisabled());
  assert(await customRule.isDisabled());
  assert(await preview.isDisabled());
  releaseLevelSave();
  await admin.getByText('草稿已保存', { exact: true }).waitFor();
  await admin.unroute('**/api/v1/admin/levels');
  assert(await customRule.isEnabled());
  const list = await (await admin.request.get(origin + '/api/v1/admin/levels')).json();
  const imported = list.find((level) => level.title === '导入布局独立快照');
  assert(imported && imported.entry === 'standard');
  assert.equal(imported.ordinal, 3);
  assert.equal(imported.config.layers[0].cells.length, 5);
  assert.equal(imported.config.counts[0], 3);
  assert.equal(imported.config.rewardCoins, 37);
  assert.equal(imported.config.freeTools.hint, 5);
  assert.deepEqual(imported.config.rules, [[3, 2]]);
  await selectRule('4');
  assert.equal(await customRule.count(), 0);
  await admin.getByRole('button', { name: '关闭', exact: true }).click();
  await admin.getByRole('dialog').waitFor({ state: 'hidden' });
  await admin
    .locator(`tr[data-row-key="${imported.id}"]`)
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  assert(await ruleChoice('其他').isChecked());
  assert.equal(await customRule.inputValue(), '3+2', 'reopening must use the saved single rule');
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
  checks.push(
    'single-rule selection, invalid Other, save lock/reopen, challenge/campaign catalog and geometry-only template snapshots',
  );
  await admin.goto(origin + '/admin/levels');
};
