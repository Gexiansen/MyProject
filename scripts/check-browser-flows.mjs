import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function runFinanceFlows(browser, { baseUrl, password, width }) {
  const url = new URL(baseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:', '只允许独立本机验收服务');
  assert.ok([390, 1280].includes(width), '验收宽度必须为 390 或 1280');
  const run = `${Date.now()}-${width}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-acceptance-'));
  const tab = await browser.tabs.new();
  const viewport = await browser.capabilities.get('viewport');
  const p = tab.playwright;
  const button = (name) => p.getByRole('button', { name, exact: true });
  let lastSnapshot = '';
  const observe = async () => { lastSnapshot = await p.domSnapshot(); return lastSnapshot; };
  const stored = () => p.evaluate(() => {
    if (document.documentElement.dataset.acceptancePage !== 'synthetic-only') throw new Error('不是合成数据验收页面');
    return document.documentElement.dataset.acceptanceStored;
  });
  const data = async () => JSON.parse(await stored());
  const unlock = async () => {
    await observe();
    await stored();
    await p.getByRole('textbox', { name: '6位数字密码', exact: true }).fill(password);
    await button('打开').click();
    await observe();
  };
  const openMenu = async (name) => {
    await button('更多').click(); await observe();
    await p.getByRole('menuitem', { name, exact: true }).click(); await observe();
  };
  const selectMonth = async (month) => { await p.getByLabel('查看已有月份').selectOption(month); await observe(); };
  const editAmount = async (name, value) => {
    const input = p.getByRole('textbox', { name: new RegExp(`^共同 ${name}( 待处理)?$`) });
    await input.fill(''); await observe();
    await input.fill(String(value)); await observe();
    await p.getByRole('textbox', { name: new RegExp(`^共同 ${name}( 待处理)?$`) }).press('Tab'); await observe();
  };
  const closeMonth = async () => {
    await button('完成本月结账').click(); await observe();
    await p.getByRole('button', { name: /^(确认结账|确认以上数值并结账)$/ }).click(); await observe();
  };
  const reopen = async () => {
    await button('重新编辑').click(); await observe();
    await button('确认重新编辑').click(); await observe();
  };
  const createMonth = async () => {
    const month = await p.getByLabel('新建月份').evaluate((input) => input.value);
    assert.match(month, /^\d{4}-(0[1-9]|1[0-2])$/);
    await button('新建月份').click(); await observe();
    return month;
  };
  const upload = async (file, recovering = false) => {
    const chooser = p.waitForEvent('filechooser', { timeoutMs: 10000 });
    if (recovering) await p.getByText('导入备份恢复', { exact: true }).click();
    else await openMenu('导入数据');
    await (await chooser).setFiles(file);
    await observe();
  };
  const download = async (action) => {
    await action();
    await p.locator('#acceptance-download').waitFor({ state: 'visible', timeoutMs: 10000 });
    const text = await p.evaluate(() => document.documentElement.dataset.acceptanceDownload);
    assert.equal(typeof text, 'string', '未捕获应用生成的导出内容');
    const file = path.join(output, `export-${Date.now()}.json`);
    await fs.writeFile(file, text);
    return file;
  };
  const layout = async () => {
    const size = await p.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(size.width, width);
    assert.ok(size.scroll <= size.width, '页面存在横向溢出');
  };
  try {
    await viewport.set({ width, height: 900 });
    await tab.goto(`${baseUrl}/?run=${run}`);
    await unlock();
    assert.equal(Object.keys((await data()).records).length, 0);
    await button('开始月度结账').click(); await observe();
    const firstMonth = await createMonth();
    assert.equal((await data()).monthMeta[firstMonth].inheritedBalanceIds.length, 2);
    assert.equal(await button('新建月份').isEnabled(), false);
    if (width === 390) { await p.getByRole('button', { name: /^共同/ }).click(); await observe(); }
    for (const [name, value] of [['验收现金', 100000], ['验收负债', 20000], ['验收收入', 10000], ['验收支出', 5000]]) await editAmount(name, value);
    await closeMonth();
    assert.equal((await data()).monthStatus[firstMonth], 'closed');
    assert.equal((await data()).goalHistory[firstMonth].goal.currentAmount, 100000);
    assert.equal(await button('新建月份').isEnabled(), true);
    await tab.reload(); await unlock(); await openMenu('月度结账');
    assert.equal((await data()).records[firstMonth].cash, 100000);
    assert.equal((await data()).monthStatus[firstMonth], 'closed');
    const secondMonth = await createMonth();
    if (width === 390) { await p.getByRole('button', { name: /^共同/ }).click(); await observe(); }
    for (const [name, value] of [['验收现金', 98000], ['验收负债', 19000], ['验收收入', 0], ['验收支出', 2000]]) await editAmount(name, value);
    await closeMonth(); await layout();

    await selectMonth(firstMonth); await reopen(); await editAmount('验收现金', 90000); await closeMonth();
    assert.equal((await data()).monthMeta[secondMonth].reviewRequired, true);
    assert.equal((await data()).monthStatus[secondMonth], 'closed');
    await selectMonth(secondMonth);
    assert.ok((await observe()).includes('需要复核'));
    await reopen(); await closeMonth();
    assert.equal((await data()).monthMeta[secondMonth].reviewRequired, undefined);
    assert.equal((await data()).goalHistory[firstMonth].goal.currentAmount, 90000);
    assert.equal((await data()).goalHistory[secondMonth].goal.currentAmount, 98000);

    const backup = await download(() => openMenu('导出数据'));
    const exported = JSON.parse(await fs.readFile(backup, 'utf8'));
    assert.deepEqual(exported.records, (await data()).records);
    assert.deepEqual(exported.goalHistory, (await data()).goalHistory);
    assert.equal(exported.monthStatus[secondMonth], 'closed');
    await reopen(); await editAmount('验收现金', 97000); await closeMonth();
    await upload(backup);
    assert.ok((await observe()).includes('确认覆盖并导入'));
    await button('取消').click(); await observe();
    assert.equal((await data()).records[secondMonth].cash, 97000);
    await upload(backup); await button('确认覆盖并导入').click(); await observe();
    assert.deepEqual((await data()).records, exported.records);
    assert.deepEqual((await data()).goalHistory, exported.goalHistory);
    await tab.reload(); await unlock();
    assert.equal((await data()).records[secondMonth].cash, 98000);

    const invalid = path.join(output, 'invalid.json');
    await fs.writeFile(invalid, JSON.stringify({ accounts: [], records: {}, goals: [null] }));
    const beforeInvalid = await stored();
    await upload(invalid);
    assert.ok((await observe()).includes('导入失败'));
    assert.equal(await stored(), beforeInvalid);

    await tab.goto(`${baseUrl}/?run=${run}&case=corrupt`); await unlock();
    assert.ok((await observe()).includes('已暂停自动保存'));
    assert.equal(await stored(), '{broken-json');
    const raw = await download(() => button('下载原始数据').click());
    assert.equal(await fs.readFile(raw, 'utf8'), '{broken-json');
    await upload(backup, true); await button('取消').click(); await observe();
    assert.equal(await stored(), '{broken-json');
    await upload(invalid, true);
    assert.ok((await observe()).includes('导入失败'));
    assert.equal(await stored(), '{broken-json');
    await upload(backup, true); await button('确认覆盖并导入').click(); await observe();
    assert.deepEqual((await data()).records, exported.records);
    await tab.reload(); await unlock();
    assert.deepEqual((await data()).records, exported.records);
    await layout();
    const errors = await tab.dev.logs({ levels: ['error'], limit: 100 });
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const screenshot = path.join(output, `finance-${width}.jpg`);
    await fs.writeFile(screenshot, await tab.screenshot({ fullPage: false }));
    return { width, passed: ['录入结账与刷新恢复', '历史复核与目标快照', '导出导入与取消保护', '非法导入保护', '损坏原文保留与备份恢复'], screenshot };
  } catch (error) {
    throw new Error(`${error.message}\n验收页面状态：\n${lastSnapshot}`, { cause: error });
  } finally {
    await viewport.reset();
    await tab.close();
  }
}
