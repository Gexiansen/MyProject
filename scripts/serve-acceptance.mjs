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

export function startAcceptanceServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/') { response.writeHead(404); response.end(); return; }
    const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
    const raw = url.searchParams.get('case') === 'corrupt' ? '{broken-json' : JSON.stringify(seed);
    const key = `finance-acceptance:${url.searchParams.get('run') || 'manual'}:${url.searchParams.get('case') || 'normal'}`;
    const setup = `<script>(()=>{
      const key=${JSON.stringify(key)};
      if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,${JSON.stringify(raw)});
      document.documentElement.dataset.acceptanceStored=sessionStorage.getItem(key);
      document.documentElement.dataset.acceptancePage='synthetic-only';
      Object.defineProperty(window,'localStorage',{value:{
        getItem:(name)=>name==='family-finance-v1'?sessionStorage.getItem(key):null,
        setItem:(name,value)=>{if(name==='family-finance-v1'){sessionStorage.setItem(key,value);document.documentElement.dataset.acceptanceStored=value;}}
      }});
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
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html.replace('<head>', `<head>${setup}`).replace('</body>', '<aside style="padding:16px;font-size:12px">独立合成数据验收，不使用个人财务存储。<output id="acceptance-download" hidden></output></aside></body>'));
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
