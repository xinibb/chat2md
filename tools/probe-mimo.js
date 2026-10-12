/* MiMo 探测：点「立即体验」进入对话界面 */
const path = require('path');
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('https://mimo.mi.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // 找「立即体验」按钮
  const btn = await page.$('text=立即体验') || await page.$('text=使用 MiMo');
  if (btn) {
    await btn.click();
    console.log('已点击入口按钮');
    await page.waitForTimeout(8000);
  }
  console.log('当前 URL:', page.url());

  const info = await page.evaluate(() => {
    const out = {
      url: location.href,
      title: document.title,
      inputs: {
        textarea: document.querySelectorAll('textarea').length,
        contentEditable: document.querySelectorAll('[contenteditable="true"]').length
      },
      scrollables: Array.from(document.querySelectorAll('div,main,section')).filter(el => {
        const s = getComputedStyle(el);
        return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 100;
      }).slice(0, 6).map(el => ({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 100), id: el.id })),
      ids: Array.from(document.querySelectorAll('[id]')).map(e => e.id).filter(id => id && id.length < 40).slice(0, 40),
      bigDivs: Array.from(document.querySelectorAll('div')).filter(el => {
        const t = (el.textContent || '').trim();
        return t.length > 60 && t.length < 2000 && el.children.length <= 5;
      }).slice(0, 10).map(el => ({ cls: (el.className || '').toString().slice(0, 110), text: (el.textContent || '').trim().slice(0, 50) }))
    };
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(__dirname, '..', 'calibration', 'mimo-chat.png') });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
