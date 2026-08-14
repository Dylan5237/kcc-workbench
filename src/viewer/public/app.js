/* MD / JSON 实时预览 - 前端逻辑 */
(function () {
  const treeEl = document.getElementById('fileTree');
  const viewerEl = document.getElementById('viewer');
  const fileHeaderEl = document.getElementById('fileHeader');
  const fileNameEl = document.getElementById('fileName');
  const fileMetaEl = document.getElementById('fileMeta');
  const updatedBadge = document.getElementById('updatedBadge');
  const fileRefreshBtn = document.getElementById('fileRefreshBtn');
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
  const artifactListEl = document.getElementById('artifactList');
  const artifactCountEl = document.getElementById('artifactCount');
  const sidebarTabs = [...document.querySelectorAll('[data-sidebar-mode]')];
  const timeMachineListEl = document.getElementById('timeMachineList');
  const checkpointCountEl = document.getElementById('checkpointCount');
  const forkModal = document.getElementById('forkModal');
  const forkForm = document.getElementById('forkForm');
  const forkBranch = document.getElementById('forkBranch');
  const forkTarget = document.getElementById('forkTarget');
  const forkError = document.getElementById('forkError');
  const forkSubmit = document.getElementById('forkSubmit');
  const forkClose = document.getElementById('forkClose');
  const forkCancel = document.getElementById('forkCancel');

  let treeData = null;
  let currentPath = null; // 当前打开的文件相对路径
  let currentRoot = ''; // 当前监听根目录(绝对路径)
  let viewerMode = normalizeViewerMode(localStorage.getItem('kcc-viewer-mode')); // auto | dev | run
  let activeTypeFacet = 'all'; // 运行模式类型 facets
  let activeDirFacet = 'all'; // 运行模式目录 facets
  let mermaidSequence = 0;
  let artifactSession = null;
  let timeMachineState = null;
  let pendingForkCheckpoint = null;
  let currentFileVersion = null;
  let freshnessCheckInFlight = false;
  let fileStatusTimer = null;
  const expanded = new Set(); // 用户手动展开的目录
  const collapsed = new Set(); // 用户手动折叠的目录

  marked.setOptions({ breaks: true, gfm: true });
  if (window.mermaid) {
    window.__layoutReady = import('/vendor/layout-elk.mjs')
      .then(module => {
        window.mermaid.registerLayoutLoaders(module.default || []);
      })
      .catch(error => {
        console.warn('ELK layout engine failed to load:', error);
      });
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      suppressErrorRendering: true,
      useMaxWidth: false,
      layout: 'elk',
    });
  } else {
    window.__layoutReady = Promise.resolve();
  }

  // ---------- 文件树 ----------
  async function loadTree(keepSelection) {
    const res = await fetch('/api/tree' + (viewerMode === 'dev' ? '?mode=dev' : ''));
    const data = await res.json();
    treeData = data.tree;
    currentRoot = data.root;
    if (document.activeElement !== rootInput) rootInput.value = data.root;
    renderTree();
    renderFacets();
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


  function renderFacets() {
    const facetsEl = document.getElementById('facets');
    if (viewerMode === 'dev' || !treeData) {
      facetsEl.classList.add('hidden');
      facetsEl.innerHTML = '';
      return;
    }
    const types = collectFacetTypes(treeData);
    const dirs = collectFacetDirs(treeData);
    if (!types.length && !dirs.length) {
      facetsEl.classList.add('hidden');
      facetsEl.innerHTML = '';
      return;
    }
    facetsEl.classList.remove('hidden');
    const chipsFor = (values, active, label) => {
      const allChip = `<span class="facet-chip ${active === 'all' ? 'active' : ''}" data-value="all">全部</span>`;
      const items = values.map(item => {
        const activeCls = active === item.value ? ' active' : '';
        return `<span class="facet-chip${activeCls}" data-value="${escapeHtml(item.value)}">${escapeHtml(item.label)}<span class="count">${item.count}</span></span>`;
      }).join('');
      return `<div class="facet-row"><span class="facet-label">${label}</span><div class="facet-chips">${allChip}${items}</div></div>`;
    };
    facetsEl.innerHTML = chipsFor(types, activeTypeFacet, '类型') + chipsFor(dirs, activeDirFacet, '目录');
    facetsEl.querySelectorAll('.facet-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.value;
        const row = chip.closest('.facet-row');
        const isType = row.querySelector('.facet-label').textContent === '类型';
        if (isType) activeTypeFacet = value; else activeDirFacet = value;
        renderFacets();
        renderTree();
      });
    });
  }

  function collectFacetTypes(tree) {
    const counts = {};
    const walk = node => {
      if (node.type === 'file') {
        const t = facetTypeOf(node);
        if (t) counts[t] = (counts[t] || 0) + 1;
      }
      (node.children || []).forEach(walk);
    };
    walk(tree);
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: facetTypeLabel(value), count }));
  }

  function collectFacetDirs(tree) {
    const counts = {};
    (tree.children || []).forEach(child => {
      if (child.type === 'dir') counts[child.name] = (counts[child.name] || 0) + countFiles(child);
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, count }));
  }

  function countFiles(node) {
    if (node.type === 'file') return 1;
    return (node.children || []).reduce((sum, child) => sum + countFiles(child), 0);
  }

  function facetTypeOf(node) {
    if (node.ext === '.md') return 'md';
    if (node.ext === '.html' || node.ext === '.htm') return 'html';
    if (node.ext === '.mmd' || node.ext === '.mermaid') return 'mmd';
    if (node.ext === '.json') return 'json';
    return null;
  }

  function facetTypeLabel(value) {
    return { md: 'md', html: 'html', mmd: 'mermaid', json: 'json' }[value] || value;
  }

  function dirMatchesFacet(node, facet) {
    if (node.type !== 'dir') return false;
    return node.name === facet;
  }


  function renderTree() {
    const filter = filterInput.value.trim().toLowerCase();
    treeEl.innerHTML = '';
    if (!currentRoot) {
      treeEl.innerHTML = '<div class="tree-empty"><strong>尚未选择项目</strong><span>请选择一个包含 Markdown、JSON 或 HTML 的文件夹</span></div>';
      return;
    }
    if (!treeData || !treeData.children || !treeData.children.length) {
      treeEl.innerHTML = '<div class="tree-empty">目录下没有 .md / .json / .html 文件</div>';
      return;
    }
    const ul = document.createElement('ul');
    let anyVisible = false;
    for (const child of treeData.children) {
      if (activeDirFacet !== 'all' && !dirMatchesFacet(child, activeDirFacet)) continue;
      const li = buildNode(child, filter, 0);
      if (li) { ul.appendChild(li); anyVisible = true; }
    }
    treeEl.appendChild(ul);
    if (!anyVisible) treeEl.innerHTML = '<div class="tree-empty">无匹配文件</div>';
  }

  async function loadArtifacts() {
    const response = await fetch('/api/artifacts');
    artifactSession = await response.json();
    renderArtifacts();
  }

  function renderArtifacts() {
    const artifacts = artifactSession?.changes || [];
    artifactCountEl.textContent = String(artifacts.length);
    if (!artifacts.length) {
      artifactListEl.innerHTML = `
        <div class="artifact-empty">
          <strong>等待本轮产物</strong>
          <span>${escapeHtml(artifactSession?.label || '当前工作区')}</span>
          <small>进入 Viewer 后产生的 MD、JSON、HTML 变更会出现在这里</small>
        </div>`;
      return;
    }
    artifactListEl.innerHTML = `
      <div class="artifact-session">
        <span>${escapeHtml(artifactSession.label || '当前工作区')}</span>
        <small>${new Date(artifactSession.startedAt).toLocaleTimeString('zh-CN')} 起</small>
      </div>
      ${artifacts.map(artifact => `
        <button class="artifact-item" data-artifact-id="${artifact.id}">
          <span class="artifact-type ${artifact.type}">${artifactTypeLabel(artifact.type)}</span>
          <span class="artifact-main">
            <strong title="${escapeHtml(artifact.path)}">${escapeHtml(artifact.name)}</strong>
            <small>${escapeHtml(artifact.path)} · ${new Date(artifact.timestamp).toLocaleTimeString('zh-CN')}</small>
          </span>
          <span class="artifact-stats"><b>+${artifact.stats.added}</b><i>−${artifact.stats.removed}</i></span>
        </button>`).join('')}`;
    artifactListEl.querySelectorAll('.artifact-item').forEach(button => {
      button.onclick = () => showArtifactDiff(
        artifacts.find(artifact => artifact.id === button.dataset.artifactId)
      );
    });
  }

  function artifactTypeLabel(type) {
    return type === 'created' ? '新增' : (type === 'deleted' ? '删除' : '修改');
  }

  function showArtifactDiff(artifact) {
    if (!artifact) return;
    clearLiveFileState();
    currentPath = artifact.type === 'deleted' ? null : artifact.path;
    renderTree();
    fileHeaderEl.classList.remove('hidden');
    fileNameEl.textContent = artifact.path;
    fileMetaEl.textContent = `${artifactTypeLabel(artifact.type)} · ${new Date(artifact.timestamp).toLocaleTimeString('zh-CN')}`;
    const absolutePath = absPathOf(artifact);
    viewerEl.innerHTML = `
      <div class="artifact-detail-head">
        <div><strong>本次变更</strong><span>+${artifact.stats.added} / −${artifact.stats.removed}</span></div>
        <div class="artifact-actions">
          ${artifact.type === 'deleted' ? '' : '<button data-action="open">打开预览</button><button data-action="copy-file">复制文件</button>'}
          <button data-action="copy-path">复制路径</button>
        </div>
      </div>
      <div class="diff-view">${artifact.diff.map((line, index) => `
        <div class="diff-line ${line.type}">
          <span class="diff-number">${index + 1}</span>
          <span class="diff-mark">${line.type === 'add' ? '+' : (line.type === 'remove' ? '−' : ' ')}</span>
          <code>${escapeHtml(line.text) || ' '}</code>
        </div>`).join('')}</div>`;
    viewerEl.querySelector('[data-action="open"]')?.addEventListener('click', () => openFile(artifact.path));
    viewerEl.querySelector('[data-action="copy-file"]')?.addEventListener('click', async () => {
      try {
        await window.electronAPI.copyFiles([absolutePath]);
        toast('已复制文件');
      } catch (error) {
        toast(`复制失败: ${error.message}`, true);
      }
    });
    viewerEl.querySelector('[data-action="copy-path"]').addEventListener('click', async () => {
      await navigator.clipboard.writeText(absolutePath);
      toast('已复制文件路径');
    });
  }

  async function loadTimeMachine() {
    const response = await fetch('/api/time-machine');
    timeMachineState = await response.json();
    renderTimeMachine();
  }

  function renderTimeMachine() {
    const checkpoints = timeMachineState?.checkpoints || [];
    checkpointCountEl.textContent = String(checkpoints.length);
    if (!checkpoints.length) {
      timeMachineListEl.innerHTML = `
        <div class="artifact-empty">
          <strong>尚无可回放时间点</strong>
          <span>${escapeHtml(timeMachineState?.session?.label || '当前工作区')}</span>
          <small>修改产物后，系统会自动合并短时间内的连续变化并保存检查点。</small>
        </div>`;
      return;
    }
    timeMachineListEl.innerHTML = `
      <div class="time-machine-intro">
        <strong>${escapeHtml(timeMachineState.session?.label || '当前任务')}</strong>
        <span>可回放 · 可比较 · 隔离分叉</span>
      </div>
      <div class="timeline">
        ${checkpoints.map((checkpoint, index) => `
          <button class="checkpoint-item" data-checkpoint-id="${checkpoint.id}">
            <span class="timeline-rail"><i></i>${index === checkpoints.length - 1 ? '' : '<b></b>'}</span>
            <span class="checkpoint-main">
              <strong>${escapeHtml(checkpoint.title)}</strong>
              <small>${new Date(checkpoint.timestamp).toLocaleString('zh-CN')} · ${checkpoint.changeCount} 个文件</small>
              <span class="checkpoint-files">${checkpoint.files.slice(0, 3).map(file =>
                `<em>${escapeHtml(file.name)}</em>`).join('')}${checkpoint.files.length > 3 ? `<em>+${checkpoint.files.length - 3}</em>` : ''}</span>
            </span>
            <span class="git-state ${checkpoint.git.available ? 'ready' : ''}" title="${escapeHtml(checkpoint.git.error || '')}">
              ${checkpoint.git.available ? 'Git' : '本地'}
            </span>
          </button>`).join('')}
      </div>`;
    timeMachineListEl.querySelectorAll('.checkpoint-item').forEach(button => {
      button.onclick = () => openCheckpoint(button.dataset.checkpointId);
    });
  }

  async function openCheckpoint(checkpointId) {
    const response = await fetch(`/api/time-machine/checkpoint?id=${encodeURIComponent(checkpointId)}`);
    const checkpoint = await response.json();
    if (!response.ok) {
      toast(checkpoint.error || '无法读取时间点', true);
      return;
    }
    clearLiveFileState();
    currentPath = null;
    renderTree();
    fileHeaderEl.classList.remove('hidden');
    fileNameEl.textContent = checkpoint.title;
    fileMetaEl.textContent = `${new Date(checkpoint.timestamp).toLocaleString('zh-CN')} · ${checkpoint.changes.length} 个文件`;
    renderCheckpoint(checkpoint, 0, 'diff');
  }

  function renderCheckpoint(checkpoint, selectedIndex, mode) {
    const change = checkpoint.changes[selectedIndex];
    const gitLabel = checkpoint.git?.available
      ? `${checkpoint.git.branch} · ${String(checkpoint.git.head).slice(0, 8)}`
      : '非 Git 快照';
    viewerEl.innerHTML = `
      <div class="checkpoint-detail">
        <div class="checkpoint-toolbar">
          <div>
            <strong>${escapeHtml(checkpoint.title)}</strong>
            <span>${escapeHtml(gitLabel)}</span>
          </div>
          ${checkpoint.git?.available ? '<button data-action="fork">从这里继续</button>' : '<span class="fork-disabled">当前项目无法创建 Git 分叉</span>'}
        </div>
        <div class="checkpoint-file-tabs">
          ${checkpoint.changes.map((item, index) => `
            <button data-change-index="${index}" class="${index === selectedIndex ? 'active' : ''}">
              <span class="artifact-type ${item.type}">${artifactTypeLabel(item.type)}</span>
              ${escapeHtml(item.path)}
            </button>`).join('')}
        </div>
        <div class="snapshot-modes">
          <button data-snapshot-mode="diff" class="${mode === 'diff' ? 'active' : ''}">变更对比</button>
          <button data-snapshot-mode="snapshot" class="${mode === 'snapshot' ? 'active' : ''}">此时内容</button>
        </div>
        <div id="checkpointBody"></div>
      </div>`;
    viewerEl.querySelector('[data-action="fork"]')?.addEventListener('click', () => openForkModal(checkpoint));
    viewerEl.querySelectorAll('[data-change-index]').forEach(button => {
      button.onclick = () => renderCheckpoint(checkpoint, Number(button.dataset.changeIndex), mode);
    });
    viewerEl.querySelectorAll('[data-snapshot-mode]').forEach(button => {
      button.onclick = () => renderCheckpoint(checkpoint, selectedIndex, button.dataset.snapshotMode);
    });
    if (mode === 'snapshot') renderCheckpointSnapshot(change);
    else renderCheckpointDiff(change);
  }

  function renderCheckpointDiff(change) {
    const body = document.getElementById('checkpointBody');
    body.innerHTML = `
      <div class="diff-summary">
        <span>${escapeHtml(change.path)}</span>
        <b>+${change.stats.added}</b><i>−${change.stats.removed}</i>
      </div>
      <div class="diff-view">${change.diff.map((line, index) => `
        <div class="diff-line ${line.type}">
          <span class="diff-number">${index + 1}</span>
          <span class="diff-mark">${line.type === 'add' ? '+' : (line.type === 'remove' ? '−' : ' ')}</span>
          <code>${escapeHtml(line.text) || ' '}</code>
        </div>`).join('')}</div>`;
  }

  async function renderCheckpointSnapshot(change) {
    const body = document.getElementById('checkpointBody');
    const content = change.afterContent || change.beforeContent || '';
    if (change.type === 'deleted') {
      body.insertAdjacentHTML('beforeend', '<div class="snapshot-note">该文件在此时间点被删除，以下显示删除前内容。</div>');
    }
    if (change.ext === '.md') {
      const markdownBody = document.createElement('div');
      markdownBody.className = 'markdown-body snapshot-document';
      markdownBody.innerHTML = sanitizeMarkdown(marked.parse(content));
      body.appendChild(markdownBody);
      await renderMermaidBlocks(markdownBody);
      return;
    }
    if (change.ext === '.mmd' || change.ext === '.mermaid') {
      const snapshotContainer = document.createElement('div');
      snapshotContainer.className = 'snapshot-document';
      body.appendChild(snapshotContainer);
      renderMermaidFile(content, snapshotContainer);
      return;
    }
    if (change.ext === '.json') {
      try {
        body.innerHTML += `<div class="json-view snapshot-document">${highlightJson(JSON.stringify(JSON.parse(content), null, 2))}</div>`;
      } catch {
        body.innerHTML += `<div class="json-view snapshot-document">${escapeHtml(content)}</div>`;
      }
      return;
    }
    const frame = document.createElement('iframe');
    frame.className = 'html-preview snapshot-document';
    frame.title = `${change.name} 历史快照`;
    frame.setAttribute('sandbox', '');
    const directory = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/') + 1) : '';
    const safeSource = content.replace(/<base\b[^>]*>/gi, '');
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' http://127.0.0.1:*; img-src http://127.0.0.1:* data:; font-src http://127.0.0.1:*; script-src 'none'; form-action 'none'"><base href="/api/html-asset/${directory.split('/').filter(Boolean).map(encodeURIComponent).join('/')}${directory ? '/' : ''}">${safeSource}`;
    body.appendChild(frame);
  }

  function openForkModal(checkpoint) {
    pendingForkCheckpoint = checkpoint;
    const stamp = new Date(checkpoint.timestamp);
    const pad = value => String(value).padStart(2, '0');
    forkBranch.value = `kimi-time/${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
    forkTarget.value = '';
    forkError.classList.add('hidden');
    forkError.textContent = '';
    forkModal.classList.remove('hidden');
    setTimeout(() => forkBranch.focus(), 0);
  }

  function closeForkModal() {
    pendingForkCheckpoint = null;
    forkModal.classList.add('hidden');
  }

  async function submitFork(event) {
    event.preventDefault();
    if (!pendingForkCheckpoint) return;
    forkSubmit.disabled = true;
    forkSubmit.textContent = '创建中…';
    forkError.classList.add('hidden');
    try {
      if (!window.electronAPI?.forkCheckpoint) {
        throw new Error('浏览器只读模式不支持创建隔离分支');
      }
      const result = await window.electronAPI.forkCheckpoint({
          checkpointId: pendingForkCheckpoint.id,
          branchName: forkBranch.value.trim(),
          targetPath: forkTarget.value.trim()
      });
      closeForkModal();
      toast(`已创建 ${result.branch}：${result.target}`);
    } catch (error) {
      forkError.textContent = error.message;
      forkError.classList.remove('hidden');
    } finally {
      forkSubmit.disabled = false;
      forkSubmit.textContent = '创建并恢复';
    }
  }

  function buildNode(node, filter, depth) {
    // 类型 facet:只对文件节点生效
    if (activeTypeFacet !== 'all' && node.type === 'file' && facetTypeOf(node) !== activeTypeFacet) return null;
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
      const isExpanded = window.ViewerTreeState.isExpanded({
        depth,
        path: node.path,
        filter,
        expanded,
        collapsed
      });
      row.innerHTML = `<span class="arrow ${isExpanded ? 'open' : ''}">▶</span><span class="icon">📁</span><span class="tree-name">${escapeHtml(node.name)}</span>`;
      row.onclick = () => {
        window.ViewerTreeState.toggle({
          depth,
          path: node.path,
          expanded,
          collapsed
        });
        renderTree();
      };
      li.appendChild(row);
      if (isExpanded) {
        const ul = document.createElement('ul');
        for (const c of node.children) {
          const childLi = buildNode(c, filter, depth + 1);
          if (childLi) ul.appendChild(childLi);
        }
        li.appendChild(ul);
      }
    } else {
      const ext = node.ext.slice(1);
      const icon = fileIconOf(node);
      row.innerHTML = `<span class="arrow"></span><span class="icon">${icon}</span><span class="tree-name">${escapeHtml(node.name)}</span><span class="ext-tag ${ext}">${ext}</span><time class="file-time" datetime="${new Date(node.mtime).toISOString()}">${window.ViewerTreeState.formatTimestamp(node.mtime)}</time>`;
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
    // 补充根节点使用绝对路径作为 path, 直接返回
    if (node.path && pathIsAbsoluteLike(node.path)) {
      return node.path.replace(/\//g, '\\');
    }
    const joined = (currentRoot.replace(/[\\/]+$/, '') + '/' + node.path);
    return joined.replace(/\//g, '\\');
  }

  function pathIsAbsoluteLike(value) {
    return typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value);
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
    items.push({
      label: '🗑️ 放入回收站',
      onClick: async () => {
        try {
          await window.electronAPI.trashItem([absPath]);
          toast('已放入回收站');
        } catch (err) {
          toast('删除失败:' + err.message, true);
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
  async function openFile(p, silent, refreshSource) {
    const refreshingCurrentFile = currentFileVersion?.path === p;
    const node = treeData ? findNode(treeData, p) : null;
    if (node?.kind === 'image') return renderImage(p, node);
    if (node?.kind === 'binary') return renderBinary(p, node);
    try {
      const res = await fetch('/api/file?p=' + encodeURIComponent(p));
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const file = await res.json();
      currentPath = p;
      renderTree(); // 更新高亮
      await renderFile(file, silent, refreshSource);
    } catch (err) {
      if (refreshingCurrentFile) {
        showFileStatus(`刷新失败：${err.message}`, 'error');
        fileRefreshBtn.classList.add('needs-refresh');
        return;
      }
      clearLiveFileState();
      fileHeaderEl.classList.add('hidden');
      viewerEl.innerHTML = `<div class="empty-hint"><p>读取失败:${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderFile(file, silent, refreshSource) {
    fileHeaderEl.classList.remove('hidden');
    fileNameEl.textContent = file.path;
    fileMetaEl.textContent = `${formatSize(file.size)} · 更新于 ${window.ViewerTreeState.formatTimestamp(file.mtime)}`;

    const keepScroll = silent ? viewerEl.scrollTop : 0;

    if (file.ext === '.mmd' || file.ext === '.mermaid') {
      renderMermaidFile(file.content);
    } else if (file.ext === '.md') {
      const markdownBody = document.createElement('div');
      markdownBody.className = 'markdown-body';
      markdownBody.innerHTML = sanitizeMarkdown(marked.parse(file.content));
      viewerEl.replaceChildren(markdownBody);
      await renderMermaidBlocks(markdownBody);
    } else if (file.ext === '.json') {
      renderJson(file);
    } else if (file.kind === 'code') {
      renderCode(file);
    } else {
      renderHtml(file);
    }

    if (silent) viewerEl.scrollTop = keepScroll;

    currentFileVersion = {
      path: file.path,
      mtime: file.mtime,
      size: file.size
    };
    fileRefreshBtn.classList.remove('hidden', 'needs-refresh');

    if (silent) {
      showFileStatus(refreshSource === 'manual' ? '已手动刷新' : '已自动刷新', 'updated', true);
    } else {
      clearFileStatus();
    }
  }

  function showEmpty() {
    clearLiveFileState();
    fileHeaderEl.classList.add('hidden');
    viewerEl.innerHTML = `<div class="empty-hint"><p>← 从左侧选择一个 <code>.md</code>、<code>.json</code>、<code>.html</code> 或 <code>.mmd</code> 文件</p><p class="sub">文件修改后会自动刷新</p></div>`;
  }

  function showFileStatus(message, variant, autoHide) {
    clearTimeout(fileStatusTimer);
    updatedBadge.textContent = message;
    updatedBadge.className = `badge ${variant || 'updated'}`;
    if (autoHide) {
      fileStatusTimer = setTimeout(() => updatedBadge.classList.add('hidden'), 2200);
    }
  }

  function clearFileStatus() {
    clearTimeout(fileStatusTimer);
    updatedBadge.className = 'badge hidden';
    updatedBadge.textContent = '';
  }

  function clearLiveFileState() {
    currentFileVersion = null;
    fileRefreshBtn.classList.add('hidden');
    fileRefreshBtn.classList.remove('needs-refresh');
    clearFileStatus();
  }

  function markCurrentFileStale(message = '文件已更新，请手动刷新') {
    if (!currentFileVersion) return;
    fileRefreshBtn.classList.remove('hidden');
    fileRefreshBtn.classList.add('needs-refresh');
    showFileStatus(message, 'stale');
  }

  async function checkCurrentFileFreshness() {
    const checkedVersion = currentFileVersion;
    if (!checkedVersion || currentPath !== checkedVersion.path || freshnessCheckInFlight) return;
    freshnessCheckInFlight = true;
    try {
      const response = await fetch(
        '/api/file-meta?p=' + encodeURIComponent(checkedVersion.path),
        { cache: 'no-store' }
      );
      if (currentFileVersion !== checkedVersion) return;
      if (!response.ok) {
        markCurrentFileStale('文件已删除或无法读取');
        return;
      }
      const metadata = await response.json();
      if (window.ViewerTreeState.isFileVersionChanged(checkedVersion, metadata)) {
        markCurrentFileStale();
      }
    } catch {
      // SSE 状态会显示连接问题；元数据轮询失败时保留当前内容。
    } finally {
      freshnessCheckInFlight = false;
    }
  }

  const htmlModeByPath = new Map();


  function renderCode(file) {
    const lang = codeLanguageOf(file.ext);
    const highlighted = window.hljs
      ? window.hljs.highlight(file.content, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(file.content);
    viewerEl.innerHTML = [
      '<div class="code-viewer"><pre><code class="hljs">',
      highlighted,
      '</code></pre></div>'
    ].join('');
  }

  function renderImage(p, node) {
    clearLiveFileState();
    currentPath = p;
    renderTree();
    fileHeaderEl.classList.remove('hidden');
    fileNameEl.textContent = p;
    fileMetaEl.textContent = `${formatSize(node.size)} · 更新于 ${window.ViewerTreeState.formatTimestamp(node.mtime)}`;
    viewerEl.innerHTML = [
      '<div class="image-viewer"><img src="/api/raw-file?p=',
      encodeURIComponent(p),
      '" alt="',
      escapeHtml(node.name),
      '"></div>'
    ].join('');
    currentFileVersion = { path: p, mtime: node.mtime, size: node.size };
    fileRefreshBtn.classList.remove('hidden', 'needs-refresh');
  }

  function renderBinary(p, node) {
    clearLiveFileState();
    currentPath = p;
    renderTree();
    fileHeaderEl.classList.remove('hidden');
    fileNameEl.textContent = p;
    fileMetaEl.textContent = `${formatSize(node.size)} · 二进制文件`;
    viewerEl.innerHTML = [
      '<div class="binary-hint">',
      '<span class="icon">📦</span>',
      '<span class="name">', escapeHtml(node.name), '</span>',
      '<span class="meta">二进制文件 · ', formatSize(node.size), ' · 无法预览</span>',
      '</div>'
    ].join('');
    currentFileVersion = { path: p, mtime: node.mtime, size: node.size };
    fileRefreshBtn.classList.remove('hidden', 'needs-refresh');
  }

  function fileIconOf(node) {
    if (node.kind === 'code') return '⌨️';
    if (node.kind === 'image') return '🖼️';
    if (node.kind === 'binary') return '📦';
    if (node.ext === '.md') return '📝';
    if (node.ext === '.json') return '🧩';
    if (node.ext === '.mmd' || node.ext === '.mermaid') return '🔀';
    return '🌐';
  }
  function codeLanguageOf(ext) {
    const map = {
      '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
      '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.css': 'css',
      '.scss': 'scss', '.less': 'less', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
      '.ps1': 'powershell', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'ini',
      '.xml': 'xml', '.sql': 'sql', '.java': 'java', '.go': 'go', '.rs': 'rust',
      '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.rb': 'ruby',
      '.php': 'php', '.vue': 'xml', '.json': 'json', '.md': 'markdown',
      '.ini': 'ini', '.conf': 'ini', '.env': 'bash', '.txt': 'plaintext', '.log': 'plaintext'
    };
    return map[ext] || 'plaintext';
  }
  function renderHtml(file) {
    const mode = htmlModeByPath.get(file.path) || 'preview';
    viewerEl.innerHTML = `
      <div class="html-toolbar">
        <div class="html-tabs">
          <button data-mode="preview" class="${mode === 'preview' ? 'active' : ''}">安全预览</button>
          <button data-mode="source" class="${mode === 'source' ? 'active' : ''}">源文件</button>
        </div>
        <span class="html-security">脚本、表单与外部网络已禁用</span>
      </div>
      <div id="htmlBody" class="html-body"></div>`;
    viewerEl.querySelectorAll('.html-tabs button').forEach(button => {
      button.onclick = () => {
        htmlModeByPath.set(file.path, button.dataset.mode);
        renderHtml(file);
      };
    });
    const body = document.getElementById('htmlBody');
    if (mode === 'source') {
      body.innerHTML = `<pre class="html-source"><code>${escapeHtml(file.content)}</code></pre>`;
      return;
    }
    const frame = document.createElement('iframe');
    frame.className = 'html-preview';
    frame.title = `${file.name} 安全预览`;
    frame.setAttribute('sandbox', '');
    frame.referrerPolicy = 'no-referrer';
    frame.src = `/api/html-preview?p=${encodeURIComponent(file.path)}&v=${encodeURIComponent(file.mtime)}`;
    body.appendChild(frame);
  }

  function sanitizeMarkdown(html) {
    if (!window.DOMPurify) return escapeHtml(String(html));
    return window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['form', 'input', 'button', 'meta', 'link', 'style'],
      FORBID_ATTR: ['style', 'srcdoc', 'formaction'],
      ALLOW_DATA_ATTR: false
    });
  }

  async function renderMermaidBlocks(container) {
    const blocks = [...container.querySelectorAll(
      'pre > code.language-mermaid, pre > code.lang-mermaid'
    )];
    if (!blocks.length) return;
    if (!window.mermaid) {
      for (const code of blocks) showMermaidError(code, 'Mermaid 渲染器未加载');
      return;
    }

    for (const code of blocks) {
      const source = code.textContent;
      const host = document.createElement('div');
      host.className = 'mermaid-diagram';
      if (window.electronAPI?.copyPng) {
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'mermaid-copy-btn mermaid-copy-float';
        copyButton.textContent = '复制图片';
        copyButton.onclick = () => copyMermaidToClipboard(host);
        host.appendChild(copyButton);
      }
      code.parentElement.replaceWith(host);
      try {
        await window.__layoutReady;
        const id = `mermaid-diagram-${Date.now()}-${mermaidSequence += 1}`;
        const { svg, bindFunctions } = await window.mermaid.render(id, source);
        host.innerHTML = sanitizeMermaidSvg(svg);
        sizeMermaidSvg(host);
        bindFunctions?.(host);
      } catch (error) {
        host.classList.add('mermaid-error');
        host.innerHTML = `
          <strong>Mermaid 图表解析失败</strong>
          <span>${escapeHtml(error?.message || String(error))}</span>
          <pre><code>${escapeHtml(source)}</code></pre>`;
      }
    }
  }

  async function renderMermaidFile(source, target) {
    const container = target || viewerEl;
    if (!target) {
      const pathKey = currentPath || '';
      const mode = mermaidModeByPath.get(pathKey) || 'diagram';
      container.replaceChildren();
      const toolbar = document.createElement('div');
      toolbar.className = 'html-toolbar mermaid-toolbar';
      toolbar.innerHTML = `
        <div class="html-tabs">
          <button data-mode="diagram" class="${mode === 'diagram' ? 'active' : ''}">图</button>
          <button data-mode="source" class="${mode === 'source' ? 'active' : ''}">源文件</button>
        </div>
        ${window.electronAPI?.copyPng ? '<button type="button" class="mermaid-copy-btn" title="复制流程图到剪贴板">复制图片</button>' : ''}`;
      toolbar.querySelectorAll('.html-tabs button').forEach(button => {
        button.onclick = () => {
          mermaidModeByPath.set(pathKey, button.dataset.mode);
          renderMermaidFile(source);
        };
      });
      toolbar.querySelector('.mermaid-copy-btn')?.addEventListener('click', () => {
        const host = container.querySelector('.mermaid-diagram');
        if (host) copyMermaidToClipboard(host);
      });
      container.appendChild(toolbar);
      if (mode === 'source') {
        const pre = document.createElement('pre');
        pre.className = 'mermaid-source';
        pre.textContent = source;
        container.appendChild(pre);
        return;
      }
    }
    const host = document.createElement('div');
    host.className = 'mermaid-diagram';
    if (target) container.replaceChildren(host);
    else container.appendChild(host);
    if (!window.mermaid) {
      host.classList.add('mermaid-error');
      host.innerHTML = '<strong>Mermaid 渲染器未加载</strong>';
      return;
    }
    try {
      await window.__layoutReady;
      const { svg, bindFunctions } = await window.mermaid.render(
        `mermaid-file-${Date.now()}-${mermaidSequence += 1}`,
        source
      );
      host.innerHTML = sanitizeMermaidSvg(svg);
      sizeMermaidSvg(host);
      bindFunctions?.(host);
    } catch (error) {
      host.classList.add('mermaid-error');
      host.innerHTML = `
        <strong>Mermaid 图表解析失败</strong>
        <span>${escapeHtml(error?.message || String(error))}</span>
        <pre><code>${escapeHtml(source)}</code></pre>`;
    }
  }

  const mermaidModeByPath = new Map();

  async function copyMermaidToClipboard(diagramElement) {
    const svg = diagramElement.querySelector('svg');
    if (!svg || !window.electronAPI?.copyPng) return;
    const viewBox = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const naturalWidth = viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : svg.getBoundingClientRect().width;
    const naturalHeight = viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : svg.getBoundingClientRect().height;
    const scale = Math.max(1, Math.min(3, 4096 / Math.max(naturalWidth, naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const image = new Image();
    image.decoding = 'async';
    const source = new XMLSerializer().serializeToString(svg);
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
    await image.decode();
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法生成 PNG');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await window.electronAPI.copyPng(bytes);
    toast('流程图已复制到剪贴板');
  }

  function sizeMermaidSvg(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;
    const viewBox = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (viewBox.length !== 4 || !viewBox[2] || !viewBox[3]) return;
    svg.setAttribute('width', String(viewBox[2]));
    svg.setAttribute('height', String(viewBox[3]));
    svg.style.maxWidth = 'none';
  }

  function showMermaidError(code, message) {
    const host = document.createElement('div');
    host.className = 'mermaid-diagram mermaid-error';
    host.innerHTML = `
      <strong>${escapeHtml(message)}</strong>
      <pre><code>${escapeHtml(code.textContent)}</code></pre>`;
    code.parentElement.replaceWith(host);
  }

  function sanitizeMermaidSvg(svg) {
    if (!window.DOMPurify) return '';
    const foreignContents = [];
    const protectedSvg = svg.replace(
      /<foreignObject[\s\S]*?<\/foreignObject>/gi,
      (match) => {
        const openingTag = match.match(/<foreignObject[^>]*>/i)?.[0] || '<foreignObject>';
        const inner = match
          .replace(openingTag, '')
          .replace(/<\/foreignObject>$/i, '');
        foreignContents.push(window.DOMPurify.sanitize(inner, {
          USE_PROFILES: { html: true },
          FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta'],
          FORBID_ATTR: ['srcdoc', 'formaction'],
          ALLOW_DATA_ATTR: false
        }));
        const preserved = openingTag.replace(
          /<foreignObject/i,
          `<foreignObject data-foreign-index="${foreignContents.length - 1}"`
        );
        return `${preserved}</foreignObject>`;
      }
    );
    const sanitizedSvg = window.DOMPurify.sanitize(protectedSvg, {
      ADD_TAGS: ['foreignObject'],
      ADD_ATTR: ['xlink:href', 'data-foreign-index', 'width', 'height'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      ALLOW_DATA_ATTR: true
    });
    const container = document.createElement('div');
    container.innerHTML = sanitizedSvg;
    for (const node of container.querySelectorAll('foreignObject[data-foreign-index]')) {
      const index = Number(node.getAttribute('data-foreign-index'));
      node.innerHTML = foreignContents[index] || '';
      node.removeAttribute('data-foreign-index');
    }
    return container.innerHTML;
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
      if (!window.electronAPI?.setRoot) {
        throw new Error('浏览器只读模式不支持切换项目目录');
      }
      const data = await window.electronAPI.setRoot(target);
      // 切换成功:清空当前文件,重载树
      currentPath = null;
      expanded.clear();
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
    toast('浏览器只读模式不支持选择项目目录', true);
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
        expanded.clear();
        collapsed.clear();
        showEmpty();
        loadRootInfo();
        loadTree(false);
        loadArtifacts();
        return;
      }
      if (msg.type === 'artifact-session') {
        artifactSession = msg.session;
        renderArtifacts();
        return;
      }
      if (msg.type === 'artifact') {
        artifactSession = msg.session;
        renderArtifacts();
        return;
      }
      if (msg.type === 'time-machine-session' || msg.type === 'time-machine-checkpoint') {
        timeMachineState = msg.state;
        renderTimeMachine();
        return;
      }
      if (msg.type !== 'change') return;
      const changed = msg.file;
      loadTree(true);
      if (currentPath && (changed === currentPath || changed.endsWith(currentPath) || currentPath.endsWith(changed))) {
        showFileStatus('检测到更新，正在刷新…', 'refreshing');
        openFile(currentPath, true, 'auto');
      } else if (msg.kind === 'asset' && currentPath && /\.html?$/i.test(currentPath)) {
        showFileStatus('预览资源已更新，正在刷新…', 'refreshing');
        openFile(currentPath, true, 'auto');
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

  function normalizeViewerMode(value) {
    return value === 'dev' || value === 'run' || value === 'auto' ? value : 'auto';
  }

  function applyMode(nextMode) {
    viewerMode = normalizeViewerMode(nextMode);
    localStorage.setItem('kcc-viewer-mode', nextMode);
    document.querySelectorAll('#modeSwitch button').forEach(button => {
      button.classList.toggle('active', button.dataset.mode === nextMode);
    });
    loadTree(true);
  }

  document.querySelectorAll('#modeSwitch button').forEach(button => {
    button.addEventListener('click', () => applyMode(button.dataset.mode));
  });
  filterInput.addEventListener('input', renderTree);
  refreshBtn.addEventListener('click', () => loadTree(true));
  fileRefreshBtn.addEventListener('click', async () => {
    if (!currentFileVersion || currentPath !== currentFileVersion.path) return;
    fileRefreshBtn.disabled = true;
    fileRefreshBtn.classList.remove('needs-refresh');
    showFileStatus('正在重新读取…', 'refreshing');
    try {
      await Promise.all([
        loadTree(true),
        openFile(currentPath, true, 'manual')
      ]);
    } finally {
      fileRefreshBtn.disabled = false;
    }
  });
  sidebarTabs.forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.sidebarMode;
      sidebarTabs.forEach(item => item.classList.toggle('active', item === button));
      const showFiles = mode === 'files';
      document.querySelector('.sidebar-head').classList.toggle('hidden', !showFiles);
      treeEl.classList.toggle('hidden', !showFiles);
      artifactListEl.classList.toggle('hidden', mode !== 'artifacts');
      timeMachineListEl.classList.toggle('hidden', mode !== 'time-machine');
      if (mode === 'artifacts') loadArtifacts();
      if (mode === 'time-machine') loadTimeMachine();
    });
  });
  forkForm.addEventListener('submit', submitFork);
  forkClose.addEventListener('click', closeForkModal);
  forkCancel.addEventListener('click', closeForkModal);
  forkModal.addEventListener('click', event => {
    if (event.target === forkModal) closeForkModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !forkModal.classList.contains('hidden')) closeForkModal();
  });

  // ---------- 启动 ----------
  document.querySelectorAll('#modeSwitch button').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === viewerMode);
  });
  initSplitter();
  loadRootInfo();
  loadTree(false);
  loadArtifacts();
  loadTimeMachine();
  connectEvents();
  setInterval(checkCurrentFileFreshness, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    checkCurrentFileFreshness();
    loadArtifacts();
    loadTimeMachine();
  });
})();
