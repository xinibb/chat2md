/*
 * 集成冒烟测试：jsdom 模拟平台页面
 * 覆盖：6 平台注册与识别、DOM 会话列表、消息抓取、角色判定、全链路导出
 * 运行：node tests/test-integration.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// 按 manifest 顺序加载全部 content script
const FILES = [
  'src/lib/vendor/turndown.min.js',
  'src/lib/vendor/turndown-plugin-gfm.min.js',
  'src/adapters/index.js',
  'src/adapters/chatgpt.js',
  'src/adapters/claude.js',
  'src/adapters/gemini.js',
  'src/adapters/deepseek.js',
  'src/adapters/qwen.js',
  'src/adapters/mimo.js',
  'src/lib/md.js',
  'src/content/scraper.js',
  'src/content/panel.js',
  'src/content/index.js'
];

function makePage(host, bodyHtml) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>', {
    url: 'https://' + host + '/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const ctx = dom.getInternalVMContext();
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  return { dom, ctx, AIEXP: vm.runInContext('window.AIEXP', ctx) };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '\n     实际: ' + JSON.stringify(detail) : '')); }
}

// ---------- 1. 注册与识别 ----------
console.log('== 平台注册与识别 ==');
{
  const { AIEXP } = makePage('chat.deepseek.com', '<div></div>');
  check('注册 6 个平台', AIEXP.adapters.all.length === 6, AIEXP.adapters.all.map(a => a.id));
  const cases = [
    ['chatgpt.com', 'chatgpt'], ['chat.openai.com', 'chatgpt'],
    ['claude.ai', 'claude'], ['gemini.google.com', 'gemini'],
    ['chat.deepseek.com', 'deepseek'], ['tongyi.aliyun.com', 'qwen'],
    ['www.qianwen.com', 'qwen'], ['mimo.mi.com', 'mimo']
  ];
  cases.forEach(([h, id]) => {
    const a = AIEXP.adapters.detect(h);
    check('识别 ' + h + ' → ' + id, a && a.id === id, a && a.id);
  });
  check('未知平台返回 null', AIEXP.adapters.detect('example.com') === null);
}

// ---------- 2. Gemini 结构抓取 ----------
console.log('== Gemini DOM 抓取 ==');
{
  const body = `
    <nav><a href="/app/conv1">如何学习 Rust</a><a href="/app/conv2">写作助手</a></nav>
    <main>
      <user-query><div class="query-text">如何学习 Rust？</div></user-query>
      <model-response><div class="markdown"><p>推荐《Rust 程序设计语言》：</p><pre><code class="language-rust">fn main() {}</code></pre></div></model-response>
    </main>`;
  const { AIEXP } = makePage('gemini.google.com', body);
  const ad = AIEXP.adapters.detect('gemini.google.com');
  const convs = AIEXP.scraper.collectConversationsDOM(ad);
  check('会话列表 2 条', convs.length === 2, convs.map(c => c.title));
  check('会话标题正确', convs[0] && convs[0].title === '如何学习 Rust');

  const turns = AIEXP.scraper.collectTurnsDOM(ad);
  check('消息 2 条', turns.length === 2, turns.length);
  check('角色判定', turns[0] && turns[0].role === 'user' && turns[1] && turns[1].role === 'assistant', turns.map(t => t.role));
  const md = turns.map(t => AIEXP.md.convert(t.html));
  check('用户内容', md[0].includes('如何学习 Rust'), md[0]);
  check('助手内容含代码块语言', md[1].includes('```rust'), md[1]);
}

// ---------- 3. ChatGPT 结构抓取（data-message-author） ----------
console.log('== ChatGPT DOM 抓取 ==');
{
  const body = `
    <nav><a href="/c/abc">会话A</a></nav>
    <main>
      <div data-message-author="user"><div class="markdown">你好</div></div>
      <div data-message-author="assistant"><div class="markdown"><p>你好！</p><table><tr><th>H</th></tr><tr><td>1</td></tr></table></div></div>
    </main>`;
  const { AIEXP } = makePage('chatgpt.com', body);
  const ad = AIEXP.adapters.detect('chatgpt.com');
  const turns = AIEXP.scraper.collectTurnsDOM(ad);
  check('消息 2 条', turns.length === 2, turns.length);
  check('角色判定', turns[0].role === 'user' && turns[1].role === 'assistant', turns.map(t => t.role));
  const md = AIEXP.md.convert(turns[1].html);
  check('表格保真', md.includes('| H |') && md.includes('| 1 |'), md);
}

// ---------- 3b. 通义千问真实 DOM 结构（2026-10 浏览器实测校准） ----------
console.log('== 通义千问真实 DOM 抓取 ==');
{
  const body = `
    <div id="qianwen-layout-left-panel"><div id="qianwen-left-panel" class="bg-pc-sidebar">
      <div class="最近对话"><div class="history-item"><span class="title">如何学习 Rust</span></div></div>
    </div></div>
    <div id="qianwen-main-area">
      <div class="scroll-container message-list-scroll-container message-list-container h-full" id="message-list-scroller">
        <div class="auto-center-wrapper-VqwKSm" id="pc-center-wrapper">
          <div class="message-list-content-container">
            <div class="no-time-separator">
              <div class="chat-round last-message-item perf-ignore-img">
                <div>
                  <div class="message-select-wrapper-question-oonUAN">
                    <div class="chat-question-wrap"><div class="chat-question-card-wrap">
                      <div class="message-card-wrap question"><div class="question-text-card">请用一句话介绍北京</div></div>
                    </div></div>
                  </div>
                  <div class="message-select-wrapper-answer-rqWekn">
                    <div class="chat-answers-card-wrap">
                      <div class="answer-common-card"><p>北京是中华人民共和国首都。</p>
                        <div class="md-code-block"><div class="md-code-block-header">Python</div><pre><code class="language-python">print("hi")</code></pre></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="chat-msg-bottom-anchor"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  const { AIEXP } = makePage('qianwen.com', body);
  const ad = AIEXP.adapters.detect('qianwen.com');
  const convs = AIEXP.scraper.collectConversationsDOM(ad);
  check('千问会话列表', convs.length === 1 && convs[0].title === '如何学习 Rust', convs.map(c => c.title));
  const turns = AIEXP.scraper.collectTurnsDOM(ad);
  check('千问消息 2 条', turns.length === 2, turns.length);
  check('千问角色判定', turns[0].role === 'user' && turns[1].role === 'assistant', turns.map(t => t.role));
  const md0 = AIEXP.md.convert(turns[0].html);
  const md1 = AIEXP.md.convert(turns[1].html);
  check('千问用户内容', md0.includes('请用一句话介绍北京') && !md0.includes('北京是'), md0);
  check('千问助手内容', md1.includes('北京是中华人民共和国首都'), md1);
  check('千问代码块语言', md1.includes('```python'), md1);
}

// ---------- 4. 未知结构兜底（模拟 MiMo 改版） ----------
console.log('== 通用兜底收集 ==');
{
  const body = `
    <main>
      <div class="xxx-row"><div class="user-bubble">用户的问题内容</div></div>
      <div class="xxx-row"><div class="ai-bubble"><p>助手的回答内容</p></div></div>
    </main>`;
  const { AIEXP } = makePage('mimo.mi.com', body);
  const ad = AIEXP.adapters.detect('mimo.mi.com');
  const turns = AIEXP.scraper.collectTurnsDOM(ad);
  check('兜底抓到 2 条', turns.length === 2, turns.map(t => t.role));
  check('兜底角色判定', turns[0].role === 'user' && turns[1].role === 'assistant', turns.map(t => t.role));
}

// ---------- 5. 全链路：加载 → 转换 → 组装 ----------
console.log('== 全链路导出 ==');
async function testPipeline() {
  const body = `
    <nav><a href="/a/chat/s/1">Rust 学习</a></nav>
    <main class="chat-list">
      <div class="ds-message user-message"><div class="bubble">推荐本书</div></div>
      <div class="ds-message">
        <div class="ds-think-content">先分析需求</div>
        <div class="ds-markdown"><p>推荐 <code>TRPL</code>：</p>
          <div class="md-code-block"><div class="md-code-block-header">Rust 1.75</div><pre><code>let x = 1;</code></pre></div>
          <p>公式 <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">x^2</annotation></math></span></span></p>
        </div>
      </div>
    </main>`;
  const { AIEXP } = makePage('chat.deepseek.com', body);
  const ad = AIEXP.adapters.detect('chat.deepseek.com');
  const convs = await AIEXP.scraper.listConversations(ad);
  check('列表 1 条会话', convs.length === 1, convs.length);
  const turns = await AIEXP.scraper.loadTurns(ad, { title: convs[0].title, url: 'https://chat.deepseek.com/a/chat/s/1', el: null });
  check('loadTurns 2 条', turns.length === 2, turns.length);
  check('turn 含 md', turns.every(t => typeof t.md === 'string' && t.md.length > 0));
  const allMd = turns.map(t => t.md).join('\n');
  check('思考过程保留', allMd.includes('🧠 **思考过程**') || allMd.includes('先分析需求'), allMd);
  check('代码块语言提取', allMd.includes('```rust'), allMd);
  check('公式保留', allMd.includes('$x^2$'), allMd);
  const doc = AIEXP.md.buildDoc({ platformName: ad.name, title: convs[0].title, url: 'https://chat.deepseek.com/a/chat/s/1', turns });
  check('文档含 front-matter', doc.startsWith('---'));
  check('文档含问答标题', doc.includes('## 🧑 提问 1') && doc.includes('## 🤖 回答 1'));
  check('文档含来源', doc.includes('来源平台：DeepSeek'));
}

(async () => {
  await testPipeline();

  // ---------- 6. 面板冒烟 ----------
  console.log('== 面板挂载冒烟 ==');
  {
    const { dom } = makePage('chat.deepseek.com', '<main><div class="user-message">hi</div><div class="ds-markdown">hello</div></main>');
    // index.js 在 DOMContentLoaded 后挂载，等待一个 tick
    await new Promise(r => setTimeout(r, 60));
    const host = dom.window.document.getElementById('aiexp-host');
    check('Shadow host 已挂载', !!host);
    const ball = host && host.shadowRoot.querySelector('.ball');
    check('悬浮球存在', !!ball && ball.textContent.includes('MD'));
    const panel = host && host.shadowRoot.querySelector('.panel');
    check('面板存在且初始隐藏', !!panel && !panel.classList.contains('open'));
    if (ball) ball.click();
    check('点击后面板展开', panel.classList.contains('open'));
    check('平台角标', panel.innerHTML.includes('DeepSeek'));
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
