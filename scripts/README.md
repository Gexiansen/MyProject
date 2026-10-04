# 回归验证约定

本目录只放开发验证脚本，不改变 `docs/index.html` 的单文件部署方式。

- `check-finance.mjs`：无依赖的计算和数据保护检查，可直接用 Node 运行。
- `serve-acceptance.mjs`：本机独立验收服务，只提供合成数据，不读取个人财务 JSON。
- `check-browser-flows.mjs`：通过 Codex 浏览器接口操作实际页面，验证基础整流程和审核改进专项流程。

验收页面把财务存储隔离在当前验收会话中，不使用正式账本的存储键。默认使用 `sessionStorage`；多标签页场景使用由本次会话标识生成的独立 `localStorage` 键，保留真实跨页事件。每次运行使用新的会话标识，刷新保留本次测试数据，重复运行不依赖上次状态。

专项场景在本机地址添加 `?run=本次唯一标识&case=场景名`：`review` 为历史复核、停用账户、失效目标来源和应急保障不足；`shared` 为同一 `run` 的双标签页共享存储；`write-error` 提供显式开启／解除模拟写入故障的验收按钮；`corrupt` 为损坏数据恢复。控件只存在于验收页面。

基础检查：`node scripts/check-finance.mjs`。

浏览器检查：先运行 `node scripts/serve-acceptance.mjs`，使用输出的本机地址，在 Codex 浏览器运行环境导入 `check-browser-flows.mjs`。分别调用 `runFinanceFlows(browser, { baseUrl, password, width })` 和 `runAuditFlows(browser, { baseUrl, password, width })`。前者覆盖录入、结账、刷新、导入导出及键盘恢复；后者覆盖历史账户与目标快照、全部变化原因、复核入口、失效资金来源、应急保障表达、保存失败重试和真实双标签页冲突。`password` 由调用者传入验收页面的默认解锁值，不在脚本里保存密码；`width` 分别用 `1280` 和 `390`。浏览器接口是 Codex 已有工具，不安装新的包或建立构建流程。

测试失败会抛出断言错误，不会将未通过事项报告为成功。下载和截图只包含合成数据，留在临时输出目录；不要提交个人导出文件或测试截图。

浏览器运行示例（先按当前 Codex 浏览器接口说明取得 `browser`）：

```js
const { runFinanceFlows, runAuditFlows } = await import('/Users/geying/Hank/MyProject/HTML_Project/scripts/check-browser-flows.mjs');
nodeRepl.write(await runFinanceFlows(browser, { baseUrl, password, width: 390 }));
nodeRepl.write(await runAuditFlows(browser, { baseUrl, password, width: 390 }));
```

安全边界：脚本在解锁前验证验收页标识，拒绝操作普通财务页面。导出检查捕获现有应用实际生成的 Blob 内容，写入临时 JSON 后再通过真实文件选择器导入；不会重写导出数据来制造通过结果。当前 Codex 内置浏览器不返回此页面的下载事件，因此这里验证文件内容和恢复链路，不证明系统下载目录落盘成功；真实浏览器的系统下载行为仍需人工确认。
