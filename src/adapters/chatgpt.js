/*
 * ChatGPT (chatgpt.com / chat.openai.com)
 * 策略：内部 API 快路径（直接拿 Markdown 原文，100% 保真），失败降级 DOM
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  var BASE = location.origin;

  async function getToken() {
    var r = await fetch(BASE + '/api/auth/session', {
      credentials: 'include',
      headers: { accept: 'application/json' }
    });
    if (!r.ok) throw new Error('session ' + r.status);
    var j = await r.json();
    if (!j.accessToken) throw new Error('no accessToken');
    return j.accessToken;
  }

  async function apiList() {
    var token = await getToken();
    var out = [];
    var offset = 0;
    var limit = 100;
    for (var page = 0; page < 20; page++) {
      var r = await fetch(BASE + '/backend-api/conversations?offset=' + offset + '&limit=' + limit + '&order=updated', {
        credentials: 'include',
        headers: { accept: 'application/json', authorization: 'Bearer ' + token }
      });
      if (!r.ok) throw new Error('list ' + r.status);
      var j = await r.json();
      var items = j.items || [];
      items.forEach(function (it) {
        out.push({
          id: it.id,
          title: it.title || '未命名会话',
          time: it.update_time || it.create_time || null,
          el: null,
          url: BASE + '/c/' + it.id
        });
      });
      if (items.length < limit) break;
      offset += limit;
    }
    return out;
  }

  function fmtTime(unix) {
    if (!unix) return '';
    return window.AIEXP.md.formatTime(new Date(unix * 1000));
  }

  /** 从 mapping 树按 current_node 回溯出有序消息 */
  function walkMapping(data) {
    var turns = [];
    var node = data.mapping && data.current_node ? data.mapping[data.current_node] : null;
    var chain = [];
    while (node) {
      chain.unshift(node);
      node = node.parent ? data.mapping[node.parent] : null;
    }
    chain.forEach(function (n) {
      var m = n.message;
      if (!m) return;
      var role = m.author && m.author.role;
      if (role !== 'user' && role !== 'assistant') return;
      var c = m.content || {};
      var parts = [];
      if (c.content_type === 'text' || c.content_type === 'multimodal_text') {
        (c.parts || []).forEach(function (p) {
          if (typeof p === 'string') parts.push(p);
          else if (p && p.asset_pointer) parts.push('![图片](' + p.asset_pointer + ')');
        });
      } else if (c.content_type === 'code' && typeof c.text === 'string') {
        parts.push('```\n' + c.text + '\n```');
      }
      var md = parts.join('\n\n').trim();
      if (!md) return;
      turns.push({ role: role, md: md, time: fmtTime(m.create_time) });
    });
    return turns;
  }

  async function apiDetail(conv) {
    var token = await getToken();
    var r = await fetch(BASE + '/backend-api/conversation/' + encodeURIComponent(conv.id), {
      credentials: 'include',
      headers: { accept: 'application/json', authorization: 'Bearer ' + token }
    });
    if (!r.ok) throw new Error('detail ' + r.status);
    var data = await r.json();
    if (!data.mapping) throw new Error('empty mapping');
    conv.title = data.title || conv.title;
    return walkMapping(data);
  }

  A.register({
    id: 'chatgpt',
    name: 'ChatGPT',
    match: ['chatgpt.com', 'chat.openai.com'],
    selectors: {
      sidebar: 'nav, [class*="sidebar"], [class*="history"]',
      convItem: 'a[href^="/c/"]',
      convTitle: '[class*="truncate"], span, div',
      scrollArea: 'main, [class*="overflow-y-auto"]',
      msg: '[data-message-author]',
      userMsg: '[data-message-author="user"]',
      asstMsg: '[data-message-author="assistant"]',
      msgContent: '.markdown, [class*="markdown"], [class*="whitespace-pre-wrap"]'
    },
    api: { list: apiList, detail: apiDetail }
  });
})();
