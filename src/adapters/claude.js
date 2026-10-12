/*
 * Claude (claude.ai)
 * 策略：内部 API 快路径（chat_messages 返回的即为 Markdown 原文），失败降级 DOM
 */
(function () {
  window.AIEXP = window.AIEXP || {};
  var A = window.AIEXP.adapters;

  var BASE = location.origin;

  async function getOrg() {
    var r = await fetch(BASE + '/api/organizations', {
      credentials: 'include',
      headers: { accept: 'application/json' }
    });
    if (!r.ok) throw new Error('orgs ' + r.status);
    var j = await r.json();
    if (!Array.isArray(j) || !j.length) throw new Error('no org');
    // 优先个人 org（capabilities 包含 chat）
    var org = j[0];
    for (var i = 0; i < j.length; i++) {
      if (j[i].capabilities && j[i].capabilities.indexOf('chat') >= 0) { org = j[i]; break; }
    }
    return org.uuid;
  }

  async function apiList() {
    var org = await getOrg();
    var r = await fetch(BASE + '/api/organizations/' + org + '/chat_conversations', {
      credentials: 'include',
      headers: { accept: 'application/json' }
    });
    if (!r.ok) throw new Error('list ' + r.status);
    var j = await r.json();
    return (j || []).map(function (c) {
      return {
        id: c.uuid,
        title: c.name || '未命名会话',
        time: c.updated_at || c.created_at || null,
        el: null,
        url: BASE + '/chat/' + c.uuid
      };
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : window.AIEXP.md.formatTime(d);
  }

  function buildContent(m) {
    var parts = [];
    (m.content || []).forEach(function (c) {
      if (c.type === 'text' && c.text) parts.push(c.text.trim());
      else if (c.type === 'thinking' && c.thinking) {
        var quoted = String(c.thinking).trim().split('\n').map(function (l) { return '> ' + l; }).join('\n');
        parts.push('> 🧠 **思考过程**\n>\n' + quoted);
      } else if (c.type === 'tool_use') {
        parts.push('```json\n// 工具调用：' + (c.name || 'tool') + '\n' +
          JSON.stringify(c.input || {}, null, 2) + '\n```');
      }
    });
    (m.attachments || []).forEach(function (a) {
      parts.push('*(附件：' + (a.file_name || '未知文件') + ')*');
    });
    return parts.join('\n\n').trim();
  }

  async function apiDetail(conv) {
    var org = await getOrg();
    var r = await fetch(BASE + '/api/organizations/' + org + '/chat_conversations/' + encodeURIComponent(conv.id), {
      credentials: 'include',
      headers: { accept: 'application/json' }
    });
    if (!r.ok) throw new Error('detail ' + r.status);
    var data = await r.json();
    var turns = [];
    (data.chat_messages || []).forEach(function (m) {
      var role = m.sender === 'human' ? 'user' : (m.sender === 'assistant' ? 'assistant' : null);
      if (!role) return;
      var md = buildContent(m);
      if (!md) return;
      turns.push({ role: role, md: md, time: fmtTime(m.created_at) });
    });
    return turns;
  }

  A.register({
    id: 'claude',
    name: 'Claude',
    match: ['claude.ai'],
    selectors: {
      sidebar: 'nav, [class*="sidebar"], [class*="history"]',
      convItem: 'a[href^="/chat/"]',
      convTitle: '[class*="truncate"], span, div',
      scrollArea: 'main, [class*="overflow-y-auto"]',
      msg: '[data-testid="user-message"], [data-testid="ai-message"], .font-user-message, .font-claude-message, [data-is-streaming]',
      userMsg: '[data-testid="user-message"], .font-user-message',
      asstMsg: '[data-testid="ai-message"], .font-claude-message',
      msgContent: '.grid, [class*="prose"], [class*="whitespace-pre-wrap"]'
    },
    api: { list: apiList, detail: apiDetail }
  });
})();
