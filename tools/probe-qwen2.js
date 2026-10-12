/*
 * 千问结构终探：.chat-round 内部结构 + 代码块 + 公式 + 侧边栏会话项
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
  let input = null;
  try {
    input = await page.waitForSelector('[contenteditable="true"], textarea', { timeout: 20000 });
  } catch (e) { /* ignore */ }
  if (!input) {
    console.log('仍未找到输入框，当前 URL:', page.url());
    await page.screenshot({ path: path.join(__dirname, '..', 'calibration', 'qwen-noinput.png') });
    await browser.close();
    return;
  }
  await input.click();
  await page.waitForTimeout(800);
  await input.fill(MARK);
  await page.keyboard.press('Enter');
  console.log('已发送，等待响应…');
  await page.waitForTimeout(35000);

  const r = await page.evaluate(() => {
    const out = {};
    // 1. chat-round 内部结构
    const rounds = document.querySelectorAll('[class*="chat-round"]');
    out.roundCount = rounds.length;
    out.rounds = Array.from(rounds).map(rd => ({
      cls: (rd.className || '').toString(),
      kids: Array.from(rd.children).map(c => ({
        tag: c.tagName.toLowerCase(),
        cls: (c.className || '').toString().slice(0, 120),
        text: (c.textContent || '').trim().slice(0, 40),
        grandKids: Array.from(c.children).slice(0, 4).map(g => ({
          tag: g.tagName.toLowerCase(),
          cls: (g.className || '').toString().slice(0, 120),
          text: (g.textContent || '').trim().slice(0, 30)
        }))
      }))
    }));
    // 2. 代码块结构（回答里的 Python 代码）
    const pres = document.querySelectorAll('pre');
    out.preCount = pres.length;
    out.pres = Array.from(pres).slice(0, 3).map(pre => {
      const chain = [];
      let p = pre;
      for (let i = 0; i < 4 && p; i++) {
        chain.push({ tag: p.tagName.toLowerCase(), cls: (p.className || '').toString().slice(0, 120) });
        p = p.parentElement;
      }
      const code = pre.querySelector('code');
      return {
        chain,
        codeCls: code ? (code.className || '').toString() : null,
        codeText: code ? (code.textContent || '').slice(0, 60) : null,
        prevSib: pre.previousElementSibling ? {
          tag: pre.previousElementSibling.tagName.toLowerCase(),
          cls: (pre.previousElementSibling.className || '').toString().slice(0, 120),
          text: (pre.previousElementSibling.textContent || '').trim().slice(0, 30)
        } : null
      };
    });
    // 3. 公式结构
    out.katexCount = document.querySelectorAll('.katex, mjx-container').length;
    out.katexSample = document.querySelector('.katex, mjx-container') ?
      (document.querySelector('.katex, mjx-container').outerHTML || '').slice(0, 300) : null;
    // 4. 侧边栏会话项
    const panel = document.querySelector('#qianwen-left-panel, [class*="sidebar"]');
    if (panel) {
      out.sidebarLinks = Array.from(panel.querySelectorAll('a[href]')).slice(0, 10).map(a => ({
        href: (a.getAttribute('href') || '').slice(0, 70),
        text: (a.textContent || '').trim().slice(0, 40),
        cls: (a.className || '').toString().slice(0, 100)
      }));
      out.sidebarClickables = Array.from(panel.querySelectorAll('div[class*="item"], div[class*="session"], div[class*="conversation"], li')).slice(0, 10).map(d => ({
        tag: d.tagName.toLowerCase(),
        cls: (d.className || '').toString().slice(0, 100),
        text: (d.textContent || '').trim().slice(0, 40)
      }));
    }
    // 5. 助手回答容器（含“北京”回答文本的卡片）
    const answerCards = document.querySelectorAll('[class*="answer"], [class*="reply"], [class*="response"]');
    out.answerCardCount = answerCards.length;
    out.answerCardSamples = Array.from(answerCards).slice(0, 4).map(c => ({
      tag: c.tagName.toLowerCase(),
      cls: (c.className || '').toString().slice(0, 120),
      text: (c.textContent || '').trim().slice(0, 40)
    }));
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await page.screenshot({ path: path.join(__dirname, '..', 'calibration', 'qwen-final.png') });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
