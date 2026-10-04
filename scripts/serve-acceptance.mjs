import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const seed = {
  accounts: [
    { id: 'cash', name: '验收现金', type: 'asset', category: 'cash', member: '共同', active: true },
    { id: 'debt', name: '验收负债', type: 'liability', member: '共同', active: true },
    { id: 'income', name: '验收收入', type: 'income', member: '共同', active: true },
    { id: 'expense', name: '验收支出', type: 'expense', member: '共同', active: true },
  ],
  records: {}, withdrawalRate: 4, monthStatus: {}, monthMeta: {}, goalHistory: {}, isDemoData: false,
  goals: [{ id: 'goal', name: '验收目标', targetAmount: 200000, currentAmount: 0, targetDate: '2030-12', linkedAccountIds: ['cash'], priority: 'medium', goalType: 'standard' }],
};

const reviewSeed = {
  accounts: [
    { id: 'review_cash', name: '验收备用现金', type: 'asset', category: 'cash', member: '共同', active: true },
    { id: 'review_fund', name: '验收基金', type: 'asset', category: 'investment', member: '共同', active: true },
    { id: 'review_bond', name: '验收债券', type: 'asset', category: 'investment', member: '共同', active: true },
    { id: 'review_inactive', name: '验收已停用账户', type: 'asset', category: 'cash', member: '共同', active: false },
    { id: 'review_new', name: '验收三月新账户', type: 'asset', category: 'cash', member: '共同', active: true },
    { id: 'review_debt', name: '验收负债', type: 'liability', member: '共同', active: true },
    { id: 'review_income', name: '验收收入', type: 'income', member: '共同', active: true },
    { id: 'review_expense', name: '验收支出', type: 'expense', member: '共同', active: true },
  ],
  records: {
    '2026-01': { review_cash: 40000, review_fund: 10000, review_bond: 20000, review_inactive: 30000, review_debt: 8000, review_income: 30000, review_expense: 20000 },
    '2026-02': { review_cash: 50000, review_fund: 30000, review_bond: 35000, review_inactive: 45000, review_debt: 7000, review_income: 30000, review_expense: 20000 },
    '2026-03': { review_cash: 60000, review_fund: 50000, review_bond: 50000, review_new: 5000, review_debt: 6000, review_income: 30000, review_expense: 20000 },
  },
  withdrawalRate: 4,
  monthStatus: { '2026-01': 'closed', '2026-02': 'closed', '2026-03': 'closed' },
  monthMeta: {
    '2026-02': { reviewRequired: true, reviewReason: '2026-01 的历史金额或记录已变更' },
    '2026-03': { reviewRequired: true, reviewReason: '2026-01 的历史金额或记录已变更' },
  },
  goals: [
    { id: 'review_linked_goal', name: '验收关联目标当前计划', targetAmount: 200000, currentAmount: 0, targetDate: '2031-12', linkedAccountIds: ['review_fund'], priority: 'medium', goalType: 'standard' },
    { id: 'review_manual_goal', name: '验收手动目标当前计划', targetAmount: 200000, currentAmount: 30000, targetDate: '2031-12', linkedAccountIds: [], priority: 'medium', goalType: 'standard' },
    { id: 'review_new_goal', name: '验收三月新增目标', targetAmount: 100000, currentAmount: 0, targetDate: '2031-12', linkedAccountIds: ['review_new'], priority: 'low', goalType: 'standard' },
    { id: 'review_missing_goal', name: '验收失效来源目标', targetAmount: 100000, currentAmount: 3000, targetDate: '2031-12', linkedAccountIds: ['review_deleted_source'], priority: 'low', goalType: 'standard' },
    { id: 'review_emergency_goal', name: '验收六个月备用金', targetAmount: 60000, currentAmount: 0, targetDate: '2030-12', linkedAccountIds: ['review_cash'], priority: 'high', goalType: 'emergency', coverageMonthsTarget: 6 },
  ],
  goalHistory: {
    '2026-01': {
      review_linked_goal: { name: '验收关联目标旧计划', targetAmount: 100000, currentAmount: 10000, targetDate: '2030-06', linkedAccountIds: ['review_fund'], goalType: 'standard' },
      review_manual_goal: { name: '验收手动目标旧计划', targetAmount: 100000, currentAmount: 10000, targetDate: '2030-06', linkedAccountIds: [], goalType: 'standard' },
    },
    '2026-02': {
      review_linked_goal: { name: '验收关联目标旧计划', targetAmount: 100000, currentAmount: 30000, targetDate: '2030-06', linkedAccountIds: ['review_fund'], goalType: 'standard' },
      review_manual_goal: { name: '验收手动目标旧计划', targetAmount: 100000, currentAmount: 12000, targetDate: '2030-06', linkedAccountIds: [], goalType: 'standard' },
    },
    '2026-03': {
      review_linked_goal: { name: '验收关联目标当前计划', targetAmount: 200000, currentAmount: 50000, targetDate: '2031-12', linkedAccountIds: ['review_fund'], goalType: 'standard' },
      review_manual_goal: { name: '验收手动目标当前计划', targetAmount: 200000, currentAmount: 30000, targetDate: '2031-12', linkedAccountIds: [], goalType: 'standard' },
      review_new_goal: { name: '验收三月新增目标', targetAmount: 100000, currentAmount: 5000, targetDate: '2031-12', linkedAccountIds: ['review_new'], goalType: 'standard' },
    },
  },
  isDemoData: false,
};

export function startAcceptanceServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/') { response.writeHead(404); response.end(); return; }
    let html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
    const caseName = ['corrupt', 'shared', 'write-error', 'review'].includes(url.searchParams.get('case')) ? url.searchParams.get('case') : 'normal';
    const raw = caseName === 'corrupt' ? '{broken-json' : JSON.stringify(caseName === 'review' ? reviewSeed : seed);
    const key = `finance-acceptance:${encodeURIComponent(url.searchParams.get('run') || 'manual')}:${caseName}`;
    const storageKey = caseName === 'shared' ? key : 'family-finance-v1';
    if (caseName === 'shared') html = html.replace("const STORAGE_KEY = 'family-finance-v1';", `const STORAGE_KEY = ${JSON.stringify(storageKey)};`);
    const setup = `<script>(()=>{
      const key=${JSON.stringify(key)};
      const storageKey=${JSON.stringify(storageKey)};
      const store=${caseName === 'shared' ? 'window.localStorage' : 'sessionStorage'};
      let writeError=false;
      if(store.getItem(key)===null)store.setItem(key,${JSON.stringify(raw)});
      const showStored=()=>{document.documentElement.dataset.acceptanceStored=store.getItem(key)??'';};
      showStored();
      document.documentElement.dataset.acceptancePage='synthetic-only';
      document.documentElement.dataset.acceptanceCase=${JSON.stringify(caseName)};
      Object.defineProperty(window,'localStorage',{value:{
        getItem:(name)=>name===storageKey?store.getItem(key):null,
        setItem:(name,value)=>{if(name===storageKey){if(writeError)throw new Error('验收模拟：本机存储写入失败');store.setItem(key,value);showStored();}}
      }});
      window.addEventListener('storage',(event)=>{if(event.key===key||event.key===null)showStored();});
      ${caseName === 'write-error' ? `document.addEventListener('DOMContentLoaded',()=>{
        const enable=document.getElementById('acceptance-enable-write-error');
        const disable=document.getElementById('acceptance-disable-write-error');
        const toggle=(value)=>{writeError=value;document.documentElement.dataset.acceptanceWriteError=value?'on':'off';enable.disabled=value;disable.disabled=!value;};
        enable.addEventListener('click',()=>toggle(true));
        disable.addEventListener('click',()=>toggle(false));
        toggle(false);
      });` : ''}
      const blobs=new Map();
      const createURL=URL.createObjectURL.bind(URL);
      URL.createObjectURL=(blob)=>{const href=createURL(blob);blobs.set(href,blob);return href;};
      const click=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){
        const blob=blobs.get(this.href);
        if(blob&&this.download){
          const output=document.getElementById('acceptance-download');
          output.hidden=true;
          blob.text().then(text=>{document.documentElement.dataset.acceptanceDownload=text;output.textContent='已捕获应用生成的导出内容';output.hidden=false;blobs.delete(this.href);});
        }
        return click.call(this);
      };
    })();</script>`;
    const failureControls = caseName === 'write-error' ? '<div style="display:flex;gap:12px;margin-top:12px"><button id="acceptance-enable-write-error" type="button">启用验收写入故障</button><button id="acceptance-disable-write-error" type="button">解除验收写入故障</button></div>' : '';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html.replace('<head>', `<head>${setup}`).replace('</body>', `<aside style="padding:16px;font-size:12px">独立合成数据验收，不使用个人财务存储。${failureControls}<output id="acceptance-download" hidden></output></aside></body>`));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { baseUrl } = await startAcceptanceServer();
  console.log(`合成数据验收服务：${baseUrl}`);
}
