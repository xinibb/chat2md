/*
 * 转换引擎单测：jsdom 模拟 DOM，覆盖全部保真规则
 * 运行：node tests/test-md.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://chat.deepseek.com/',
  pretendToBeVisual: true,
  runScripts: 'dangerously'
});
const ctx = dom.getInternalVMContext();

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx);
}
load('src/lib/vendor/turndown.min.js');
load('src/lib/vendor/turndown-plugin-gfm.min.js');
load('src/adapters/index.js');
load('src/lib/md.js');

const AIEXP = vm.runInContext('window.AIEXP', ctx);
const convert = AIEXP.md.convert;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '\n     实际: ' + JSON.stringify(detail) : '')); }
}

// ---------- fixture：综合排版 ----------
const fixture = `
<h2>标题二</h2>
<p>这是<strong>加粗</strong>与<em>斜体</em>，还有<code>inline_code</code>和<a href="https://x.com">链接</a>。</p>
<ul><li>项目一</li><li>项目二</li></ul>
<ol><li>第一</li><li>第二</li></ol>
<blockquote><p>引用内容</p></blockquote>
<hr>
<table><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
<pre><code class="language-python">def f():
    return 1</code></pre>
<pre data-lang="javascript">console.log("hi")</pre>
<div class="md-code-block"><div class="md-code-block-header">Go 1.22</div><pre><code>package main</code></pre></div>
<p>行内公式 <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">a^2+b^2</annotation></math></span></span> 结束</p>
<span class="katex-display"><span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">E = mc^2</annotation></math></span></span></span>
<mjx-container class="MathJax" jax="SVG"><mjx-assistive-mml><math><annotation encoding="application/x-tex">\\frac{1}{2}</annotation></math></mjx-assistive-mml></mjx-container>
<mjx-container class="MathJax" jax="SVG" display="true"><mjx-assistive-mml><math><annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation></math></mjx-assistive-mml></mjx-container>
<p><img data-src="https://example.com/a.png" alt="示例图"></p>
<div class="ds-think-content">先让我想想这个问题</div>
<p>公式script：<script type="math/tex">x_1</script> 完</p>
`;

console.log('== Markdown 转换规则测试 ==');
const md = convert(fixture);
console.log('--- 转换结果 ---');
console.log(md);
console.log('-----------------');

check('ATX 标题', md.includes('## 标题二'));
check('加粗', md.includes('**加粗**'));
check('斜体', md.includes('*斜体*'));
check('行内代码', md.includes('`inline_code`'));
check('链接', md.includes('[链接](https://x.com)'));
check('无序列表', /- 项目一\n- 项目二/.test(md));
check('有序列表', /1\. 第一\n2\. 第二/.test(md));
check('引用块', md.includes('> 引用内容'));
check('分割线', md.includes('\n---\n'));
check('表格', md.includes('| 列A | 列B |') && md.includes('| --- | --- |') && md.includes('| 1 | 2 |'));
check('代码块-语言class', md.includes('```python\ndef f():\n    return 1\n```'));
check('代码块-data-lang', md.includes('```javascript\nconsole.log("hi")\n```'));
check('代码块-头部语言', md.includes('```go\npackage main\n```'));
check('KaTeX行内公式', md.includes('$a^2+b^2$'));
check('KaTeX块级公式', md.includes('$$\nE = mc^2\n$$'));
check('MathJax行内公式', md.includes('$\\frac{1}{2}$'));
check('MathJax块级公式', md.includes('$$\n\\int_0^1 x\\,dx\n$$'));
check('math/tex script', md.includes('$x_1$'));
check('图片懒加载data-src', md.includes('![示例图](https://example.com/a.png)'));
check('思考过程块', md.includes('> 🧠 **思考过程**') && md.includes('先让我想想'));
check('无连续3空行(围栏外)', !/(^|[^`])\n\n\n[^`]/.test(md.replace(/```[\s\S]*?```/g, '§')));
check('代码块内空行保留', md.includes('```python\ndef f():\n    return 1\n```'));

// ---------- buildDoc 单会话 ----------
console.log('== buildDoc 文档组装测试 ==');
const doc = AIEXP.md.buildDoc({
  platformName: 'DeepSeek',
  title: '测试会话',
  url: 'https://chat.deepseek.com/a/chat/s/123',
  turns: [
    { role: 'user', md: '你好', time: '2026-10-10 14:00' },
    { role: 'assistant', md: '你好！有什么可以帮你？', time: '2026-10-10 14:01' }
  ]
});
check('front-matter', doc.startsWith('---\ntitle: "测试会话"'));
check('来源标注', doc.includes('> 📥 来源平台：DeepSeek'));
check('提问标题', doc.includes('## 🧑 提问 1 · 2026-10-10 14:00'));
check('回答标题', doc.includes('## 🤖 回答 1 · 2026-10-10 14:01'));
check('问答分隔', doc.includes('\n---\n'));

// ---------- buildDoc 多会话合并 ----------
const doc2 = AIEXP.md.buildDoc({
  platformName: 'ChatGPT',
  title: '多会话合并导出',
  groups: [
    { title: '会话A', url: 'https://chatgpt.com/c/1', turns: [{ role: 'user', md: '问题1', time: '' }] },
    { title: '会话B', url: 'https://chatgpt.com/c/2', turns: [{ role: 'user', md: '问题2', time: '' }, { role: 'assistant', md: '回答2', time: '' }] }
  ]
});
check('多会话分组标题', doc2.includes('## 🗂 会话 1：会话A') && doc2.includes('## 🗂 会话 2：会话B'));
check('多会话turn计数', doc2.includes('turns: 3') && doc2.includes('conversations: 2'));
check('多会话内容齐全', doc2.includes('问题1') && doc2.includes('问题2') && doc2.includes('回答2'));

// ---------- safeFilename ----------
console.log('== 文件名安全化测试 ==');
check('非法字符替换', AIEXP.md.safeFilename('a/b\\c:d*e?f"g<h>i|j') === 'a_b_c_d_e_f_g_h_i_j');
check('空名兜底', AIEXP.md.safeFilename('') === 'export');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
