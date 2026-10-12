/*
 * 精准定位脚本：发送测试消息后，沿消息文本向上找祖先链，输出各级 class
 * 运行：node tools/probe-qwen.js
 */
const path = require('path');
const { chromium } = require('playwright-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MARK = '请用一句话介绍北京';

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('https://www.qianwen.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // 找输入框
  const input = await page.$('[contenteditable="true"]') || await page.$('textarea');
  if (!input) { console.log('无输入框'); await browser.close(); return; }
  await input.click();
  await page.waitForTimeout(800);
  await input.fill(MARK);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  console.log('已发送，等待响应…');
  await page.waitForTimeout(30000); // 等回答生成

  const result = await page.evaluate((MARK) => {
    function findMark() {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while (n = walker.nextNode()) {
        if (n.textContent.includes(MARK)) return n.parentElement;
      }
      return null;
    }
    const el = findMark();
    if (!el) return { found: false };
    const chain = [];
    let p = el;
    while (p && p !== document.body) {
      chain.push({
        tag: p.tagName.toLowerCase(),
        cls: (p.className || '').toString().slice(0, 150),
        id: p.id || '',
        childCount: p.children.length,
        text: (p.textContent || '').trim().slice(0, 60)
      });
      p = p.parentElement;
    }
    // 消息容器（chain 中含大量文本的最高层）
    // 同时找所有含 MARK 同级结构的兄弟（回答消息）
    const msgRoot = chain.find(c => c.childCount > 1) || chain[chain.length - 1];
    const rootEl = (function () {
      let p = el;
      while (p && p !== document.body) {
        if ((p.textContent || '').trim().length > MARK.length * 2) return p;
        p = p.parentElement;
      }
      return el;
    })();
    // 从 rootEl 的父级看消息列表结构
    const listParent = rootEl.parentElement;
    const siblings = listParent ? Array.from(listParent.children).map(c => ({
      tag: c.tagName.toLowerCase(),
      cls: (c.className || '').toString().slice(0, 150),
      text: (c.textContent || '').trim().slice(0, 50)
    })) : [];
    return {
      found: true,
      markElChain: chain,
      rootElTag: rootEl.tagName.toLowerCase(),
      rootElCls: (rootEl.className || '').toString().slice(0, 150),
      listParentTag: listParent ? listParent.tagName.toLowerCase() : null,
      listParentCls: listParent ? (listParent.className || '').toString().slice(0, 150) : null,
      siblings
    };
  }, MARK);

  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(__dirname, '..', 'calibration', 'qwen-probe.png') });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
