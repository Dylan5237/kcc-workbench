/* MD / JSON 实时预览 - 前端逻辑 */
(function () {
  const treeEl = document.getElementById('fileTree');
  const viewerEl = document.getElementById('viewer');
  const fileHeaderEl = document.getElementById('fileHeader');
  const fileNameEl = document.getElementById('fileName');
  const fileMetaEl = document.getElementById('fileMeta');
  const updatedBadge = document.getElementById('updatedBadge');
  const liveDot = document.getElementById('liveDot');
  const liveText = document.getElementById('liveText');
  const filterInput = document.getElementById('filterInput');
  const refreshBtn = document.getElementById('refreshBtn');
  const rootInput = document.getElementById('rootInput');
  const recentRootsEl = document.getElementById('recentRoots');
  const browseBtn = document.getElementById('browseBtn');
  const applyRootBtn = document.getElementById('applyRootBtn');
  const pickerModal = document.getElementById('pickerModal');
  const pickerCrumb = document.getElementById('pickerCrumb');
  const pickerList = document.getElementById('pickerList');
  const pickerCurrent = document.getElementById('pickerCurrent');
  const pickerSelect = document.getElementById('pickerSelect');
  const pickerClose = document.getElementById('pickerClose');
  const toastEl = document.getElementById('toast');

  let treeData = null;
  let currentPath = null; // 当前打开的文件相对路径
  let currentRoot = ''; // 当前监听根目录(绝对路径)
  const collapsed = new Set(); // 折叠的目录

  marked.setOptions({ breaks: true, gfm: true });

  // ---------- 文件树 ----------
  async function loadTree(keepSelection) {
    const res = await fetch('/api/tree');
    const data = await res.json();
    treeData = data.tree;
    currentRoot = data.root;
    if (document.activeElement !== rootInput) rootInput.value = data.root;
    renderTree();
    if (!keepSelection) return;
    // 当前文件可能被删除
    if (currentPath && !findNode(treeData, currentPath)) {
      currentPath = null;
      showEmpty();
    }
  }

  function findNode(node, p) {
    if (node.type === 'file' && node.path === p) return node;
    if (node.children) {
      for (const c of node.children) {
        const r = findNode(c, p);
        if (r) return r;
      }
    }
    return null;
  }

  function renderTree() {
    const filter = filterInput.value.trim().toLowerCase();
    treeEl.innerHTML = '';
    if (!currentRoot) {
      treeEl.innerHTML = '<div class="tree-empty"><strong>尚未选择项目</strong><span>请选择一个包含 Markdown 或 JSON 的文件夹</span></div>';
      return;
    }
    if (!treeData || !treeData.children || !treeData.children.length) {
      treeEl.innerHTML = '<div class="tree-empty">目录下没有 .md / .json 文件</div>';
      return;
    }
    const ul = document.createElement('ul');
    let anyVisible = false;
    for (const child of treeData.children) {
      const li = buildNode(child, filter);
      if (li) { ul.appendChild(li); anyVisible = true; }
    }
    treeEl.appendChild(ul);
    if (!anyVisible) treeEl.innerHTML = '<div class="tree-empty">无匹配文件</div>';
  }

  function buildNode(node, filter) {
    // 过滤:目录需有匹配后代,文件需名字匹配
    if (filter) {
      if (node.type === 'file' && !node.name.toLowerCase().includes(filter)) return null;
      if (node.type === 'dir') {
        const hasMatch = (n) => n.children && n.children.some(c => c.type === 'file' ? c.name.toLowerCase().includes(filter) : hasMatch(c));
        if (!hasMatch(node)) return null;
      }
    }

    const li = document.createElement('li');
    li.className = 'tree-item';
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.title = node.path;
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, node);
    });

    if (node.type === 'dir') {
      const isCollapsed = collapsed.has(node.path) && !filter;
      row.innerHTML = `<span class="arrow ${isCollapsed ? '' : 'open'}">▶</span><span class="icon">📁</span><span>${escapeHtml(node.name)}</span>`;
      row.onclick = () => {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        renderTree();
      };
      li.appendChild(row);
      if (!isCollapsed) {
        const ul = document.createElement('ul');
        for (const c of node.children) {
          const childLi = buildNode(c, filter);
          if (childLi) ul.appendChild(childLi);
        }
        li.appendChild(ul);
      }
    } else {
      const ext = node.ext.slice(1);
      const icon = node.ext === '.md' ? '📝' : '🧩';
      row.innerHTML = `<span class="arrow"></span><span class="icon">${icon}</span><span>${escapeHtml(node.name)}</span><span class="ext-tag ${ext}">${ext}</span>`;
      if (node.path === currentPath) row.classList.add('active');
      row.onclick = () => openFile(node.path);
      li.appendChild(row);
    }
    return li;
  }

  // ---------- 文件树右键菜单 ----------
  let ctxMenuEl = null;

  // 拼节点绝对路径(Windows 反斜杠格式)
  function absPathOf(node) {
    const joined = (currentRoot.replace(/[\\/]+$/, '') + '/' + node.path);
    return joined.replace(/\//g, '\\');
  }

  function hideContextMenu() {
    if (ctxMenuEl) {
      ctxMenuEl.remove();
      ctxMenuEl = null;
    }
  }

  function showContextMenu(x, y, node) {
    hideContextMenu();
    const absPath = absPathOf(node);
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';

    const items = [];
    // 复制文件本体(CF_HDROP)仅 Electron 桌面环境可用
    if (window.electronAPI && window.electronAPI.copyFiles) {
      items.push({
        label: '📄 复制文件',
        onClick: async () => {
          try {
            await window.electronAPI.copyFiles([absPath]);
            toast('已复制,可到目标文件夹 Ctrl+V 粘贴');
          } catch (err) {
            toast('复制失败:' + err.message, true);
          }
        },
      });
    }
    items.push({
      label: '🔗 复制文件地址',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(absPath);
          toast('已复制地址:' + absPath);
        } catch (err) {
          toast('复制失败:' + err.message, true);
        }
      },
    });

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'ctx-menu-item';
      el.textContent = item.label;
      el.onclick = async () => {
        hideContextMenu();
        await item.onClick();
      };
      menu.appendChild(el);
    }

    document.body.appendChild(menu);
    ctxMenuEl = menu;

    // 视口边缘收拢
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';

    // 点击空白 / Esc / 滚动时关闭
    setTimeout(() => {
      document.addEventListener('mousedown', docClose);
      document.addEventListener('keydown', escClose);
      document.addEventListener('scroll', scrollClose, true);
    }, 0);
  }

  function docClose(e) {
    if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxListeners();
  }
  function escClose(e) {
    if (e.key === 'Escape') closeCtxListeners();
  }
  function scrollClose() {
    closeCtxListeners();
  }
  function closeCtxListeners() {
    hideContextMenu();
    document.removeEventListener('mousedown', docClose);
    document.removeEventListener('keydown', escClose);
    document.removeEventListener('scroll', scrollClose, true);
  }

  // ---------- 侧栏拖拽调宽 ----------
  function initSplitter() {
    const splitter = document.getElementById('splitter');
    const sidebar = document.getElementById('sidebar');
    const MIN = 180, MAX = 600;

    const saved = Number(localStorage.getItem('sidebarWidth'));
    if (saved >= MIN && saved <= MAX) sidebar.style.width = saved + 'px';

    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      splitter.classList.add('dragging');
      document.body.classList.add('resizing');

      const onMove = (ev) => {
        const w = Math.min(MAX, Math.max(MIN, ev.clientX));
        sidebar.style.width = w + 'px';
      };
      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        splitter.classList.remove('dragging');
        document.body.classList.remove('resizing');
        const w = Math.min(MAX, Math.max(MIN, ev.clientX));
        localStorage.setItem('sidebarWidth', String(w));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ---------- 文件渲染 ----------
  async function openFile(p, silent) {
    try {
      const res = await fetch('/api/file?p=' + encodeURIComponent(p));
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const file = await res.json();
      currentPath = p;
      renderTree(); // 更新高亮
      renderFile(file, silent);
    } catch (err) {
      viewerEl.innerHTML = `<div class="empty-hint"><p>读取失败:${escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderFile(file, silent) {
    fileHeaderEl.classList.remove('hidden');
    fileNameEl.textContent = file.path;
    fileMetaEl.textContent = `${formatSize(file.size)} · 更新于 ${new Date(file.mtime).toLocaleTimeString('zh-CN')}`;

    const keepScroll = silent ? viewerEl.scrollTop : 0;

    if (file.ext === '.md') {
      viewerEl.innerHTML = `<div class="markdown-body">${sanitizeMarkdown(marked.parse(file.content))}</div>`;
    } else {
      renderJson(file);
    }

    if (silent) viewerEl.scrollTop = keepScroll;

    if (silent) {
      updatedBadge.classList.remove('hidden');
      setTimeout(() => updatedBadge.classList.add('hidden'), 2000);
    }
  }

  function showEmpty() {
    fileHeaderEl.classList.add('hidden');
    viewerEl.innerHTML = `<div class="empty-hint"><p>← 从左侧选择一个 <code>.md</code> 或 <code>.json</code> 文件</p><p class="sub">文件修改后会自动刷新</p></div>`;
  }

  function sanitizeMarkdown(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const element of template.content.querySelectorAll(
      'script, iframe, object, embed, form, input, button, meta, link, style'
    )) {
      element.remove();
    }
    for (const element of template.content.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        if (
          attribute.name.toLowerCase().startsWith('on')
          || ['srcdoc', 'formaction'].includes(attribute.name.toLowerCase())
        ) {
          element.removeAttribute(attribute.name);
        }
      }
      for (const attributeName of ['href', 'src']) {
        const value = element.getAttribute(attributeName);
        if (value && /^\s*(?:javascript|vbscript|data):/i.test(value)) {
          element.removeAttribute(attributeName);
        }
      }
    }
    return template.innerHTML;
  }

  // ---------- JSON 三视图:表格 / 树形 / 原文 ----------
  const viewModeByPath = new Map(); // 记住每个文件上次使用的视图
  const JSON_MODES = [
    { id: 'table', label: '表格' },
    { id: 'tree', label: '树形' },
    { id: 'raw', label: '原文' },
  ];

  function renderJson(file) {
    let data = null, err = null;
    try {
      data = JSON.parse(file.content);
    } catch (e) {
      err = e.message;
    }
    if (err) {
      viewerEl.innerHTML =
        `<div class="json-error">⚠ JSON 解析失败:${escapeHtml(err)}(显示原始内容)</div>` +
        `<div class="json-view">${highlightJson(file.content)}</div>`;
      return;
    }
    const mode = viewModeByPath.get(file.path) || 'table';
    viewerEl.innerHTML = `
      <div class="json-tabs">${JSON_MODES.map(m =>
        `<button data-mode="${m.id}" class="${m.id === mode ? 'active' : ''}">${m.label}</button>`).join('')}
      </div>
      <div id="jsonBody" class="json-body"></div>`;
    viewerEl.querySelectorAll('.json-tabs button').forEach(btn => {
      btn.onclick = () => {
        viewModeByPath.set(file.path, btn.dataset.mode);
        renderJson(file);
      };
    });
    const body = document.getElementById('jsonBody');
    if (mode === 'raw') {
      body.innerHTML = `<div class="json-view">${highlightJson(JSON.stringify(data, null, 2))}</div>`;
    } else if (mode === 'tree') {
      body.appendChild(buildJsonTree(data));
    } else {
      body.appendChild(buildSmartValue(data, 0));
    }
  }

  // ---------- 智能表格视图 ----------
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // 对象数组 → 表格;过宽(>20 列)退化为卡片列表
  function isTabular(arr) {
    return arr.length > 0 && arr.every(isPlainObject) && unionKeys(arr).length <= 20;
  }

  function unionKeys(arr) {
    const keys = [], seen = new Set();
    for (const item of arr) {
      for (const k of Object.keys(item)) {
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
    }
    return keys;
  }

  function buildSmartValue(value, depth) {
    const frag = document.createElement('div');
    frag.className = 'smart-node';

    if (value === null || typeof value !== 'object') {
      frag.appendChild(primitiveSpan(value));
      return frag;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        frag.innerHTML = '<span class="muted">空数组 []</span>';
      } else if (value.every(v => v === null || typeof v !== 'object')) {
        // 基本类型数组 → 标签
        const chips = document.createElement('div');
        chips.className = 'chips';
        for (const v of value) {
          const c = document.createElement('span');
          c.className = 'chip';
          c.appendChild(primitiveSpan(v));
          chips.appendChild(c);
        }
        frag.appendChild(chips);
      } else if (isTabular(value)) {
        frag.appendChild(buildTable(value, depth));
      } else {
        // 混合/深层数组 → 编号列表
        const list = document.createElement('div');
        list.className = 'arr-list';
        value.forEach((item, i) => {
          const row = document.createElement('div');
          row.className = 'arr-item';
          const idx = document.createElement('span');
          idx.className = 'arr-idx';
          idx.textContent = `[${i}]`;
          row.appendChild(idx);
          row.appendChild(buildSmartValue(item, depth + 1));
          list.appendChild(row);
        });
        frag.appendChild(list);
      }
      return frag;
    }

    // 对象 → 键值卡片
    const entries = Object.entries(value);
    if (entries.length === 0) {
      frag.innerHTML = '<span class="muted">空对象 {}</span>';
      return frag;
    }
    const card = document.createElement('div');
    card.className = 'kv-card';
    for (const [k, v] of entries) {
      const row = document.createElement('div');
      // 嵌套结构(表格/卡片/列表)独占一行,键名置顶,给足宽度
      const isComplex = v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
      row.className = 'kv-row' + (isComplex ? ' kv-row-stacked' : '');
      const key = document.createElement('div');
      key.className = 'kv-key';
      key.textContent = k;
      const val = document.createElement('div');
      val.className = 'kv-val';
      val.appendChild(buildSmartValue(v, depth + 1));
      row.appendChild(key);
      row.appendChild(val);
      card.appendChild(row);
    }
    frag.appendChild(card);
    return frag;
  }

  function buildTable(arr, depth) {
    const keys = unionKeys(arr);
    const wrap = document.createElement('div');
    wrap.className = 'jt-wrap';
    const table = document.createElement('table');
    table.className = 'jt';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const k of keys) {
      const th = document.createElement('th');
      th.textContent = k;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const item of arr) {
      const tr = document.createElement('tr');
      for (const k of keys) {
        const td = document.createElement('td');
        const v = item[k];
        if (v === undefined) {
          td.innerHTML = '<span class="muted">—</span>';
        } else if (v === null || typeof v !== 'object') {
          td.appendChild(primitiveSpan(v));
        } else {
          // 嵌套结构 → 可展开的摘要
          const det = document.createElement('details');
          const sum = document.createElement('summary');
          sum.textContent = Array.isArray(v) ? `数组 · ${v.length} 项` : `对象 · ${Object.keys(v).length} 键`;
          det.appendChild(sum);
          det.appendChild(buildSmartValue(v, depth + 1));
          td.appendChild(det);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    const cnt = document.createElement('div');
    cnt.className = 'jt-count';
    cnt.textContent = `共 ${arr.length} 行`;
    wrap.appendChild(cnt);
    return wrap;
  }

  function primitiveSpan(v) {
    const s = document.createElement('span');
    if (v === null) { s.className = 'v-null'; s.textContent = 'null'; }
    else if (typeof v === 'boolean') { s.className = 'v-bool'; s.textContent = String(v); }
    else if (typeof v === 'number') { s.className = 'v-number'; s.textContent = String(v); }
    else { s.className = 'v-string'; s.textContent = String(v); }
    return s;
  }

  // ---------- 树形视图 ----------
  function buildJsonTree(data) {
    const wrap = document.createElement('div');
    wrap.className = 'json-tree';
    wrap.appendChild(treeNode('根节点', data, 0));
    return wrap;
  }

  function treeNode(key, value, depth) {
    const holder = document.createElement('div');
    holder.className = 'tree-node';

    if (value === null || typeof value !== 'object') {
      const row = document.createElement('div');
      row.className = 'tn-leaf';
      const k = document.createElement('span');
      k.className = 'tn-key';
      k.textContent = key;
      row.appendChild(k);
      row.appendChild(primitiveSpan(value));
      holder.appendChild(row);
      return holder;
    }

    const isArr = Array.isArray(value);
    const count = isArr ? value.length : Object.keys(value).length;
    const det = document.createElement('details');
    if (depth < 2) det.open = true;
    const sum = document.createElement('summary');
    sum.innerHTML = `<span class="tn-key">${escapeHtml(key)}</span> <span class="tn-type">${isArr ? '数组' : '对象'} · ${count} ${isArr ? '项' : '键'}</span>`;
    det.appendChild(sum);

    const children = document.createElement('div');
    children.className = 'tn-children';
    if (isArr) {
      value.forEach((item, i) => children.appendChild(treeNode(`[${i}]`, item, depth + 1)));
    } else {
      for (const [k, v] of Object.entries(value)) children.appendChild(treeNode(k, v, depth + 1));
    }
    det.appendChild(children);
    holder.appendChild(det);
    return holder;
  }

  // ---------- JSON 语法高亮 ----------
  function highlightJson(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(\.\d+)?([eE][+-]?\d+)?/g,
      (match) => {
        let cls = 'j-number';
        if (match.startsWith('&quot;') || match.startsWith('"')) {
          cls = /:$/.test(match) ? 'j-key' : 'j-string';
        } else if (/true|false/.test(match)) {
          cls = 'j-bool';
        } else if (/null/.test(match)) {
          cls = 'j-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function formatSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---------- 根目录切换 ----------
  async function loadRootInfo() {
    try {
      const res = await fetch('/api/root');
      const data = await res.json();
      if (document.activeElement !== rootInput) rootInput.value = data.root;
      recentRootsEl.innerHTML = (data.recentRoots || [])
        .map(r => `<option value="${escapeHtml(r)}"></option>`).join('');
    } catch { /* 忽略 */ }
  }

  async function applyRoot(p) {
    const target = (p !== undefined ? p : rootInput.value).trim();
    if (!target) return;
    try {
      const res = await fetch('/api/set-root?p=' + encodeURIComponent(target));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      // 切换成功:清空当前文件,重载树
      currentPath = null;
      collapsed.clear();
      showEmpty();
      loadRootInfo();
      await loadTree(false);
      toast('已切换到:' + data.root);
    } catch (err) {
      toast('切换失败:' + err.message, true);
    }
  }

  let toastTimer = null;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
  }

  // ---------- 目录选择器 ----------
  let pickerPath = ''; // 选择器当前所在目录('' 表示盘符列表)

  async function openPicker(startPath) {
    pickerModal.classList.remove('hidden');
    await navPicker(startPath || '');
  }

  async function navPicker(p) {
    pickerList.innerHTML = '<div class="picker-loading">加载中…</div>';
    try {
      const res = await fetch('/api/browse?p=' + encodeURIComponent(p));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      pickerPath = data.path;
      renderPicker(data);
    } catch (err) {
      pickerList.innerHTML = `<div class="picker-loading">无法访问:${escapeHtml(err.message)}</div>`;
    }
  }

  function renderPicker(data) {
    // 面包屑
    pickerCrumb.innerHTML = '';
    const home = document.createElement('span');
    home.className = 'crumb-item';
    home.textContent = '💻 此电脑';
    home.onclick = () => navPicker('');
    pickerCrumb.appendChild(home);
    if (data.path) {
      const parts = data.path.split(/[\\/]+/).filter(Boolean);
      let acc = parts[0] + '/'; // 盘符
      parts.forEach((part, i) => {
        if (i > 0) acc = acc.replace(/\/?$/, '/') + part;
        const seg = document.createElement('span');
        seg.className = 'crumb-item';
        seg.textContent = part;
        const target = acc;
        seg.onclick = () => navPicker(target);
        pickerCrumb.appendChild(document.createTextNode(' › '));
        pickerCrumb.appendChild(seg);
      });
    }

    // 目录列表
    pickerList.innerHTML = '';
    if (data.parent !== null && data.parent !== undefined) {
      const up = document.createElement('div');
      up.className = 'picker-item';
      up.innerHTML = '<span class="pi-icon">↩</span> ..';
      up.onclick = () => navPicker(data.parent);
      pickerList.appendChild(up);
    }
    if (!data.dirs.length) {
      const empty = document.createElement('div');
      empty.className = 'picker-loading';
      empty.textContent = '(无子目录)';
      pickerList.appendChild(empty);
    }
    for (const d of data.dirs) {
      const item = document.createElement('div');
      item.className = 'picker-item';
      item.innerHTML = `<span class="pi-icon">📁</span> ${escapeHtml(d.name)}`;
      item.onclick = () => navPicker(d.path);
      pickerList.appendChild(item);
    }

    pickerCurrent.textContent = data.path || '(请进入一个目录)';
    pickerSelect.disabled = !data.path;
  }

  browseBtn.addEventListener('click', async () => {
    // Electron 桌面环境优先使用系统目录选择对话框
    if (window.electronAPI && window.electronAPI.selectDirectory) {
      try {
        const dir = await window.electronAPI.selectDirectory();
        if (dir) applyRoot(dir);
      } catch (err) {
        toast('目录选择失败:' + err.message, true);
      }
      return;
    }
    openPicker(rootInput.value.trim());
  });
  pickerClose.addEventListener('click', () => pickerModal.classList.add('hidden'));
  pickerModal.addEventListener('click', (e) => {
    if (e.target === pickerModal) pickerModal.classList.add('hidden');
  });
  pickerSelect.addEventListener('click', () => {
    pickerModal.classList.add('hidden');
    applyRoot(pickerPath);
  });
  applyRootBtn.addEventListener('click', () => applyRoot());
  rootInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyRoot();
  });

  // ---------- SSE 实时更新 ----------
  function connectEvents() {
    const es = new EventSource('/api/events');
    es.onopen = () => {
      liveDot.className = 'dot live';
      liveText.textContent = '实时监听中';
    };
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'root') {
        // 其他客户端切换了根目录
        currentPath = null;
        collapsed.clear();
        showEmpty();
        loadRootInfo();
        loadTree(false);
        return;
      }
      if (msg.type !== 'change') return;
      const changed = msg.file;
      loadTree(true);
      if (currentPath && (changed === currentPath || changed.endsWith(currentPath) || currentPath.endsWith(changed))) {
        openFile(currentPath, true);
      }
    };
    es.onerror = () => {
      liveDot.className = 'dot dead';
      liveText.textContent = '连接断开,重连中…';
      es.close();
      setTimeout(connectEvents, 2000);
    };
  }

  // ---------- 事件绑定 ----------
  filterInput.addEventListener('input', renderTree);
  refreshBtn.addEventListener('click', () => loadTree(true));

  // ---------- 启动 ----------
  initSplitter();
  loadRootInfo();
  loadTree(false);
  connectEvents();
})();
