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
console.log('财务回归检查通过：读取与保存保护、多页冲突、导入校验、历史快照与账户、草稿清理、历史复核、月度提醒节奏、首月核对、年度基线与样式加载。');
