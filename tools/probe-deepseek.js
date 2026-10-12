/* DeepSeek 主域实测：发消息 → 抓消息/代码块/公式/侧边栏结构 */
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
  await page.goto('https://www.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
  console.log('URL:', page.url());

  const ta = await page.$('textarea');
  if (!ta) { console.log('无输入框'); await browser.close(); return; }
  await ta.click();
  await page.waitForTimeout(600);
  await ta.fill(MARK);
  await page.keyboard.press('Enter');
  console.log('已发送，等待响应…');
  await page.waitForTimeout(40000);
  console.log('发送后 URL:', page.url());

  const r = await page.evaluate((MARK) => {
    const out = {};
    // 定位 MARK 的祖先链
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n, markEl = null;
    while (n = walker.nextNode()) {
      if (n.textContent.includes(MARK)) { markEl = n.parentElement; break; }
    }
    if (markEl) {
      const chain = [];
      let p = markEl;
      while (p && p !== document.body) {
        chain.push({ tag: p.tagName.toLowerCase(), cls: (p.className || '').toString().slice(0, 130), id: p.id || '' });
        p = p.parentElement;
      }
      out.markChain = chain.slice(0, 12);
    }
    // 全部含 ds- 前缀的元素类名分布
    const dsClasses = new Set();
    document.querySelectorAll('[class*="ds-"]').forEach(el => {
      (el.className || '').toString().split(/\s+/).filter(c => c.startsWith('ds-')).forEach(c => dsClasses.add(c));
    });
    out.dsClasses = Array.from(dsClasses).slice(0, 60);
    // 消息容器候选
    out.msgCandidates = Array.from(document.querySelectorAll('div')).filter(el => {
      const t = (el.textContent || '').trim();
      return t.length > 20 && el.children.length >= 1 && el.children.length <= 8;
    }).slice(0, 12).map(el => ({ cls: (el.className || '').toString().slice(0, 130), text: (el.textContent || '').trim().slice(0, 50) }));
    // 代码块
    const pres = document.querySelectorAll('pre');
    out.preCount = pres.length;
    out.pres = Array.from(pres).slice(0, 2).map(pre => {
      const chain = [];
      let p = pre;
      for (let i = 0; i < 3 && p; i++) { chain.push((p.className || '').toString().slice(0, 100)); p = p.parentElement; }
      return { chain, codeCls: pre.querySelector('code') ? (pre.querySelector('code').className || '').toString() : null };
    });
    // 公式
    out.katex = document.querySelectorAll('.katex').length;
    out.mjx = document.querySelectorAll('mjx-container').length;
    // 滚动容器
    out.scrollables = Array.from(document.querySelectorAll('div,main')).filter(el => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 100;
    }).slice(0, 5).map(el => ({ cls: (el.className || '').toString().slice(0, 100), id: el.id }));
    return out;
  }, MARK);
  console.log(JSON.stringify(r, null, 2));
  await page.screenshot({ path: path.join(__dirname, '..', 'calibration', 'deepseek-chat.png') });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
