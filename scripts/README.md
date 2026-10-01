# 回归验证约定

本目录只放开发验证脚本，不改变 `docs/index.html` 的单文件部署方式。

- `check-finance.mjs`：无依赖的计算和数据保护检查，可直接用 Node 运行。
- `serve-acceptance.mjs`：本机独立验收服务，只提供合成数据，不读取个人财务 JSON。
- `check-browser-flows.mjs`：通过 Codex 浏览器接口操作实际页面，验证录入、结账、刷新、历史复核、导出导入和损坏数据恢复。

验收页面把财务存储隔离在当前验收会话中，不使用正式页面的 `localStorage`。每次运行使用新的会话标识，刷新保留本次测试数据，重复运行不依赖上次状态。

基础检查：`node scripts/check-finance.mjs`。

浏览器检查：先运行 `node scripts/serve-acceptance.mjs`，使用输出的本机地址，在 Codex 浏览器运行环境导入 `check-browser-flows.mjs` 并调用 `runFinanceFlows(browser, { baseUrl, password, width })`。`password` 由调用者传入验收页面的默认解锁值，不在脚本里保存密码；`width` 分别用 `1280` 和 `390`。浏览器接口是 Codex 已有工具，不安装新的包或建立构建流程。

测试失败会抛出断言错误，不会将未通过事项报告为成功。下载和截图只包含合成数据，留在临时输出目录；不要提交个人导出文件或测试截图。

浏览器运行示例（先按当前 Codex 浏览器接口说明取得 `browser`）：

```js
const { runFinanceFlows } = await import('/Users/geying/Hank/MyProject/HTML_Project/scripts/check-browser-flows.mjs');
const result = await runFinanceFlows(browser, { baseUrl, password, width: 390 });
nodeRepl.write(result);
```

安全边界：脚本在解锁前验证验收页标识，拒绝操作普通财务页面。导出检查捕获现有应用实际生成的 Blob 内容，写入临时 JSON 后再通过真实文件选择器导入；不会重写导出数据来制造通过结果。当前 Codex 内置浏览器不返回此页面的下载事件，因此这里验证文件内容和恢复链路，不证明系统下载目录落盘成功；真实浏览器的系统下载行为仍需人工确认。
