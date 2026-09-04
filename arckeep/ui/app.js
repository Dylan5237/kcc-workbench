/* Arckeep M1 UI 逻辑：空间 / 侧轨双模式 + 待办交互 + 回流区块 + 额度面板 */
import { buildForecast } from './forecast.js';

window.onerror = (m, s, l) => { window._lastErr = `${m} @${s}:${l}`; };
const bridge = window.chrome?.webview;
const $ = id => document.getElementById(id);

function send(msg){ bridge?.postMessage(msg); }
function toast(text){
  let el = document.getElementById('toast');
  if(!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.remove(), 2400);
}

let state = null;
let eventCount = 0;
let streamEl = null, streamKind = '';
let toolCount = 0, toolEl = null;
const NOISE = new Set(['available_commands_update', 'session_info_update', 'usage_update', 'other', 'unknown']);

/* ---------- 模式切换（空间 / 侧轨 / 空态） ---------- */
function setMode(mode){
  const app = $('app');
  if(mode === 'rail'){
    if(!$('view-rail')){
      const tpl = $('tpl-rail');
      const node = tpl.content.cloneNode(true);
      const sec = document.createElement('section');
      sec.className = 'view';
      sec.id = 'view-rail';
      sec.appendChild(node);
      $('view-space').after(sec);
      $('btnBack').addEventListener('click', () => send({ type: 'back' }));
      $('rPrompt').addEventListener('keydown', e => {
        if(e.key === 'Enter' && e.target.value.trim()){
          send({ type: 'send-prompt', text: e.target.value.trim() });
          e.target.value = '';
        }
      });
    }
    app.classList.add('mode-rail');
    showView('rail');
  } else {
    app.classList.remove('mode-rail');
    showView(mode);
  }
}
function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + name));
}

/* ---------- 项目空间渲染 ---------- */
function renderState(s){
  state = s;
  if(s.empty){ setMode('empty'); return; }
  $('railProj').innerHTML = `<b>${escapeHtml(s.project.name)}</b><span>${escapeHtml(s.project.id)}</span>`;
  $('folioProj').textContent = s.project.path;
  $('statusText').textContent = s.status.text;
  $('statusBy').textContent = s.status.confirmedBy === 'user' ? '你确认的' : '系统初始';
  $('statusAt').textContent = s.status.updatedAt;

  $('nextList').innerHTML = s.next.map(n => `
    <div class="next ${n.epistemic === '推测' ? 'sys' : ''} ${n.selected ? 'sel' : ''}" data-id="${n.id}">
      <span class="dot"></span><span class="ntx">${escapeHtml(n.text)}</span>
      <span class="nact">
        ${n.epistemic === '推测' ? `<button class="mini" data-act="confirm" title="确认这条（成为你的判断）">✓</button>` : ''}
        <button class="mini" data-act="dismiss" title="忽略（归档，不再出现）">×</button>
      </span>
      <span class="nsrc">${escapeHtml(n.source)}</span>
    </div>`).join('') || '<div class="row"><span class="rn" style="color:var(--mut3)">暂无——回流会产生推测，你也可以自己添加</span></div>';
  document.querySelectorAll('.next').forEach(el => {
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if(act){
        e.stopPropagation();
        const id = el.dataset.id;
        if(act.dataset.act === 'dismiss'){ send({ type: 'dismiss-next', id }); toast('已忽略并归档'); }
        if(act.dataset.act === 'confirm'){ send({ type: 'confirm-next', id }); toast('已确认'); }
        return;
      }
      send({ type: 'select-next', id: el.dataset.id });
      document.querySelectorAll('.next').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
    });
  });

  const cur = s.decisions.filter(d => d.status === '当前');
  const old = s.decisions.filter(d => d.status !== '当前');
  $('decSub').textContent = `当前 ${cur.length} · 历史 ${old.length}`;
  $('decList').innerHTML = cur.map(d => `
    <div class="dec cur"><span class="dtag">当前</span><div><div class="dtx">${escapeHtml(d.text)}</div><div class="dsr">${escapeHtml(d.source)}</div></div></div>`).join('')
    || '<div class="row"><span class="rn" style="color:var(--mut3)">暂无已确认判断——重要的"为什么"值得写一条</span></div>';

  $('artList').innerHTML = s.artifacts.map(a => `
    <div class="row"><span class="rn">${escapeHtml(a.name)}</span><span class="rm">${escapeHtml(a.modified)}</span></div>`).join('')
    || '<div class="row"><span class="rn" style="color:var(--mut3)">目录为空</span></div>';

  if(!$('app').classList.contains('mode-rail')) showView('space');
}

/* ---------- 侧轨（接入态） ---------- */
const PHASE_TEXT = { generated:'简报已生成', delivered:'已交付（ACP）', running:'运行中', completed:'已完成', failed:'失败' };
function railSession(msg){
  if(msg.phase === 'generated'){
    $('rBrief').textContent = '已生成（context.md）';
    $('rCont').textContent = msg.continuation || '无（自由开始）';
    $('rPhase').textContent = PHASE_TEXT.generated;
  }
  if(msg.phase === 'delivered'){
    $('rBrief').textContent = '已交付（ACP）';
    $('rSid').textContent = msg.sessionId.slice(0, 18) + '…';
    $('rSid').title = msg.sessionId;
    $('rPhase').textContent = PHASE_TEXT.delivered;
    setTimeout(() => { if($('rPhase').textContent === PHASE_TEXT.delivered) $('rPhase').textContent = PHASE_TEXT.running; }, 1500);
  }
  if(msg.phase === 'running'){ $('rPhase').textContent = PHASE_TEXT.running; }
  if(msg.phase === 'completed' || msg.phase === 'failed'){
    $('rPhase').textContent = msg.phase === 'completed' ? `已完成（${msg.stopReason}）` : '失败';
  }
}

function feed(kind, text){
  const feedEl = $('feed');
  if(!feedEl || NOISE.has(kind)) return;
  if(kind.startsWith('tool')){
    toolCount++;
    if(!toolEl){ toolEl = document.createElement('div'); toolEl.className = 'toolline'; feedEl.appendChild(toolEl); }
    toolEl.innerHTML = `<span class="k">工具调用</span> <span class="txt">×${toolCount}</span>`;
  } else if(kind === 'agent_thought_chunk' || kind === 'agent_message_chunk'){
    if(!text) return;
    if(!streamEl || streamKind !== kind){
      streamEl = document.createElement('div');
      streamEl.className = 'streamline';
      streamEl.innerHTML = `<span class="k">${kind === 'agent_thought_chunk' ? '思考' : '答复'}</span> <span class="txt"></span>`;
      feedEl.appendChild(streamEl);
      streamKind = kind;
    }
    streamEl.querySelector('.txt').textContent += text;
  } else {
    streamEl = null; streamKind = '';
    const div = document.createElement('div');
    div.innerHTML = `<span class="k">${escapeHtml(kind)}</span>${text ? ` <span class="txt">${escapeHtml(text)}</span>` : ''}`;
    feedEl.appendChild(div);
  }
  feedEl.scrollTop = feedEl.scrollHeight;
}

/* ---------- 宿主消息 ---------- */
bridge?.addEventListener('message', e => {
  const msg = e.data;
  if(msg.type === 'state') renderState(msg);
  else if(msg.type === 'quota') renderQuota(msg);
  else if(msg.type === 'show-quota'){
    document.title = 'QUOTA';
    if($('app').classList.contains('mode-rail')) toast('回到项目后可查看额度面板');
    else { showView('quota'); renderQuotaPanel(); }
  }
  else if(msg.type === 'mode') setMode(msg.mode);
  else if(msg.type === 'session'){
    railSession(msg);
    if(msg.phase === 'generated'){ eventCount = 0; toolCount = 0; toolEl = null; streamEl = null; const f = $('feed'); if(f) f.innerHTML = ''; }
  }
  else if(msg.type === 'session-feed'){
    eventCount++;
    if($('rEvents')) $('rEvents').textContent = String(eventCount);
    feed(msg.kind, msg.text);
  }
  else if(msg.type === 'backflow'){
    setMode('space');
    const block = $('backflowBlock');
    const list = $('backflowList');
    if(msg.changed.length){
      block.style.display = '';
      list.innerHTML = msg.changed.map(c =>
        `<div class="row"><span class="rn">${escapeHtml(c.name)}</span><span class="rm">${escapeHtml(c.change)}</span></div>`).join('');
      toast(`回流完成：${msg.changed.length} 个文件变化（观察）`);
    } else {
      block.style.display = 'none';
      toast('回流完成：无文件变化');
    }
  }
});

/* ---------- 动作 ---------- */
$('btnPick').addEventListener('click', () => send({ type: 'pick-directory' }));
$('btnStart').addEventListener('click', () => send({ type: 'start' }));
$('btnViewer').addEventListener('click', () => send({ type: 'open-viewer' }));
$('btnEditStatus').addEventListener('click', () => {
  if(!state || state.empty) return;
  const text = prompt('改写当前状态（写入 .arckeep/status.md）：', state.status.text);
  if(text && text.trim()) send({ type: 'edit-status', text: text.trim() });
});
$('addNextInput').addEventListener('keydown', e => {
  if(e.key === 'Enter' && e.target.value.trim()){
    send({ type: 'add-next', text: e.target.value.trim() });
    e.target.value = '';
    toast('已添加（你自己写的）');
  }
});

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/* ---------- 额度面板（v1 版式逻辑移植 + forecast.js 原样跑） ---------- */
let quotaState = null;

function renderQuota(q){
  quotaState = q;
  if($('view-quota').classList.contains('on')) renderQuotaPanel();
}

function renderQuotaPanel(){
  const q = quotaState;
  if(!q) return;
  const s = q.snapshot;
  $('qUpdated').textContent = q.status === 'refreshing' ? '正在连接 Kimi…' : (s ? `上次同步：${formatUpdatedAt(s.updatedAt)}` : '尚未同步');
  $('qPlan').textContent = s?.membershipPlan || '未识别';
  $('qTotal').textContent = pct(s?.total?.usedPercent);
  const splitKnown = s && (s.total.kimiPercent > 0 || s.total.codePercent > 0);
  if(splitKnown){
    $('qKimi').textContent = pct(s.total.kimiPercent);
    $('qCode').textContent = pct(s.total.codePercent);
    setWidth($('qKimiBar'), s.total.kimiPercent);
    setWidth($('qCodeBar'), s.total.codePercent);
  } else {
    // 现版 kimi.com 不给出分项数字：总额单条展示，图例诚实标注
    $('qKimi').textContent = '分项暂不可读';
    $('qCode').textContent = '';
    setWidth($('qKimiBar'), s?.total?.usedPercent);
    setWidth($('qCodeBar'), 0);
  }
  $('qTotalReset').textContent = resetAt(s?.total?.resetAt);
  $('qFive').textContent = 'Code ' + pct(s?.fiveHour?.percent);
  setWidth($('qFiveBar'), s?.fiveHour?.percent);
  $('qFiveReset').textContent = resetAt(s?.fiveHour?.resetAt);
  $('qSeven').textContent = 'Code ' + pct(s?.sevenDay?.percent);
  setWidth($('qSevenBar'), s?.sevenDay?.percent);
  $('qSevenReset').textContent = resetAt(s?.sevenDay?.resetAt);

  const forecast = buildForecast(q.history || []);
  $('qBadge').className = 'q-badge ' + forecast.status;
  $('qBadge').textContent = { safe:'节奏安全', stable:'消耗稳定', warning:'可能提前用尽', critical:'即将用尽', insufficient:'样本不足' }[forecast.status];
  $('qFmsg').textContent = forecast.message || '再同步一次后生成燃尽预测。';
  const labels = { fiveHour:'5 小时', sevenDay:'7 天', total:'总额度' };
  $('qFdetails').innerHTML = Object.entries(forecast.metrics || {})
    .filter(([, m]) => Number.isFinite(m.delta))
    .map(([key, m]) => {
      const safe = Number.isFinite(m.safeRatePerHour) ? `建议 ≤ ${fmtNum(m.safeRatePerHour)}%/小时`
        : m.status === 'stable' ? '当前未观察到明显增长' : '';
      const obs = Number.isFinite(m.sampleCount) && Number.isFinite(m.spanMinutes)
        ? ` · ${m.sampleCount} 次 / 跨度 ${fmtDur(m.spanMinutes)}` : '';
      const conf = { high:'高置信度', medium:'中置信度', low:'低置信度' }[m.confidence];
      return `<div><span>${labels[key] || key}：过去 ${fmtDur(m.elapsedMinutes)} +${fmtNum(Math.max(0, m.delta))}%${obs}${conf ? ' · ' + conf : ''}</span><span>${safe}</span></div>`;
    }).join('');
  $('qErr').hidden = !q.error;
  $('qErr').textContent = q.error || '';
}

function pct(v){ return Number.isFinite(v) ? `${fmtNum(v)}%` : '--'; }
function resetAt(v){ return v ? `${v} 后重置` : '--'; }
function setWidth(el, v){ el.style.width = `${Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0}%`; }
function fmtNum(v){ return Number(v).toFixed(2).replace(/\.?0+$/, ''); }
function fmtDur(min){ return min < 60 ? `${Math.round(min)} 分钟` : `${fmtNum(min / 60)} 小时`; }
function formatUpdatedAt(v){
  const d = new Date(v);
  if(Number.isNaN(d.getTime())) return '--';
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

$('qRefresh').addEventListener('click', () => send({ type: 'quota-refresh' }));
$('qClose').addEventListener('click', () => showView('space'));

send({ type: 'ui-ready' });
