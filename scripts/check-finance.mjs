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
context.series = [{ month: '2026-01', nw: 0, saved: -10, inc: 0, exp: 10, nonCashChange: 0, netChange: null, liab: 0 }];
const first = run(`(() => {${annualBody}})()`)[0];
assert.equal(first.growth, 0);
assert.equal(first.saved, -10);
assert.equal(first.savingsRate, 0);
context.series.push({ month: '2027-01', nw: -20, saved: -10, inc: 0, exp: 10, nonCashChange: -10, netChange: -20, liab: 20 });
const secondYear = run(`(() => {${annualBody}})()`)[1];
assert.equal(secondYear.growth, -20);
assert.equal(secondYear.yoyAbs, -20);
assert.equal(secondYear.yoyPct, null);
assert.equal(secondYear.comparisonYear, '2026');

context.newMonth = '2026-01';
context.months = [];
context.records = {};
context.monthStatus = {};
context.accounts = base.accounts;
context.isActive = (account) => account.active !== false;
context.isTrackedFlowAccount = (account) => account.type === 'income' || account.type === 'expense' && !account.isFixed;
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
assert.match(source, /if \(loadError\) return;/);
assert.match(source, /const inheritedBalanceIds = activeAccounts\.filter/);
console.log('财务回归检查通过：读取保护、导入校验、草稿清理、历史复核、首月核对、年度基线。');
