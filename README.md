# AI 对话导出助手 · Chat to Markdown

浏览器扩展（Chrome / Edge，Manifest V3）：把各 AI 平台的网页对话**完整保留排版**导出为 Markdown 文件。

- **可选会话**：侧边栏历史会话列表，一键整篇导出或进入逐条勾选
- **可选每一次问答**：会话内每条提问/回答独立复选框，支持全选 / 反选 / 仅用户 / 仅助手
- **多次问答合并成一个 md**：勾选 N 条合并导出；「导出篮」还可跨会话合并为一个文件
- **不打乱排版**：代码块（带语言标注）、数学公式（LaTeX 还原）、表格、列表、图片、思考过程全部保留

## 支持平台

| 平台 | 域名 | 抓取方式 | 选择器实测状态 |
|---|---|---|---|
| ChatGPT | chatgpt.com / chat.openai.com | 内部 API（Markdown 原文，100% 保真） | 不依赖 DOM，最稳 |
| Claude | claude.ai | 内部 API（Markdown 原文，100% 保真） | 不依赖 DOM，最稳 |
| 通义千问 | tongyi.aliyun.com / tongyi.com / qianwen.com | DOM 抓取 | ✅ 2026-10 真实浏览器实测校准（含真实 DOM 测试锁定） |
| DeepSeek | chat.deepseek.com | DOM 抓取 + KaTeX 公式还原 | ✅ 2026-10 修复虚拟列表侧边栏；含调研 hash class + 语义化兜底 |
| 小米 MiMo | **aistudio.xiaomimimo.com**（对话界面）/ mimo.mi.com（官网） | DOM 抓取（通用兜底 + 启发式角色判定） | ⚠️ 需小米账号登录，建议用🔧诊断确认 |
| Gemini | gemini.google.com | DOM 抓取 + MathJax 公式还原 | ⚠️ 公开结构 + 兜底，首次使用请用🔧诊断确认 |

> 新增平台只需加一个 adapter 文件（见下文「如何新增平台」）。

## 安装

1. 打开 Chrome / Edge，进入扩展管理页：
   - Chrome：地址栏输入 `chrome://extensions`
   - Edge：地址栏输入 `edge://extensions`
2. 打开右上角「**开发者模式**」开关
3. 点「**加载已解压的扩展程序**」，选择本目录（`ai-chat-md-exporter`）
4. 完成。访问任一支持的 AI 平台，页面右下角出现蓝色 **MD** 悬浮球即安装成功

> 首次使用请先在平台网页登录（扩展复用浏览器登录态，不索取任何账号密码）。

## 使用

### 方式一：导出当前会话（最快）
打开任意对话 → 点悬浮球 → 面板顶部「**⬇ 导出当前会话**」。

### 方式二：按会话整篇导出
点悬浮球 → 会话列表 → 点某行右侧「**导出**」按钮。

### 方式三：按问答勾选，合并导出（核心功能）
1. 点悬浮球 → 会话列表 → 点击会话标题进入问答视图
2. 勾选需要的问答（默认全选；点击条目可展开全文预览）
3. 底部可自定义文件名 → 点「**导出所选**」
4. 多条勾选会按对话顺序合并为一个 md，标题自动编号「提问 1 / 回答 1……」

### 导出篮（跨会话合并）
在问答视图点「**🧺 加入导出篮**」可把当前勾选的问答暂存；切换到其他会话继续勾选加入；最后点列表页顶部的「**🧺 导出篮**」一次性合并导出，文件内按会话分组。

### 导出的 md 结构

```markdown
---
title: "会话标题"
source: "DeepSeek"
url: "https://chat.deepseek.com/a/chat/s/xxx"
exported_at: "2026-10-12T21:30:00.000Z"
turns: 4
---

# 会话标题

> 📥 来源平台：DeepSeek · 原始对话链接
> 🕒 导出时间：2026-10-12 21:30 · 共 4 条问答

## 🧑 提问 1 · 2026-10-10 14:23

用户消息内容……

## 🤖 回答 1 · 2026-10-10 14:23

助手消息内容……

---
```

## 如何新增平台

扩展采用适配器插件化架构，新增平台只需两步：

**1. 新建 `src/adapters/your-platform.js`**

```js
(function () {
  window.AIEXP = window.AIEXP || {};
  window.AIEXP.adapters.register({
    id: 'yourplatform',                 // 唯一 ID
    name: '平台显示名',
    match: ['www.example.com'],          // 域名匹配
    selectors: {
      sidebar: 'nav, [class*="sidebar"]',          // 侧边栏容器
      convItem: 'a[href*="/chat/"]',               // 会话项
      convTitle: '[class*="title"], span',         // 标题元素
      scrollArea: 'main',                          // 消息滚动区
      msg: '[class*="message"]',                   // 消息元素（多组 fallback 用数组）
      userMsg: '[class*="user"]',                  // 用户消息标记
      asstMsg: '[class*="assistant"]',             // 助手消息标记
      userContent: '.query-text',                  // 可选：用户内容区
      asstContent: '.markdown'                     // 可选：助手内容区
    }
    // 可选：内部 API 快路径（返回 Markdown 原文，保真度最高）
    // api: { list: async () => [{id,title,url}], detail: async (conv) => [{role, md, time}] }
  });
})();
```

**2. 在 `manifest.json` 两处加入域名**（`host_permissions` 和 `content_scripts.matches`）

选择器全部支持**数组形式的多组 fallback**，平台小改版通常无需干预；若完全失灵，扩展会自动降级到「通用兜底收集 + 启发式角色判定」，仍可导出。

## 技术架构

```
ai-chat-md-exporter/
├── manifest.json                 # MV3 清单（content_scripts 按序加载）
├── src/
│   ├── background.js             # Service Worker（下载代理兜底）
│   ├── adapters/                 # ★ 平台适配层（插件化）
│   │   ├── index.js              #   注册表 + 启发式角色判定 + 通用收集器
│   │   ├── chatgpt.js            #   内部 API 快路径
│   │   ├── claude.js             #   内部 API 快路径
│   │   ├── gemini.js             #   DOM（MathJax）
│   │   ├── deepseek.js           #   DOM（KaTeX + R1 思考块）
│   │   ├── qwen.js               #   DOM
│   │   └── mimo.js               #   DOM（宽松选择器）
│   ├── lib/
│   │   ├── md.js                 # ★ Markdown 引擎：Turndown + 自定义规则
│   │   └── vendor/               #   Turndown / GFM 插件（UMD）
│   └── content/
│       ├── scraper.js            # ★ 抓取层：虚拟滚动全量加载 / 会话切换 / 分层角色判定
│       ├── panel.js              # 面板 UI（Shadow DOM 隔离，不污染页面）
│       └── index.js              # 入口：平台识别 + 挂载
├── tests/                        # jsdom 测试（67 项断言）
└── tools/make_icons.py           # 图标生成（纯 Python，无依赖）
```

### 保真度设计

| 元素 | 处理方式 |
|---|---|
| 代码块 | 语言从 `code.language-x` / `pre[data-lang]` / 代码块头部多源识别，输出围栏代码块；头部语言栏自动移除不泄漏 |
| 数学公式 | KaTeX / MathJax 渲染结果中提取 `annotation[encoding="application/x-tex"]` 还原 LaTeX；块级 `$$…$$`、行内 `$…$` |
| 表格 / 任务列表 | Turndown GFM 插件 |
| 思考过程（R1/thinking） | **不导出**（按需求直接移除，Claude API 路径同样跳过 thinking 内容） |
| 图片 | **仅保留正文图片**；favicon / 头像 / logo / 徽标 / 小尺寸图标（≤24px）自动过滤；兼容懒加载 `data-src`/`srcset` |
| 用户提问 | 包裹为 Markdown 引用块（`>`），与正文形成视觉区分 |
| ChatGPT/Claude | 直接取平台返回的 Markdown **原文**，不经 DOM 转换 |

### 健壮性设计

- **三层抓取降级**：平台选择器 → 通用兜底收集（主滚动容器 + 文本块聚类）→ 结构诊断工具
- **虚拟滚动加载**：反复滚动至内容数量稳定，解决长对话只渲染部分消息的问题
- **嵌套去重**：消息行与内容区同时命中时，按文本包含关系保留更长的
- **导出后恢复**：批量导出过程会切换会话，完成后自动跳回原会话

## 平台改版了怎么办？

点面板右上角「**🔧 结构诊断**」→「复制诊断信息」，会复制：

- 当前识别结果（会话项数量、消息数量、兜底收集器能找到的数量）
- 消息区 DOM 骨架（前 6000 字符）

把这份信息提供给开发者，即可快速校准选择器；诊断显示 `turnsDetected > 0` 说明当前选择器有效。

## 开发与测试

```bash
npm install          # 安装开发依赖（jsdom / turndown）
npm test             # 运行全部测试（转换规则 32 项 + 集成冒烟 35 项）
npm run icons        # 重新生成图标
```

测试覆盖：6 平台注册识别、Gemini/ChatGPT DOM 抓取、未知结构兜底、全链路导出、面板挂载、32 项排版保真规则。

## 更新日志

### v1.0.2（2026-10-13）
- **不再导出思考过程**：DeepSeek R1 / Claude thinking 块直接移除（此前转为引用块保留）
- **过滤链接图标**：favicon / 头像 / logo / 徽标 / ≤24px 小图片不再进入 md，只保留正文图片
- **强化用户提问显示**：用户提问内容包裹为 Markdown 引用块（`>`），与助手正文形成视觉区分
- **修复**：代码块头部语言栏在 `<code class="language-xxx">` 存在时不再泄漏（`[class*="lang"]` 误匹配 language class 的 bug）

### v1.0.1（2026-10-12）
- **修复**：小米 MiMo 对话界面域名为 `aistudio.xiaomimimo.com`（原仅匹配 mimo.mi.com 导致悬浮球不出现）
- **修复**：DeepSeek 刷新列表获取不到历史会话 —— 侧边栏是**虚拟列表**（DOM 会回收），重写为「先滚加载 → 再自上而下按序收集」两阶段策略；补充调研到的真实 hash class（`.b8812f16` 面板 / `._546d736` 会话项）+ 语义化兜底
- **新增**：侧边栏通用兜底收集（选择器全失效时自动启用，过滤功能菜单项）
- **改进**：会话激活改为「按标题边滚边找」，适配虚拟列表；消息收集同样改为虚拟列表安全的两阶段策略

## 已知限制

- **DeepSeek / MiMo / Gemini 需登录后使用**：2026-10 实测，chat.deepseek.com 已强制登录（匿名聊天已关闭），MiMo 需小米账号，Gemini 在此网络不可达。登录后如选择器失效，用「🔧 结构诊断」反馈即可校准
- **通义千问历史会话项**：登录后的历史列表 class 未能匿名捕获，已内置多组候选 + 兜底；个别情况请用诊断确认
- Claude 的「项目（Projects）」内会话可能不在标准列表 API 中，会自动降级 DOM 抓取
- Gemini 会话 URL 不随会话切换变化，导出篮中的链接可能指向当前会话
- 各平台 API 路径若改版会自动降级 DOM 抓取，保真度略降但功能可用
- 图片附件在 ChatGPT 中为内部资产指针，导出为占位链接
- 若某平台点击会话是整页跳转（非 SPA），导出过程中的面板状态会重置，需重新打开面板（主流平台均为 SPA，无此问题）

## 隐私

扩展全部逻辑在本地浏览器内完成：不收集、不上传任何对话内容；导出文件通过浏览器标准下载保存到本机。
