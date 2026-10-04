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
    await stored();
    const deadline = Date.now() + 60000;
    while (!(await tab.ax.get()).includes('6位数字密码')) {
      assert.ok(Date.now() < deadline, '应用未在一分钟内显示解锁界面');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await observe();
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
    if (recovering) await button('导入备份恢复').press('Enter');
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
    await button('总览').click(); await observe();
    assert.match(lastSnapshot, /缺少有效支出数据，暂无法估算/);
    await button('展开深度分析').click(); await observe();
    assert.doesNotMatch(lastSnapshot, /已覆盖目标|已达成 🎉/);
    await openMenu('月度结账');
    if (width === 390) { await p.getByRole('button', { name: /^共同/ }).click(); await observe(); }
    for (const [name, value] of [['验收现金', 100000], ['验收负债', 20000], ['验收收入', 10000], ['验收支出', 5000]]) await editAmount(name, value);
    await closeMonth();
    assert.equal((await data()).monthStatus[firstMonth], 'closed');
    assert.equal((await data()).goalHistory[firstMonth].goal.currentAmount, 100000);
    assert.equal(await button('新建月份').isEnabled(), true);
    const firstBackup = await download(() => openMenu('导出数据'));
    await tab.reload(); await unlock(); await openMenu('月度结账');
    assert.equal((await data()).records[firstMonth].cash, 100000);
    assert.equal((await data()).monthStatus[firstMonth], 'closed');
    const secondMonth = await createMonth();
    if (width === 390) { await p.getByRole('button', { name: /^共同/ }).click(); await observe(); }
    for (const [name, value] of [['验收现金', 98000], ['验收负债', 19000], ['验收收入', 0], ['验收支出', 2000]]) await editAmount(name, value);
    await closeMonth(); await layout();
    const beforeOlderImport = await stored();
    await upload(firstBackup);
    assert.match(await observe(), /导入文件缺少当前的 1 个月度记录/);
    assert.ok(lastSnapshot.includes(`当前页面记录截至：`) && lastSnapshot.includes(secondMonth) && lastSnapshot.includes(firstMonth));
    await viewport.set({ width, height: 400 });
    const confirmRect = await button('确认覆盖并导入').evaluate(element => {
      const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: innerHeight };
    });
    assert.ok(confirmRect.top >= 0 && confirmRect.bottom <= confirmRect.height, '短视口导入确认按钮不可达');
    await button('取消').click(); await observe();
    assert.equal(await stored(), beforeOlderImport, '取消旧备份导入不能丢失新月份');
    await viewport.set({ width, height: 900 });

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
    await button('取消').click({ timeoutMs: 10000 }); await observe();
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
    await upload(backup, true); await button('取消').click({ timeoutMs: 10000 }); await observe();
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
    return { width, passed: ['录入结账与刷新恢复', '零支出不判断财务自由达成', '历史复核与目标快照', '旧备份差异预览与短视口确认', '导出导入与取消保护', '非法导入保护', '损坏原文保留与备份恢复'], screenshot };
  } catch (error) {
    try { await observe(); } catch {}
    throw new Error(`${error.message}\n验收页面状态：\n${lastSnapshot}`, { cause: error });
  } finally {
    await viewport.reset();
    await tab.close();
  }
}

export async function runAuditFlows(browser, { baseUrl, password, width }) {
  const url = new URL(baseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:', '只允许独立本机验收服务');
  assert.ok([390, 1280].includes(width), '验收宽度必须为 390 或 1280');
  const run = `audit-${Date.now()}-${width}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-audit-'));
  const viewport = await browser.capabilities.get('viewport');
  const tabs = [];
  const passed = [];
  let lastSnapshot = '';
  const session = async (kind) => {
    const tab = await browser.tabs.new(); tabs.push(tab);
    await viewport.set({ width, height: 900 });
    const p = tab.playwright;
    const observe = async () => { lastSnapshot = await p.domSnapshot(); return lastSnapshot; };
    const stored = () => p.evaluate(() => {
      if (document.documentElement.dataset.acceptancePage !== 'synthetic-only') throw new Error('不是合成数据验收页面');
      return document.documentElement.dataset.acceptanceStored;
    });
    const data = async () => JSON.parse(await stored());
    const button = (name) => p.getByRole('button', { name, exact: typeof name === 'string' });
    const click = async (name) => { await observe(); await button(name).click(); await observe(); };
    const fill = async (selector, value) => { await observe(); await p.locator(selector).fill(String(value)); await observe(); };
    const menu = async (name) => { await click('更多'); await p.getByRole('menuitem', { name, exact: true }).click(); await observe(); };
    await tab.goto(`${baseUrl}/?run=${run}&case=${kind}`);
    const deadline = Date.now() + 60000;
    while (!(await tab.ax.get()).includes('6位数字密码')) {
      assert.ok(Date.now() < deadline, '应用未在一分钟内显示解锁界面');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await stored(); await observe();
    await p.getByRole('textbox', { name: '6位数字密码', exact: true }).fill(password);
    await click('打开');
    return { tab, p, observe, stored, data, button, click, fill, menu };
  };
  const checkLayout = async (view) => {
    const size = await view.p.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(size.width, width);
    assert.ok(size.scroll <= size.width, '页面存在横向溢出');
  };
  const editGoalAmount = async (view, value) => {
    await view.click('编辑 验收目标');
    await view.fill('#goal-targetAmount', value);
    await view.click('更新目标');
  };
  try {
    await viewport.set({ width, height: 900 });
    const review = await session('review');
    assert.match(await review.observe(), /2 个月份待复核/);
    await review.click('去复核结账');
    assert.equal(await review.p.getByLabel('查看已有月份').evaluate(input => input.value), '2026-02');
    const oldSnapshots = (await review.data()).goalHistory['2026-02'];
    await review.click('重新编辑'); await review.click('确认重新编辑');
    if (width === 390) await review.click(/^共同/);
    assert.equal(await review.p.locator('[data-closing-account-id="review_inactive"]').isEnabled(), true);
    assert.equal(await review.p.evaluate(() => document.querySelector('[data-closing-account-id="review_new"]') === null), true);
    await review.fill('[data-closing-account-id="review_inactive"]', 46000);
    await review.p.locator('[data-closing-account-id="review_inactive"]').press('Tab'); await review.observe();
    await review.fill('[data-closing-account-id="review_fund"]', 32000);
    await review.p.locator('[data-closing-account-id="review_fund"]').press('Tab'); await review.observe();
    await review.click(/^展开其余/);
    const reasonLabels = await review.p.evaluate(() => Array.from(document.querySelectorAll('select[aria-label$="变化原因"]')).map(item => item.getAttribute('aria-label')));
    assert.ok(reasonLabels.length >= 4, '未展示第四个变化原因入口');
    await review.p.getByRole('combobox', { name: reasonLabels[3], exact: true }).selectOption('其他'); await review.observe();
    await review.click('完成本月结账'); await review.click(/^(确认结账|确认以上数值并结账)$/);
    const revised = await review.data();
    assert.equal(revised.records['2026-02'].review_inactive, 46000);
    assert.equal(revised.accounts.find(item => item.id === 'review_inactive').active, false);
    assert.deepEqual(revised.goalHistory['2026-02'].review_manual_goal, oldSnapshots.review_manual_goal);
    assert.deepEqual(revised.goalHistory['2026-02'].review_linked_goal, { ...oldSnapshots.review_linked_goal, currentAmount: 32000 });
    assert.equal(revised.goalHistory['2026-02'].review_new_goal, undefined);
    assert.equal(revised.monthMeta['2026-02'].reviewRequired, undefined);
    assert.equal(revised.monthMeta['2026-03'].reviewRequired, true);
    await review.click('历史记录 · 3 个月');
    await review.button('2026-01').press('Enter'); await review.observe();
    assert.equal(await review.p.getByLabel('查看已有月份').evaluate(input => input.value), '2026-01');
    assert.equal(await review.p.evaluate(() => window.scrollY), 0);
    assert.equal(await review.p.evaluate(() => document.activeElement.getAttribute('aria-label')), '查看已有月份');
    await review.click('总览');
    assert.match(await review.observe(), /1 个月份待复核.*2026-03/);
    assert.equal(await review.p.evaluate(() => window.scrollY), 0);
    passed.push('历史账户修正、完整变化原因与历史目标快照保留', '最早待复核入口、剩余复核提醒与导航回顶');

    await review.click('家庭目标');
    assert.match(await review.observe(), /保障月数不足/);
    const linkedGoalBefore = (await review.data()).goals.find(goal => goal.id === 'review_linked_goal');
    await review.click('编辑 验收关联目标当前计划');
    assert.equal(await review.p.locator('#goal-currentAmount').evaluate(input => input.value), '50000');
    await review.p.getByRole('checkbox', { name: /共同 · 验收基金/ }).uncheck(); await review.observe();
    assert.equal(await review.p.locator('#goal-currentAmount').evaluate(input => input.value), '50000');
    assert.equal(await review.p.locator('#goal-currentAmount').isEnabled(), true);
    assert.match(await review.observe(), /已转为手动金额，请核对/);
    await review.click('取消');
    assert.deepEqual((await review.data()).goals.find(goal => goal.id === 'review_linked_goal'), linkedGoalBefore);
    await review.click('编辑 验收关联目标当前计划');
    await review.p.getByRole('checkbox', { name: /共同 · 验收基金/ }).uncheck(); await review.observe();
    await review.click('更新目标');
    assert.equal((await review.data()).goals.find(goal => goal.id === 'review_linked_goal').currentAmount, 50000);
    await review.click('复核保障金额');
    assert.equal(await review.p.locator('#goal-targetAmount').evaluate(input => input.value), '60000');
    await review.click('使用建议金额');
    assert.equal(await review.p.locator('#goal-targetAmount').evaluate(input => input.value), '120000');
    await review.click('取消');
    assert.equal((await review.data()).goals.find(goal => goal.id === 'review_emergency_goal').targetAmount, 60000);
    await review.click('编辑 验收失效来源目标');
    assert.equal(await review.p.locator('#goal-currentAmount').isEnabled(), false);
    await review.click('解除已删除资金来源 review_deleted_source');
    assert.equal(await review.p.locator('#goal-currentAmount').isEnabled(), true);
    assert.equal(await review.p.locator('#goal-currentAmount').evaluate(input => input.value), '0');
    await review.fill('#goal-currentAmount', 5000); await review.click('更新目标');
    const repairedGoal = (await review.data()).goals.find(goal => goal.id === 'review_missing_goal');
    assert.deepEqual(repairedGoal.linkedAccountIds, []); assert.equal(repairedGoal.currentAmount, 5000);
    await checkLayout(review);
    passed.push('目标转手动保留可见余额与取消保护', '失效资金来源解除与备用金保障不足表达');
    const screenshot = path.join(output, `audit-${width}.jpg`);
    await fs.writeFile(screenshot, await review.tab.screenshot({ fullPage: false }));
    await review.menu('导出数据');
    await review.p.locator('#acceptance-download').waitFor({ state: 'visible', timeoutMs: 10000 });
    const backup = path.join(output, 'review-backup.json');
    await fs.writeFile(backup, await review.p.evaluate(() => document.documentElement.dataset.acceptanceDownload));

    await review.menu('月度结账');
    await review.p.getByLabel('查看已有月份').selectOption('2026-03'); await review.observe();
    await review.click('补录当月账户');
    assert.match(await review.observe(), /请先「重新编辑」再补录遗漏账户/);
    await review.click('重新编辑'); await review.click('确认重新编辑');
    const beforeBackfill = await review.data();
    if (!(await review.button('加入本月并填写金额').isVisible())) await review.click('补录当月账户');
    await review.p.getByLabel('选择补录账户').selectOption('review_inactive'); await review.observe();
    await review.click('加入本月并填写金额');
    assert.equal(await review.p.locator('[data-closing-account-id="review_inactive"]').evaluate(input => input.value), '');
    assert.equal(await review.p.evaluate(() => document.activeElement.getAttribute('data-closing-account-id')), 'review_inactive');
    await review.click('完成本月结账');
    assert.equal(await review.button(/^(确认结账|确认以上数值并结账)$/).isEnabled(), false);
    await review.click('返回并定位');
    await review.fill('[data-closing-account-id="review_inactive"]', 42000);
    await review.p.locator('[data-closing-account-id="review_inactive"]').press('Tab'); await review.observe();
    await review.click('完成本月结账'); await review.click(/^(确认结账|确认以上数值并结账)$/);
    const afterBackfill = await review.data();
    assert.equal(afterBackfill.records['2026-03'].review_inactive, 42000);
    assert.equal(afterBackfill.accounts.find(account => account.id === 'review_inactive').active, false);
    assert.deepEqual(afterBackfill.records['2026-02'], beforeBackfill.records['2026-02']);
    await review.p.getByLabel('查看已有月份').selectOption('2026-02'); await review.observe();
    await review.click('重新编辑'); await review.click('确认重新编辑');
    await review.click('补录当月账户');
    await review.p.getByLabel('选择补录账户').selectOption('review_new'); await review.observe();
    await review.click('加入本月并填写金额');
    await review.fill('[data-closing-account-id="review_new"]', 0);
    await review.p.locator('[data-closing-account-id="review_new"]').press('Tab'); await review.observe();
    await review.click('完成本月结账'); await review.click(/^(确认结账|确认以上数值并结账)$/);
    assert.equal((await review.data()).records['2026-02'].review_new, 0);
    assert.equal((await review.data()).monthMeta['2026-03'].reviewRequired, true);
    await checkLayout(review);
    passed.push('历史账户显式补录、空值阻断、零值保存及后续复核');

    const failure = await session('write-error');
    await failure.click('家庭目标');
    const beforeFailure = await failure.stored();
    await failure.click('启用验收写入故障');
    await editGoalAmount(failure, 230000);
    assert.equal(await failure.stored(), beforeFailure);
    assert.match(await failure.observe(), /本机保存未成功/);
    const chooser = failure.p.waitForEvent('filechooser', { timeoutMs: 10000 });
    await failure.menu('导入数据');
    await (await chooser).setFiles(backup); await failure.observe();
    await failure.click('确认覆盖并导入');
    assert.match(await failure.observe(), /导入未完成/);
    assert.equal(await failure.button('确认覆盖并导入').isVisible(), true);
    assert.equal(await failure.stored(), beforeFailure, '导入保存失败不得切换或覆盖原数据');
    await failure.click('取消');
    await failure.click('解除验收写入故障'); await failure.click('重试保存');
    assert.equal((await failure.data()).goals[0].targetAmount, 230000);
    assert.doesNotMatch(await failure.observe(), /本机保存未成功/);
    await checkLayout(failure);
    passed.push('保存失败重试、导入失败保留原页及确认窗口');

    await failure.menu('月度结账');
    const failureMonth = await failure.p.getByLabel('新建月份').evaluate(input => input.value);
    await failure.click('新建月份');
    await failure.click('启用验收写入故障');
    await failure.click('完成本月结账'); await failure.click(/^(确认结账|确认以上数值并结账)$/);
    assert.notEqual((await failure.data()).monthStatus[failureMonth], 'closed');
    assert.match(await failure.observe(), /本月显示为已结账，本页当前修改尚未保存/);
    assert.doesNotMatch(lastSnapshot, /本月已结账并保存到本机/);
    assert.equal(await failure.button('重试保存结账结果').isVisible(), true);
    await failure.click('解除验收写入故障'); await failure.click('重试保存结账结果');
    assert.equal((await failure.data()).monthStatus[failureMonth], 'closed');
    assert.match(await failure.observe(), /本月已结账并保存到本机/);
    await checkLayout(failure);
    passed.push('结账结果未持久化时不报成功、就近重试恢复');

    const first = await session('shared');
    const second = await session('shared');
    await first.click('家庭目标'); await second.click('家庭目标');
    await editGoalAmount(first, 220000);
    await second.observe();
    assert.match(await second.observe(), /本页暂停保存/);
    const newest = await first.stored();
    await editGoalAmount(second, 240000);
    assert.equal(await second.stored(), newest);
    await second.click('导出本页副本');
    await second.p.locator('#acceptance-download').waitFor({ state: 'visible', timeoutMs: 10000 });
    const exported = await second.p.evaluate(() => document.documentElement.dataset.acceptanceDownload);
    assert.equal(JSON.parse(exported).goals[0].targetAmount, 240000);
    assert.equal(await second.stored(), newest); assert.equal(await first.stored(), newest);
    await checkLayout(second);
    passed.push('双标签冲突暂停写入与导出副本不覆盖新数据');
    for (const tab of tabs) {
      const errors = await tab.dev.logs({ levels: ['error'], limit: 100 });
      assert.equal(errors.length, 0, JSON.stringify(errors));
    }
    return { width, passed, screenshot };
  } catch (error) {
    throw new Error(`${error.message}\n验收页面状态：\n${lastSnapshot}`, { cause: error });
  } finally {
    await viewport.reset();
    for (const tab of tabs.reverse()) await tab.close();
  }
}
