// 只使用合成数据，不读取浏览器存储或个人财务 JSON。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `找不到验证区段：${start}`);
  return source.slice(a, b);
};
const context = vm.createContext({
  MEMBERS: ['老公', '老婆', '共同'], CATS: { cash: '现金', investment: '投资', fixed: '固定资产' },
  ACTION_METRICS: { none: '', saved: '', cash: '', liability: '' },
  localStorage: { getItem: () => null },
});
vm.runInContext(between('const STORAGE_KEY =', '// ---------- 演示数据 ----------'), context);
vm.runInContext(between('const isActive =', 'const missingMonthsBetween ='), context);
vm.runInContext(between('function resolveGoalCurrentAmount(', 'function getGoalProgress('), context);
const run = (code) => vm.runInContext(code, context);
const base = { accounts: [{ id: 'cash', name: '现金', type: 'asset', member: '共同' }], records: { '2026-01': { cash: 0 }, '2026-02': { cash: -10 } } };
context.data = base;
assert.equal(run('normalizeImportedData(data).records["2026-02"].cash'), -10);
for (const invalid of [
  { ...base, goals: [null] },
  { ...base, records: { '2026-01': { cash: true } } },
  { ...base, records: { '2026-01': { cash: [] } } },
  { ...base, withdrawalRate: [4] },
  { ...base, records: { '2026-13': { cash: 1 } } },
  { ...base, monthStatus: { '2026-01': 'unexpected' } },
  { ...base, monthMeta: { '2026-01': { actions: [null] } } },
  { ...base, monthMeta: { '2026-01': { pendingAmountDrafts: { ghost: '-' } } } },
  { ...base, goalHistory: { '2026-01': { goal: null } } },
]) {
  context.data = invalid;
  assert.throws(() => run('normalizeImportedData(data)'));
}
context.data = { ...base, monthMeta: { '2026-01': { pendingAmountDrafts: { cash: '-' }, pendingAmountOriginals: { cash: 0 } } } };
assert.equal(run('normalizeImportedData(data).monthMeta["2026-01"].pendingAmountDrafts.cash'), '-');
context.localStorage.getItem = () => '{broken-json';
assert.equal(run('loadSaved().raw'), '{broken-json');
assert.ok(run('loadSaved().error'));
context.localStorage.getItem = () => null;
assert.equal(run('loadSaved().error'), null);
context.localStorage.getItem = () => { throw new Error('storage unavailable'); };
assert.equal(run('loadSaved().error'), 'storage unavailable');
assert.equal(run('markLaterMonthsForReview({}, "2026-01", {"2026-01":{},"2026-02":{},"2026-03":{}}, {"2026-02":"closed","2026-03":"draft"})["2026-02"].reviewRequired'), true);
assert.equal(run('markLaterMonthsForReview({}, "2026-01", {"2026-03":{}}, {"2026-03":"draft"})["2026-03"]'), undefined);
assert.equal(run('cleanAccountMeta({"2026-01":{pendingAmountDrafts:{cash:"-"},reviewedBalanceIds:["cash"],changeReasons:{cash:"其他"}}}, "cash")["2026-01"].reviewedBalanceIds.length'), 0);
assert.equal(run('cleanAccountMeta({"2026-01":{pendingAmountDrafts:{cash:"-"},reviewedBalanceIds:["cash"]}}, "cash", true)["2026-01"].reviewedBalanceIds.length'), 1);

context.currentImportRecords = { '2026-03': { cash: 0 }, '2026-01': { cash: 100 }, '2026-04': { cash: -10 } };
context.incomingImportRecords = { '2026-02': { cash: 100 }, '2026-01': { cash: 90 } };
let importComparison = run('getImportRecordComparison(currentImportRecords, incomingImportRecords)');
assert.equal(importComparison.currentReadable, true);
assert.equal(importComparison.currentLatestMonth, '2026-04');
assert.equal(importComparison.importedLatestMonth, '2026-02');
assert.deepEqual(Array.from(importComparison.removedMonths), ['2026-03', '2026-04'], '预览列出当前存在但备份没有的月份，包括零值和负值记录');
assert.equal(importComparison.currentMonthCount, 3);
context.incomingImportRecords['2026-05'] = {};
importComparison = run('getImportRecordComparison(currentImportRecords, incomingImportRecords)');
assert.equal(importComparison.importedLatestMonth, '2026-05');
assert.equal(importComparison.removedMonths.length, 2, '备份截至月份较新也应提示中间缺失月份');
context.currentImportRecords['2026-06'] = {};
importComparison = run('getImportRecordComparison(currentImportRecords, incomingImportRecords)');
assert.equal(importComparison.currentLatestMonth, '2026-06', '比较调用读取当前最新记录而非文件选择时快照');
assert.equal(importComparison.removedMonths.length, 3);
assert.equal(run('getImportRecordComparison({}, incomingImportRecords).currentLatestMonth'), null);
assert.equal(run('getImportRecordComparison({}, incomingImportRecords).currentMonthCount'), 0);
assert.equal(run('getImportRecordComparison(currentImportRecords, {}).importedLatestMonth'), null);
assert.equal(run('getImportRecordComparison(currentImportRecords, {}).removedMonths.length'), 4);
importComparison = run('getImportRecordComparison(null, incomingImportRecords)');
assert.equal(importComparison.currentReadable, false, '恢复损坏数据时明确不可比较，不使用演示记录');
assert.equal(importComparison.currentMonthCount, null);
assert.equal(importComparison.currentLatestMonth, null);
assert.equal(importComparison.removedMonths.length, 0);
assert.equal(importComparison.importedLatestMonth, '2026-05');
assert.equal(run('getImportRecordComparison(incomingImportRecords, incomingImportRecords).removedMonths.length'), 0);

const stored = { raw: null, reads: 0, writes: 0, mode: 'normal' };
context.localStorage = {
  getItem() { stored.reads += 1; if (stored.mode === 'read-error') throw new Error('读取失败'); return stored.raw; },
  setItem(key, value) {
    stored.writes += 1;
    if (stored.mode === 'write-error') throw new Error('写入失败');
    if (stored.mode === 'silent') return;
    stored.raw = stored.mode === 'overwritten' ? '另一页面的新数据' : value;
  },
};
const save = (payload, expected) => {
  context.savePayload = payload;
  context.saveExpected = expected;
  return run('saveFinancialData(savePayload, saveExpected)');
};
const initialRaw = JSON.stringify(base);
const updatedRaw = JSON.stringify({ ...base, records: { '2026-01': { cash: 200 } } });
let saveResult = save(initialRaw, null);
assert.equal(saveResult.status, 'saved');
assert.equal(saveResult.raw, initialRaw);
assert.equal(stored.reads, 2, '写入后必须读回校验');
assert.equal(stored.writes, 1);
stored.writes = 0;
assert.equal(save(updatedRaw, null).status, 'conflict');
assert.equal(stored.writes, 0, '旧页面发现版本冲突后不能覆盖本机数据');
assert.equal(stored.raw, initialRaw);
assert.equal(save(initialRaw, initialRaw).status, 'saved');
assert.equal(stored.writes, 0, '未改变的内容无需重复写入');
for (const mode of ['read-error', 'write-error', 'silent']) {
  stored.raw = initialRaw;
  stored.mode = mode;
  assert.equal(save(updatedRaw, initialRaw).status, 'error', `${mode} 必须保留未保存状态`);
  assert.equal(stored.raw, initialRaw);
  stored.mode = 'normal';
  assert.equal(save(updatedRaw, initialRaw).status, 'saved', `${mode} 恢复后可以重试`);
  assert.equal(stored.raw, updatedRaw);
}
stored.raw = initialRaw;
stored.mode = 'overwritten';
assert.equal(save(updatedRaw, initialRaw).status, 'conflict');
assert.equal(stored.raw, '另一页面的新数据', '写后校验发现第三份数据时不能回滚覆盖它');
stored.mode = 'normal';
stored.raw = initialRaw;
const tabA = vm.createContext({ localStorage: context.localStorage, payload: updatedRaw, expectedRaw: initialRaw });
const tabB = vm.createContext({ localStorage: context.localStorage, expectedRaw: initialRaw,
  payload: JSON.stringify({ ...base, lastExportAt: '2026-10-04T00:00:00.000Z' }) });
for (const tab of [tabA, tabB]) vm.runInContext(between('const STORAGE_KEY =', '// ---------- 演示数据 ----------'), tab);
assert.equal(vm.runInContext('saveFinancialData(payload, expectedRaw).status', tabA), 'saved');
stored.writes = 0;
assert.equal(vm.runInContext('saveFinancialData(payload, expectedRaw).status', tabB), 'conflict', '旧标签页仅更新导出时间也必须检测到冲突');
assert.equal(stored.writes, 0);
assert.equal(stored.raw, updatedRaw);

const sourceGoal = { id: 'source-goal', name: '目标', goalType: 'standard', targetAmount: '200000', currentAmount: '800', targetDate: '2030-12', linkedAccountIds: ['cash'] };
const goalDraftContext = vm.createContext({
  draft: { ...sourceGoal, linkedAccountIds: [...sourceGoal.linkedAccountIds] }, emptyDraft: { currentAmount: '', linkedAccountIds: [] },
  accounts: [{ id: 'cash', type: 'asset', category: 'cash' }, { id: 'other', type: 'asset', category: 'cash' }],
  latestRec: { cash: 100000, other: 30000 }, changeGoalDraftSource: run('changeGoalDraftSource'),
  isActive: run('isActive'), getAssetCategory: run('getAssetCategory'),
  clearFieldError: () => {}, setEditingId: () => {}, setError: () => {}, setFormOpen: () => {},
  manualAmountNotice: false, goals: [sourceGoal], editingId: 'source-goal', coverageMonthsTarget: 6,
  requestAnimationFrame: (callback) => callback(), document: { getElementById: () => ({ focus() {} }) },
  setGoals: () => { throw new Error('切换来源、取消或非法金额不能改写正式目标'); },
});
goalDraftContext.assetAccounts = goalDraftContext.accounts;
goalDraftContext.setDraft = (draft) => { goalDraftContext.draft = draft; };
goalDraftContext.setManualAmountNotice = (notice) => { goalDraftContext.manualAmountNotice = notice; };
goalDraftContext.setFieldErrors = (errors) => { goalDraftContext.fieldErrors = errors; };
vm.runInContext(between('  const changeSource =', '  const saveGoal =').replace('const changeSource', 'this.changeSource'), goalDraftContext);
vm.runInContext(between('  const cancelEdit =', '  const confirmDelete =').replace('const cancelEdit', 'this.cancelEdit'), goalDraftContext);
const sourceGoalBefore = JSON.stringify(sourceGoal);
vm.runInContext('changeSource("cash", false)', goalDraftContext);
assert.equal(goalDraftContext.draft.currentAmount, '100000', '最后一个正常来源解除时保留当前可见汇总额，而非旧手动金额');
assert.equal(goalDraftContext.manualAmountNotice, true);
vm.runInContext('cancelEdit()', goalDraftContext);
assert.equal(goalDraftContext.manualAmountNotice, false, '取消清除模式切换提示');
assert.equal(goalDraftContext.draft.currentAmount, '');
assert.equal(JSON.stringify(sourceGoal), sourceGoalBefore, '取消来源修改保留正式目标');
goalDraftContext.draft = { ...sourceGoal, linkedAccountIds: ['cash', 'other'] };
vm.runInContext('changeSource("cash", false)', goalDraftContext);
assert.deepEqual(Array.from(goalDraftContext.draft.linkedAccountIds), ['other']);
assert.equal(goalDraftContext.draft.currentAmount, '800', '仍有来源时不改手动草稿，继续自动汇总');
assert.equal(goalDraftContext.manualAmountNotice, false);
vm.runInContext('changeSource("other", false)', goalDraftContext);
assert.equal(goalDraftContext.draft.currentAmount, '30000', '最后解除时使用最后剩余来源当时的余额');
goalDraftContext.draft = { ...sourceGoal, linkedAccountIds: ['cash'] };
goalDraftContext.latestRec.cash = 0;
vm.runInContext('changeSource("cash", false)', goalDraftContext);
assert.equal(goalDraftContext.draft.currentAmount, '0', '零余额明确带入0，不回退旧值或空值');
goalDraftContext.draft = { ...sourceGoal, linkedAccountIds: ['deleted'] };
vm.runInContext('changeSource("deleted", false)', goalDraftContext);
assert.equal(goalDraftContext.draft.currentAmount, '0', '失效来源解除同样保留切换前显示的零汇总');
assert.equal(goalDraftContext.manualAmountNotice, true);
goalDraftContext.draft = { ...sourceGoal, linkedAccountIds: ['cash'] };
goalDraftContext.latestRec.cash = -100;
vm.runInContext('changeSource("cash", false)', goalDraftContext);
assert.equal(goalDraftContext.draft.currentAmount, '-100', '负余额原样带入草稿，由原有提交校验处理');
vm.runInContext(between('  const saveGoal =', '  const editGoal =').replace('const saveGoal', 'this.saveGoal'), goalDraftContext);
vm.runInContext('saveGoal()', goalDraftContext);
assert.equal(goalDraftContext.fieldErrors.currentAmount, '当前已准备金额不能为负数');
let relinkedGoal;
goalDraftContext.setGoals = (update) => { relinkedGoal = update(goalDraftContext.goals)[0]; };
vm.runInContext('changeSource("other", true); saveGoal()', goalDraftContext);
assert.ok(relinkedGoal, '重新关联正余额来源后不被已隐藏的负数手动草稿阻止保存');
assert.deepEqual(Array.from(relinkedGoal.linkedAccountIds), ['other']);
assert.equal(goalDraftContext.fieldErrors.currentAmount, undefined);
assert.equal(goalDraftContext.manualAmountNotice, false, '恢复自动汇总并保存后清除手动切换提示');
assert.equal(run('resolveGoalCurrentAmount')(relinkedGoal, goalDraftContext.latestRec, goalDraftContext.accounts), 30000);

context.goalAccounts = [
  { id: 'cash', type: 'asset', category: 'cash', active: false },
  { id: 'new-cash', type: 'asset', category: 'cash' },
];
context.currentGoals = [
  { id: 'manual', name: '今天的手动目标', targetAmount: 200000, currentAmount: 30000, targetDate: '2030-12', goalType: 'standard' },
  { id: 'linked', name: '今天的应急目标', targetAmount: 120000, targetDate: '2030-11', goalType: 'emergency', coverageMonthsTarget: 12, linkedAccountIds: ['new-cash'] },
  { id: 'new-goal', name: '后来新增目标', targetAmount: 50000, currentAmount: 500, targetDate: '2031-12' },
];
context.oldSnapshots = {
  manual: { name: '旧手动目标', targetAmount: 100000, currentAmount: 10000, targetDate: '2028-01', goalType: 'standard', linkedAccountIds: [] },
  linked: { name: '旧应急目标', targetAmount: 60000, currentAmount: 20000, targetDate: '2028-02', goalType: 'emergency', coverageMonthsTarget: 6, linkedAccountIds: ['cash'] },
  removed: { name: '后来已删除目标', targetAmount: 30000, currentAmount: 1000, targetDate: '2028-03', linkedAccountIds: [] },
};
context.goalRecord = { cash: 25000, 'new-cash': 90000 };
const oldSnapshotCopy = JSON.stringify(context.oldSnapshots);
const revisedSnapshots = run('buildGoalSnapshots(currentGoals, goalRecord, goalAccounts, oldSnapshots)');
assert.deepEqual(JSON.parse(JSON.stringify(revisedSnapshots.manual)), context.oldSnapshots.manual, '重新结账保留当时手动金额、计划与日期');
assert.deepEqual(JSON.parse(JSON.stringify(revisedSnapshots.linked)), { ...context.oldSnapshots.linked, currentAmount: 25000 }, '只按旧资金来源修正关联余额');
assert.equal(revisedSnapshots['new-goal'], undefined, '后来新增目标不进入旧月份');
assert.equal(revisedSnapshots.removed.name, '后来已删除目标');
assert.equal(JSON.stringify(context.oldSnapshots), oldSnapshotCopy, '重算不修改原快照对象');
assert.equal(Object.keys(run('buildGoalSnapshots(currentGoals, goalRecord, goalAccounts, {})')).length, 0, '原先没有目标的旧月份继续保持空快照');
const firstSnapshots = run('buildGoalSnapshots(currentGoals, goalRecord, goalAccounts)');
assert.equal(firstSnapshots.manual.currentAmount, 30000);
assert.equal(firstSnapshots.manual.targetAmount, 200000);
assert.equal(firstSnapshots.linked.currentAmount, 90000);
assert.equal(firstSnapshots.linked.coverageMonthsTarget, 12);
assert.equal(firstSnapshots['new-goal'].targetDate, '2031-12');
context.goalRecord.cash = 0;
assert.equal(run('buildGoalSnapshots(currentGoals, goalRecord, goalAccounts, oldSnapshots).linked.currentAmount'), 0);
context.goalRecord.cash = -100;
assert.equal(run('buildGoalSnapshots(currentGoals, goalRecord, goalAccounts, oldSnapshots).linked.currentAmount'), -100);

context.closingFixture = [
  { id: 'old-disabled', type: 'asset', active: false },
  { id: 'old-empty', type: 'income', active: false },
  { id: 'old-null', type: 'expense' },
  { id: 'later-enabled', type: 'asset' },
  { id: 'unused-disabled', type: 'asset', active: false },
];
context.closingRecord = { 'old-disabled': 0, 'old-empty': '', 'old-null': null };
assert.deepEqual(Array.from(run('getClosingAccounts(closingFixture, closingRecord, true).map((account) => account.id)')),
  ['old-disabled', 'old-empty', 'old-null'], '历史包含该月停用和空值账户，排除后增账户');
assert.equal(run('hasRecordValue(closingRecord, "old-empty")'), false, '保留空字段供结账完整性检查阻断');
assert.equal(run('hasRecordValue(closingRecord, "old-null")'), false);
assert.deepEqual(Array.from(run('getClosingAccounts(closingFixture, closingRecord, false).map((account) => account.id)')),
  ['old-disabled', 'old-empty', 'old-null', 'later-enabled'], '当前月包含启用账户及当月已有停用账户');
assert.equal(run('getClosingAccounts(closingFixture, {}, true).length'), 0);

const preserveAccountsBody = between('  const isHistorical = sel < latestMonth;', '  const closingAccounts =');
const snapshotCall = source.match(/setGoalHistory\(\(prev\) => \(\{ \.\.\.prev, \[sel\]: (buildGoalSnapshots[^\n]+) \}\)\);/)?.[1];
assert.ok(snapshotCall, '找不到结账快照调用');
const latestSnapshots = (reopenedAt) => {
  context.latestMonthMeta = reopenedAt ? { reopenedAt } : {};
  return run(`(() => {
    const sel = '2026-09', latestMonth = sel;
    const monthStatus = { [sel]: 'draft' }, monthMeta = { [sel]: latestMonthMeta };
    const prev = {}, goals = currentGoals, rec = goalRecord, accounts = goalAccounts;
    ${preserveAccountsBody}
    return ${snapshotCall};
  })()`);
};
assert.equal(Object.keys(latestSnapshots('2026-10-04')).length, 0, '旧版最新月份重新编辑且没有快照时，不用今天目标补写历史');
assert.equal(Object.keys(latestSnapshots(null)).length, context.currentGoals.length, '最新月份首次结账仍记录当前目标');

let calendarParts = [2026, 9, 4, 12];
class ScenarioDate extends Date {
  constructor(...args) { super(...(args.length ? args : calendarParts)); }
}
const monthlyContext = vm.createContext({ Date: ScenarioDate, latest: null, accounts: base.accounts, monthStatus: {} });
vm.runInContext(between('function nextMonth(', 'function resolveGoalCurrentAmount('), monthlyContext);
const monthlyActionBody = between('  const currentDate = new Date();', '  const exportData =');
const monthlyState = (month, status = 'closed') => {
  monthlyContext.latest = month ? { month } : null;
  monthlyContext.monthStatus = month ? { [month]: status } : {};
  return vm.runInContext(`(() => {${monthlyActionBody}\nreturn { currentMonth, lastCompletedMonth, dataIsStale, monthlyAction }; })()`, monthlyContext);
};
let reminder = monthlyState('2026-09');
assert.equal(reminder.currentMonth, '2026-10');
assert.equal(reminder.lastCompletedMonth, '2026-09');
assert.equal(reminder.monthlyAction, null, '十月四日九月已结账时不催促录入未结束的十月');
assert.equal(reminder.dataIsStale, false);
reminder = monthlyState('2026-08');
assert.equal(reminder.monthlyAction.button, '补充月度记录');
assert.match(reminder.monthlyAction.detail, /从 2026-09 按顺序补充记录/);
assert.equal(reminder.dataIsStale, true);
reminder = monthlyState('2026-09', 'draft');
assert.equal(reminder.monthlyAction.button, '继续结账');
assert.match(reminder.monthlyAction.detail, /2026-09 仍在录入中/);
calendarParts = [2027, 0, 4, 12];
reminder = monthlyState('2026-12');
assert.equal(reminder.lastCompletedMonth, '2026-12');
assert.equal(reminder.monthlyAction, null, '跨年一月仍以上年十二月是否完成为准');
reminder = monthlyState('2026-11');
assert.equal(reminder.monthlyAction.button, '补充月度记录');
assert.match(reminder.monthlyAction.detail, /从 2026-12 按顺序补充记录/);
reminder = monthlyState(null);
assert.equal(reminder.monthlyAction.title, '建立首个月份');
assert.equal(reminder.monthlyAction.button, '开始月度结账');
monthlyContext.accounts = [];
assert.equal(monthlyState(null).monthlyAction, null, '无账户时不提前显示结账入口');

const fireEstimateContext = vm.createContext({ withdrawalRate: 4, fire: {} });
const fireDisplayBody = between('  const hasFireExpenseData =', '  const fireScenarios =');
const fireDisplay = (annualExp, invest = 0, years = 0) => {
  fireEstimateContext.fire = { annualExp, invest, years, annualSaved: 12000 };
  return vm.runInContext(`(() => {${fireDisplayBody} return { hasFireExpenseData, yearsText, scenario: projectFireScenario(0.04, 0.02) }; })()`, fireEstimateContext);
};
for (const invalidExpense of [undefined, null, 0, -1200, NaN]) {
  const display = fireDisplay(invalidExpense);
  assert.equal(display.hasFireExpenseData, false);
  assert.match(display.yearsText, /缺少有效支出数据/);
  assert.equal(display.scenario, null, '无有效支出时情景推演不能宣告已覆盖目标');
}
assert.match(fireDisplay(12000, 300000, 0).yearsText, /已达成/);
assert.equal(fireDisplay(12000, 300000, 0).scenario.months, 0);
assert.match(fireDisplay(12000, 100000, 10).yearsText, /约 10.0 年/);
assert.ok(fireDisplay(12000, 100000, 10).scenario.months > 0);
assert.match(fireDisplay(12000, 0, null).yearsText, /按当前储蓄速度暂难达成/);

const overviewContext = vm.createContext({
  accounts: [{ id: 'emergency-cash', type: 'asset', category: 'cash' }], rec: { 'emergency-cash': 60000 },
  goals: [
    { id: 'emergency', goalType: 'emergency', targetAmount: 60000, targetDate: '2026-12', linkedAccountIds: ['emergency-cash'], coverageMonthsTarget: 6, priority: 'high' },
    { id: 'second', targetAmount: 110000, currentAmount: 0, targetDate: '2026-12', priority: 'medium' },
    { id: 'third', targetAmount: 33000, currentAmount: 0, targetDate: '2026-12', priority: 'medium' },
    { id: 'later', targetAmount: 1100000, currentAmount: 0, targetDate: '2026-12', priority: 'low' },
  ],
  goalPriorityOrder: { high: 0, medium: 1, low: 2 }, recentAvgExp: 20000,
  recentMonths: [{ saved: 20000 }], resolveGoalCurrentAmount: run('resolveGoalCurrentAmount'),
  Date: class extends Date { constructor(...args) { super(...(args.length ? args : [2026, 0, 1])); } },
});
vm.runInContext(between('function getGoalProgress(', 'function actionMetricChange('), overviewContext);
const overviewGoalBody = between('  const goalNow =', '  const missingLatestAccounts =');
const overviewGoals = () => vm.runInContext(`(() => {${overviewGoalBody} return { goalPlans, activeGoalPlans, coverageReviewCount, totalMonthlyNeed, goalMonthlyBalance }; })()`, overviewContext);
let overviewGoalState = overviewGoals();
assert.equal(overviewGoalState.goalPlans[0].progress, 1, '应急资金金额已达标');
assert.equal(overviewGoalState.goalPlans[0].coverageMonths, 3, '保障程度仍按当前平均支出计算');
assert.equal(overviewGoalState.goalPlans[0].coverageShortfall, true);
assert.equal(overviewGoalState.coverageReviewCount, 1);
assert.equal(overviewGoalState.totalMonthlyNeed, 13000, '首页只显示两项目标，但投入汇总仍包含全部优先与正常目标');
assert.equal(overviewGoalState.goalMonthlyBalance, 7000);
overviewContext.rec['emergency-cash'] = -1000;
overviewGoalState = overviewGoals();
assert.equal(overviewGoalState.goalPlans[0].coverageMonths, 0, '负资金余额沿用原目标计算口径，不产生负进度');
overviewContext.rec['emergency-cash'] = 60000;
for (const expense of [0, -100]) {
  overviewContext.recentAvgExp = expense;
  overviewGoalState = overviewGoals();
  assert.equal(overviewGoalState.goalPlans[0].coverageMonths, null);
  assert.ok(overviewGoalState.activeGoalPlans.some(goal => goal.id === 'emergency'), '没有有效支出时应急保障仍需核对，不能仅凭金额完成判定全部完成');
  assert.equal(overviewGoalState.coverageReviewCount, 1);
}
const cashTrendBody = between('  const cashTrend =', '  const cashTotals =');
const cashTrendState = vm.runInNewContext(`(() => {${cashTrendBody} return cashTrend; })()`, {
  nextMonth: month => month === '2026-01' ? '2026-02' : '2026-04',
  chartData: [
    { month: '2026-01', label: '1月', inc: 0, exp: 10000, saved: -10000 },
    { month: '2026-03', label: '3月', inc: 10000, exp: 20000, saved: -10000 },
  ],
});
assert.equal(cashTrendState[0].储蓄率, null, '最近一期摘要遇到零收入不显示虚假储蓄率');
assert.equal(cashTrendState[1].储蓄率, -1);
assert.equal(cashTrendState[1].结余, -1);
assert.equal(cashTrendState[1].比较口径, '较上次记录');
const chartWidthBody = between('  const monthlyChartMinWidth =', '  const assetTrend =');
for (const count of [1, 3, 12, 15]) {
  assert.equal(vm.runInNewContext(`(() => {${chartWidthBody} return monthlyChartMinWidth; })()`, { chartData: Array(count) }), count * 64, '少量记录不再强制占用640px');
}

const annualBody = between('  const annual = useMemo(() => {', '  }, [series]);').replace('  const annual = useMemo(() => {', '');
context.series = [];
assert.equal(run(`(() => {${annualBody}})()`).length, 0);
context.series = [
  { month: '2026-01', nw: 100, saved: 10, inc: 10, exp: 0, nonCashChange: 0, netChange: null, liab: 0 },
  { month: '2026-03', nw: 110, saved: 15, inc: 15, exp: 0, nonCashChange: -5, netChange: 10, liab: 0 },
];
const annual = run(`(() => {${annualBody}})()`)[0];
assert.equal(annual.saved, 25);
assert.equal(annual.growth, 10);
assert.equal(annual.growthSaved, 15);
assert.equal(annual.missingMonths[0], '2026-02');
assert.equal(annual.savingsRate, 1);
context.series = [{ month: '2026-01', nw: 0, saved: -10, inc: 0, exp: 10, nonCashChange: 0, netChange: null, liab: 0 }];
const first = run(`(() => {${annualBody}})()`)[0];
assert.equal(first.growth, 0);
assert.equal(first.saved, -10);
assert.equal(first.savingsRate, null);
context.series.push({ month: '2027-01', nw: -20, saved: -10, inc: 0, exp: 10, nonCashChange: -10, netChange: -20, liab: 20 });
const secondYear = run(`(() => {${annualBody}})()`)[1];
assert.equal(secondYear.growth, -20);
assert.equal(secondYear.yoyAbs, -20);
assert.equal(secondYear.yoyPct, null);
assert.equal(secondYear.comparisonYear, '2026');
assert.equal(secondYear.savingsRate, null);

context.newMonth = '2026-01';
context.months = [];
context.records = {};
context.monthStatus = {};
context.accounts = base.accounts;
context.nextMonth = () => '2026-02';
context.setRecords = (update) => { context.records = update(context.records); };
context.setMonthStatus = (update) => { context.monthStatus = update(context.monthStatus); };
context.meta = {};
context.setMonthMeta = (update) => { context.meta = update(context.meta); };
context.setSel = () => {};
context.setNewMonth = () => {};
run(between('  const addMonth = () => {', '  const delMonth =').replace('const addMonth', 'this.addMonth'));
run('addMonth()');
assert.equal(context.meta['2026-01'].inheritedBalanceIds[0], 'cash');
assert.equal(context.records['2026-01'].cash, 0);

const accountContext = vm.createContext({
  accounts: [], records: { '2026-09': { oldFixed: 100 } }, latest: { month: '2026-09' },
  monthStatus: { '2026-09': 'draft' }, monthMeta: { '2026-09': { reopenedAt: '2026-10-04', pendingAmountDrafts: { oldFixed: '-' } } },
  cleanAccountMeta: run('cleanAccountMeta'), setModal: () => {},
});
accountContext.setAccounts = (update) => { accountContext.accounts = update(accountContext.accounts); };
accountContext.setRecords = (update) => { accountContext.records = update(accountContext.records); };
accountContext.setMonthMeta = (update) => { accountContext.monthMeta = update(accountContext.monthMeta); };
vm.runInContext(between('  const save = (acc) => {', '  const sections =').replace('const save', 'this.saveAccount'), accountContext);
vm.runInContext('saveAccount({ id: "newFixed", type: "expense", isFixed: true, fixedAmount: 999 })', accountContext);
assert.equal(Object.hasOwn(accountContext.records['2026-09'], 'newFixed'), false, '后来新增的固定支出不能写回已结账后重开的月份');
vm.runInContext('saveAccount({ id: "oldFixed", type: "expense", isFixed: true, fixedAmount: 0 })', accountContext);
assert.equal(accountContext.records['2026-09'].oldFixed, 0, '重开月份原有固定支出仍同步最新默认值，支持零值');
assert.equal(accountContext.monthMeta['2026-09'].pendingAmountDrafts?.oldFixed, undefined, '原有账户同步时清除旧草稿');
accountContext.monthMeta = {};
vm.runInContext('saveAccount({ id: "newFixed", type: "expense", isFixed: true, fixedAmount: 999 })', accountContext);
assert.equal(accountContext.records['2026-09'].newFixed, 999, '从未结账的最新草稿仍接纳新固定支出');
accountContext.monthStatus['2026-09'] = 'closed';
vm.runInContext('saveAccount({ id: "oldFixed", type: "expense", isFixed: true, fixedAmount: 300 })', accountContext);
assert.equal(accountContext.records['2026-09'].oldFixed, 0, '已结账锁定月份不被固定默认值更新');

const scripts = [];
let timeout;
const loader = vm.createContext({ window: {}, document: { createElement: () => ({ remove() {} }), head: { appendChild: (script) => scripts.push(script) } }, setTimeout: (fn) => { timeout = fn; return 1; }, clearTimeout: () => {} });
vm.runInContext(between('  function loadOne(', '  function loadAll('), loader);
loader.lib = { global: 'React', urls: ['one', 'two'] };
let completed = 0;
loader.done = () => { completed += 1; };
vm.runInContext('loadOne(lib, 0, done)', loader);
const lateOnload = scripts[0].onload;
timeout();
assert.equal(scripts.length, 2);
loader.window.React = {};
scripts[1].onload();
lateOnload();
assert.equal(completed, 1);
const styleScripts = [];
const styleTimers = new Map();
let timerId = 0;
let cssReady = false;
let styleResult;
const styleMutations = [];
const styleLoader = vm.createContext({
  window: { getComputedStyle: () => ({ display: cssReady ? 'none' : 'inline' }) },
  styleProbe: { classList: { add: (className) => styleMutations.push(className) } },
  document: { createElement: () => ({ remove() {} }), head: { appendChild: (script) => styleScripts.push(script) } },
  setTimeout: (fn, delay) => { const id = ++timerId; styleTimers.set(id, { fn, delay }); return id; },
  clearTimeout: (id) => styleTimers.delete(id),
  done: (error) => { styleResult = error || 'ready'; },
});
vm.runInContext(between('  var libs = [', '  function loadOne('), styleLoader);
vm.runInContext('this.lib = libs[0]', styleLoader);
vm.runInContext(between('  function loadOne(', '  function loadAll('), styleLoader);
vm.runInContext('loadOne(lib, 0, done)', styleLoader);
styleScripts[0].onload();
assert.deepEqual(styleMutations, ['opacity-0'], '动态样式加载后触发一次 DOM 变化以启动编译');
assert.equal(styleResult, undefined, '样式脚本已加载但 CSS 尚未生成时不能启动页面');
cssReady = true;
[...styleTimers.values()].find((timer) => timer.delay === 50).fn();
assert.equal(styleResult, 'ready');
assert.equal(styleMutations.length, 1, '异步等待样式就绪不重复触发加载 hook');
assert.equal(styleTimers.size, 0);
cssReady = false;
styleResult = undefined;
vm.runInContext('loadOne(lib, 0, done)', styleLoader);
const timedOutStyleOnload = styleScripts[1].onload;
timedOutStyleOnload();
assert.equal(styleMutations.length, 2);
[...styleTimers.values()].find((timer) => timer.delay === 12000).fn();
assert.equal(styleResult.message, '页面样式');
assert.equal(styleTimers.size, 0);
timedOutStyleOnload();
assert.equal(styleMutations.length, 2, '超时后的迟到 onload 不再执行 hook');
styleResult = undefined;
vm.runInContext('loadOne(lib, 0, done)', styleLoader);
const neverLoadedStyleOnload = styleScripts[2].onload;
[...styleTimers.values()].find((timer) => timer.delay === 12000).fn();
neverLoadedStyleOnload();
assert.equal(styleMutations.length, 2, '加载前已超时的脚本随后返回也不触发样式编译');
assert.equal(styleResult.message, '页面样式');
assert.equal(styleTimers.size, 0);
assert.doesNotMatch(source, /<script src="https:\/\/cdn\.tailwindcss\.com(?:\/[^\"]*)?"><\/script>/);
assert.match(source, /if \(loadError\) return;/);
assert.match(source, /const inheritedBalanceIds = activeAccounts\.filter/);
const backfillContext = vm.createContext({
  sel: '2026-01', isClosed: false, preserveMonthAccounts: true, backfillAccountId: 'oldInactive',
  accounts: [{ id: 'cash', name: '现金', type: 'asset', member: '共同', active: true }, { id: 'oldInactive', name: '停用账户', type: 'asset', member: '老婆', active: false }, { id: 'lateFlow', name: '旧收入', type: 'income', member: '老公', active: true }],
  records: { '2026-01': { cash: 10 }, '2026-02': { cash: 20 }, '2026-03': { cash: 30 } },
  monthStatus: { '2026-01': 'draft', '2026-02': 'closed', '2026-03': 'draft' },
  meta: { '2026-01': { actions: [{ id: 'action', text: '保留行动', done: false }] } }, drafts: {}, errors: {},
  markLaterMonthsForReview: run('markLaterMonthsForReview'), getClosingAccounts: run('getClosingAccounts'),
  setBackfillAccountId: () => {}, setBackfillOpen: () => {},
});
backfillContext.rec = backfillContext.records['2026-01'];
backfillContext.setRecords = (update) => { backfillContext.records = update(backfillContext.records); backfillContext.rec = backfillContext.records[backfillContext.sel]; };
backfillContext.setMonthMeta = (update) => { backfillContext.meta = update(backfillContext.meta); };
backfillContext.setAmountDrafts = (update) => { backfillContext.drafts = update(backfillContext.drafts); };
backfillContext.setAmountOriginals = (update) => { backfillContext.originals = update(backfillContext.originals || {}); };
backfillContext.setAmountErrors = (update) => { backfillContext.errors = update(backfillContext.errors); };
backfillContext.locateClosingAccount = (id) => { backfillContext.located = id; };
vm.runInContext(between('  const addHistoricalAccount = () => {', '  const returnToFirstBlocker =').replace('const addHistoricalAccount', 'this.addHistoricalAccount'), backfillContext);
vm.runInContext('addHistoricalAccount()', backfillContext);
assert.equal(backfillContext.records['2026-01'].oldInactive, '', '补录必须从空值开始，不能用0冒充已核对');
assert.equal(backfillContext.meta['2026-01'].pendingAmountDrafts.oldInactive, '');
assert.equal(backfillContext.meta['2026-01'].actions[0].text, '保留行动');
assert.equal(backfillContext.meta['2026-02'].reviewRequired, true);
assert.equal(backfillContext.meta['2026-03'], undefined, '后续草稿月份不新增复核状态');
assert.equal(backfillContext.records['2026-02'].cash, 20);
assert.equal(Object.hasOwn(backfillContext.records['2026-02'], 'oldInactive'), false, '补录不写入其他月份');
assert.equal(backfillContext.accounts[1].active, false, '补录不能重新启用停用账户');
assert.equal(backfillContext.located, 'oldInactive');
assert.ok(vm.runInContext('getClosingAccounts(accounts, rec, true).some(account => account.id === "oldInactive")', backfillContext));
let backfillBefore = JSON.stringify({ records: backfillContext.records, meta: backfillContext.meta });
vm.runInContext('addHistoricalAccount()', backfillContext);
assert.equal(JSON.stringify({ records: backfillContext.records, meta: backfillContext.meta }), backfillBefore, '重复加入不能覆盖已有字段');
backfillContext.backfillAccountId = 'lateFlow';
backfillContext.isClosed = true;
vm.runInContext('addHistoricalAccount()', backfillContext);
assert.equal(JSON.stringify({ records: backfillContext.records, meta: backfillContext.meta }), backfillBefore, '已结账时不能补录');
backfillContext.isClosed = false;
backfillContext.preserveMonthAccounts = false;
vm.runInContext('addHistoricalAccount()', backfillContext);
assert.equal(JSON.stringify({ records: backfillContext.records, meta: backfillContext.meta }), backfillBefore, '普通新月份不走历史补录入口');
backfillContext.preserveMonthAccounts = true;
backfillContext.backfillAccountId = 'missing';
vm.runInContext('addHistoricalAccount()', backfillContext);
assert.equal(JSON.stringify({ records: backfillContext.records, meta: backfillContext.meta }), backfillBefore, '不能补录不存在的账户');
context.data = { accounts: backfillContext.accounts, records: backfillContext.records, monthMeta: backfillContext.meta };
assert.equal(run('normalizeImportedData(data).records["2026-01"].oldInactive'), '', '空值与待填草稿兼容现有导入结构');

const persistenceContext = vm.createContext({
  savedRawRef: { current: 'old' }, writeBlockedRef: { current: false }, persisted: 'old', saveStatus: 'saved', storageIssue: null,
  saveFinancialData: () => ({ status: 'error', message: '测试写入失败' }),
});
persistenceContext.setPersistedPayload = (value) => { persistenceContext.persisted = value; };
persistenceContext.setStorageIssue = (value) => { persistenceContext.storageIssue = value; };
persistenceContext.setSaveStatus = (value) => { persistenceContext.saveStatus = value; };
vm.runInContext(between('  const persistPayload = (nextPayload) => {', '\n  useEffect(() => {').replace('const persistPayload', 'this.persistPayload'), persistenceContext);
vm.runInContext('persistPayload("closed-month")', persistenceContext);
assert.equal(persistenceContext.persisted, 'old', '失败不能提前标记结账结果已持久化');
persistenceContext.saveFinancialData = (value) => ({ status: 'saved', raw: value });
vm.runInContext('persistPayload("closed-month")', persistenceContext);
assert.equal(persistenceContext.persisted, 'closed-month');
vm.runInContext('persistPayload("closed-month-with-action")', persistenceContext);
assert.equal(persistenceContext.persisted, 'closed-month-with-action', '连续保存的短暂saveStatus相同也必须更新持久化快照');
const closedLabel = (persisted, issue) => vm.runInNewContext(`(() => {${between("  const closingSaveState =", '  const backfillAccounts =')} return closingStatusLabel; })()`, { isClosed: true, isDataPersisted: persisted, storageIssue: issue });
assert.equal(closedLabel(false, null), '已结账 · 保存中');
assert.equal(closedLabel(false, { status: 'error' }), '已结账 · 修改未保存');
assert.equal(closedLabel(true, { status: 'conflict' }), '已结账 · 修改未保存', '旧页历史保存过的内容发生冲突后也不能宣称当前已保存');
assert.equal(closedLabel(true, null), '已结账并保存');
console.log('财务回归检查通过：读取与保存保护、多页冲突、导入校验、历史快照与账户、草稿清理、历史复核、月度提醒节奏、首月核对、年度基线、样式加载、历史账户补录与结账持久化状态、总览应急保障与图表摘要边界。');
