/*
 * 真实浏览器 DOM 校准脚本（playwright-core + 系统 Edge）
 * 目的：抓取各平台真实 DOM 结构，校准 adapter 选择器
 * 运行：node tools/calibrate.js [平台]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(__dirname, '..', 'calibration');
fs.mkdirSync(OUT, { recursive: true });

const TEST_MSG = '请用一句话介绍北京，并用 Python 写一个斐波那契函数，再给出公式 E=mc^2 的 LaTeX';

function summarize() {
  // 提取页面关键结构信息
  const info = {
    url: location.href,
    title: document.title,
    loginWall: /登录|登陆|log in|sign in/i.test((document.body.innerText || '').slice(0, 500)) &&
      !!document.querySelector('input[type="password"], input[type="tel"], [class*="login"], [class*="Login"]'),
    textareas: document.querySelectorAll('textarea').length,
    contentEditable: document.querySelectorAll('[contenteditable="true"]').length,
    navs: Array.from(document.querySelectorAll('nav')).map(n => (n.className || '').toString().slice(0, 80)),
    mainClasses: Array.from(document.querySelectorAll('main')).map(n => (n.className || '').toString().slice(0, 120)),
    scrollables: Array.from(document.querySelectorAll('div,main,section')).filter(el => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 100;
    }).slice(0, 8).map(el => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 100),
      scrollH: el.scrollHeight,
      clientH: el.clientHeight
    })),
    links: Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map(a => ({
      href: (a.getAttribute('href') || '').slice(0, 60),
      text: (a.textContent || '').trim().slice(0, 40),
      cls: (a.className || '').toString().slice(0, 60)
    })).filter(l => l.text),
    bigTextDivs: Array.from(document.querySelectorAll('div')).filter(el => {
      const t = (el.textContent || '').trim();
      return t.length > 80 && t.length < 3000 && el.children.length <= 6;
    }).slice(0, 15).map(el => ({
      cls: (el.className || '').toString().slice(0, 120),
      text: (el.textContent || '').trim().slice(0, 80)
    }))
  };
  return info;
}

(async () => {
  const which = process.argv[2] || 'deepseek';
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });
  const ctx = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.text().includes('AIEXP')) console.log('[page]', m.text()); });

  const targets = {
    deepseek: 'https://chat.deepseek.com/',
    mimo: 'https://mimo.mi.com/',
    qwen: 'https://www.tongyi.com/',
    gemini: 'https://gemini.google.com/app',
    chatgpt: 'https://chatgpt.com/',
    claude: 'https://claude.ai/new'
  };
  const url = targets[which];
  if (!url) { console.error('未知平台', which); process.exit(1); }

  console.log('== 打开', url);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log('goto 超时（SPA 常见，继续）:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(6000);

  const before = await page.evaluate(summarize);
  console.log('== 初始结构 ==');
  console.log(JSON.stringify(before, null, 2));
  await page.screenshot({ path: path.join(OUT, which + '-1-home.png'), fullPage: false });

  // 尝试发消息（匿名可用则校准消息结构）
  let input = null;
  try {
    input = await page.$('textarea');
    if (!input) input = await page.$('[contenteditable="true"]');
  } catch (e) { /* ignore */ }

  if (input) {
    console.log('== 尝试发送测试消息 ==');
    try {
      await input.click();
      await input.fill(TEST_MSG);
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      console.log('已发送，等待响应（最长 90 秒）…');
      // 等待文本量增长
      const startLen = (await page.evaluate(() => document.body.innerText.length));
      let stable = 0, last = startLen;
      for (let i = 0; i < 45; i++) {
        await page.waitForTimeout(2000);
        const len = await page.evaluate(() => document.body.innerText.length);
        if (len === last) { if (++stable >= 6) break; } else { stable = 0; last = len; }
      }
      const after = await page.evaluate(summarize);
      console.log('== 发送后结构 ==');
      console.log(JSON.stringify(after, null, 2));
      await page.screenshot({ path: path.join(OUT, which + '-2-chat.png'), fullPage: false });

      // 导出消息区 DOM 骨架
      const skeleton = await page.evaluate(() => {
        function skel(el, depth) {
          if (depth > 6 || !el) return null;
          const o = {
            tag: el.tagName.toLowerCase(),
            cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 90),
            text: depth <= 2 ? (el.childNodes.length && Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()) ? '…' : '') : ''
          };
          const kids = Array.from(el.children).slice(0, 8).map(c => skel(c, depth + 1)).filter(Boolean);
          if (kids.length) o.kids = kids;
          return o;
        }
        const main = document.querySelector('main') || document.body;
        return JSON.stringify(skel(main, 0), null, 1);
      });
      fs.writeFileSync(path.join(OUT, which + '-skeleton.json'), skeleton);
      console.log('骨架已存 calibration/' + which + '-skeleton.json');
    } catch (e) {
      console.log('发送失败（可能需要登录）:', e.message.split('\n')[0]);
    }
  } else {
    console.log('== 未找到输入框（可能需要登录）==');
  }

  await browser.close();
  console.log('== 完成 ==');
})().catch(e => { console.error('脚本错误:', e); process.exit(1); });
