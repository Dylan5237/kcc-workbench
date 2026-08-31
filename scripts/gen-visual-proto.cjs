const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'prototypes', 'arckeep-visual-v0.1.html');

// 侧栏内容
const sidebarItems = (cls, activeScreen) => `
<div class="side ${cls}">
  <div class="brand"><div class="name">Arckeep</div><div class="tag">长期工作环境</div></div>
  <div class="sec">
    <div class="label">项目</div>
    <div class="item on">Arckeep 设计<span class="when">今天</span></div>
    <div class="item">req-to-page<span class="when">昨天</span></div>
    <div class="item">efficiency-utils<span class="when">上周</span></div>
  </div>
  <div class="sec">
    <div class="label">当前项目</div>
    <div class="item scr-btn ${activeScreen === 'space' ? 'on' : ''}" data-scr="space">项目空间</div>
    <div class="item scr-btn ${activeScreen === 'map' ? 'on' : ''}" data-scr="map">Session Map</div>
    <div class="item scr-btn ${activeScreen === 'out' ? 'on' : ''}" data-scr="out">产出</div>
    <div class="item scr-btn ${activeScreen === 'live' ? 'on' : ''}" data-scr="live">Kimi 接入中</div>
  </div>
  <div class="sec">
    <div class="label">候选</div>
    <div class="item cand">个人认知索引</div>
    <div class="item cand">能力与资源</div>
    <div class="item cand">额度总览</div>
  </div>
  <div class="foot">高保真视觉稿 v0.1</div>
</div>`;

// ═══ 屏 2 · Session Map ═══
const mainMap = `
<div class="main">
  <h1>SESSION MAP · 经历与接续</h1>
  <div class="map-canvas" id="mapCanvas">
    <div class="m-link" style="left:20px; top:14px; width:210px;"></div>
    <div class="m-link dash" style="left:254px; top:14px; width:212px;"></div>
    <div class="m-link v dash" style="left:18px; top:18px; height:100px;"></div>
    <div class="m-link dash" style="left:18px; top:122px; width:56px;"></div>
    <div class="m-link" style="left:490px; top:14px; width:212px;"></div>

    <div class="m-node" id="mn1" style="left:4px; top:0;">
      <div class="nd"></div><div class="nm">产品困惑</div><div class="tm">Codex · 08-25</div>
    </div>
    <div class="m-node" id="mn2" style="left:238px; top:0;">
      <div class="nd"></div><div class="nm">不变与变</div><div class="tm">Codex · 08-26</div>
    </div>
    <div class="m-node dash dim" id="mn3" style="left:74px; top:118px;">
      <div class="nd"></div><div class="nm">Session Map 探索</div><div class="tm">Claude Code · 分叉 · 08-26</div>
    </div>
    <div class="m-node" id="mn4" style="left:474px; top:0;">
      <div class="nd"></div><div class="nm">概要设计 v0.1</div><div class="tm">Codex · 08-27</div>
    </div>
    <div class="m-node" id="mn5" style="left:700px; top:0;">
      <div class="nd"></div><div class="nm">原型迭代</div><div class="tm">Codex + Kimi · 今天</div>
    </div>
    <div class="m-legend">—— 确认 · - - - 推测 / 分叉</div>
  </div>
  <div class="m-detail" id="mDetail">
    <h3>不变与变</h3>
    <div class="sum">确定稳定核心假设：项目是中心，Agent 可替换。产生未决问题：管理者-执行者是否是最佳多 Agent 模式？</div>
    <div class="src">Codex · 08-26 · 摘要由你确认</div>
  </div>
  <div class="launch" style="margin-top:20px;">
    <span class="llabel">从选中的经历继续</span>
    <button class="ag on">Codex</button>
    <button class="ag">Claude Code</button>
    <button class="go">开始 →</button>
  </div>
</div>`;

// ═══ 屏 3 · 产出（完整 Viewer）═══
const mainOut = `
<div class="main" style="padding:0;">
  <div class="vwrap">
    <div class="v-toolbar">
      <span class="v-title">产出</span>
      <div class="v-modes">
        <button class="on" data-vm="auto">自动</button>
        <button data-vm="dev">开发</button>
        <button data-vm="run">运行</button>
      </div>
      <span class="v-live">实时监听中</span>
    </div>
    <div class="v-tabs">
      <button class="on" data-vt="files">文件</button>
      <button data-vt="changes">本轮产物 <span class="ct">3</span></button>
      <button data-vt="tm">时间机器 <span class="ct">3</span></button>
    </div>
    <div class="v-body">
      <div class="v-list">
        <div class="v-filter"><input id="vFilter" placeholder="过滤文件名…" /></div>
        <div class="v-items" id="vItems"></div>
      </div>
      <div class="v-main">
        <div class="v-fhead" id="vFhead" style="display:none;">
          <div><div class="fn" id="vFn"></div><div class="fm" id="vFm"></div></div>
          <div class="acts" id="vActs"></div>
        </div>
        <div class="v-content" id="vContent"></div>
        <div class="v-foot"><span>以真实工作目录为准 · 不做第二份事实</span><span id="vCount"></span></div>
      </div>
    </div>
  </div>
</div>`;

// ═══ 屏 4 · Kimi 接入态 ═══
const mainLive = `
<div class="main" style="padding:0;">
  <div class="l-grid">
    <div>
      <div class="l-frame">
        <span class="bd">Kimi Code Web · 嵌入视图（接入 ≠ 改造）</span>
        <div class="ph">这里是 Kimi 的原生界面<br>它的按钮、会话列表、输入框都保持原样</div>
      </div>
    </div>
    <aside class="l-rail">
      <div class="blk">
        <h4>本项目</h4>
        <div class="r"><span class="k">目录</span><span class="v ok">D:\_projects\tools\KCCWorkbench</span></div>
        <div class="r"><span class="k">接续点</span><span class="v">原型迭代</span></div>
        <div class="r"><span class="k">携带上下文</span><span class="v ok">2 项</span></div>
      </div>
      <div class="blk">
        <h4>会话状态</h4>
        <div class="r"><span class="k">会话</span><span class="v ok">进行中</span></div>
        <div class="r"><span class="k">来自</span><span class="v">Kimi Code Web</span></div>
        <div class="r"><span class="k">开始</span><span class="v">14:32</span></div>
      </div>
      <div class="blk">
        <h4>文件变化</h4>
        <div class="cf"><a onclick="toast(&quot;原型未实现跳转&quot;)">docs/assets/notes.md</a><span class="st">新增</span></div>
        <div class="cf"><a onclick="toast(&quot;原型未实现跳转&quot;)">src/main/session.ts</a><span class="st">+18</span></div>
        <div class="note">以真实工作目录为准 · agent 说完成不等于完成</div>
      </div>
      <div class="blk">
        <h4>接回项目</h4>
        <button class="go">会话结束 · 回到项目 →</button>
        <div class="note">你不需要手动复制产出或摘要</div>
      </div>
    </aside>
  </div>
</div>`;

// ═══ 屏 1 · 项目空间 ═══
const mainSpace = `
<div class="main">
  <h1>ARCKEEP 设计</h1>

  <div class="opening">
    <div class="meta-line">
      <span class="b-conf">你确认的</span>
      <span class="time">08-27 16:02 更新</span>
    </div>
    <div class="sentence">设计哲学和概要设计 v0.1 已定稿，项目恢复原型正在探索。</div>
  </div>

  <div class="twocol">
    <div class="col">
      <div class="field">
        <div class="fhead">可能值得继续的事 <span class="fsub">系统推测 · 不是指令</span></div>
        <div class="fbody no-line">
          <div class="next"><span class="dot"></span><span class="txt">让 Kimi 重新设计项目恢复体验的原型</span><span class="from">来自最近的对话</span></div>
          <div class="next"><span class="dot"></span><span class="txt">明确 Session Map 分叉语义（未决）</span><span class="from">来自概要设计 §15.3</span></div>
          <div class="next"><span class="dot gray"></span><span class="txt">整理概要设计 v0.2（原型验证完成后）</span><span class="from">你自己写的</span></div>
          <div class="next"><span class="dot gray"></span><span class="txt">Session Map 节点接续动作（点击后的行为）</span><span class="from">来自原型探索</span></div>
        </div>
      </div>

      <div class="field">
        <div class="fhead">关键判断 <span class="fsub">当前 2 · 历史 1</span></div>
        <div class="fbody with-line">
          <div class="dec">
            <span class="tag-cur">当前</span>
            <span class="dtxt">项目是稳定中心，Agent 是可替换工具。</span>
          </div>
          <div class="dsrc">Codex · 不变与变会话 · 08-26 你确认</div>
          <div class="dec">
            <span class="tag-cur">当前</span>
            <span class="dtxt">Viewer 和 Session Map 是已确认模块。</span>
          </div>
          <div class="dsrc">概要设计 D-07 / D-08</div>
          <div class="dec">
            <span class="tag-old">已取代</span>
            <span class="dtxt old">做第二个 Vibe Kanban。</span>
          </div>
          <div class="dsrc">你后来主动否定 · 历史保留，不支配现在</div>
        </div>
      </div>
    </div>

    <div class="col">
      <div class="field">
        <div class="fhead">最近产出 <span class="fsub">6 个文件</span></div>
        <div class="fbody with-line">
          <div class="row"><span class="rn">PRODUCT_DESIGN_PHILOSOPHY.md</span><span class="meta">08-26 · 你确认</span></div>
          <div class="row"><span class="rn">HIGH_LEVEL_DESIGN_V0.1.md</span><span class="meta">08-27 · 你确认</span></div>
          <div class="row"><span class="rn">arckeep-open-space-v0.2.html</span><span class="meta">08-27 · 今天的原型</span></div>
          <div class="row"><span class="rn">arckeep-resume-flow.html</span><span class="meta">08-27 · Kimi 交付</span></div>
          <div class="row"><span class="rn">arckeep-resume-flow-fused.html</span><span class="meta">08-27 · 融合版</span></div>
          <div class="row"><span class="rn">arckeep-visual-v0.1.html</span><span class="meta">08-27 · 视觉稿</span></div>
        </div>
      </div>

      <div class="field">
        <div class="fhead">会话现场 <span class="fsub">Codex · 昨天 22:41 停止</span></div>
        <div class="fbody with-line">
          <div class="quote"><b>你</b>　让 Kimi 帮忙重新设计原型。</div>
          <div class="quote"><b>Codex</b>　上一版被否定为看板，已写好求助提示词交给 Kimi。</div>
        </div>
      </div>

      <div class="launch">
        <span class="llabel">继续</span>
        <button class="ag on">Codex</button>
        <button class="ag">Claude Code</button>
        <button class="ag">Kimi Code</button>
        <button class="go">开始 →</button>
      </div>
    </div>
  </div>
</div>`;

// ═══ 方向 A · 纸感人文（排版优化版）═══
const cssA = `
.mockA { background:#faf7f2; color:#2b2620; }
.mockA .side { background:#f4efe7; border-right:1px solid #e6ddd0; }
.mockA .brand { padding-bottom:20px; }
.mockA .brand .name { font-family:"Songti SC","Noto Serif SC",serif; font-size:20px; font-weight:700; letter-spacing:.04em; }
.mockA .brand .tag { font-size:11px; color:#a89b87; margin-top:4px; letter-spacing:.08em; }

/* 侧栏两个层级：项目是“地点”，模块是“这个地点里的页面” */
.mockA .label {
  font-size:9px; color:#b3a893; letter-spacing:.24em; margin:0 12px 10px;
  font-weight:600;
}
.mockA .sec { padding:18px 12px 4px; }
.mockA .sec:first-of-type { padding-top:22px; }
.mockA .sec .label { margin-bottom:8px; }
.mockA .item {
  padding:9px 12px; border-radius:6px; font-size:13px; color:#6b6053;
  margin-bottom:2px; display:flex; justify-content:space-between;
  align-items:baseline; gap:8px; cursor:pointer; line-height:1.4;
}
.mockA .item:hover { background:#ede5d8; }
.mockA .item.on {
  background:#fffdf9; color:#2b2620; font-weight:600;
  box-shadow:0 1px 3px rgba(90,70,40,.1);
}
.mockA .item .when { font-size:11px; color:#b3a893; flex:none; }
.mockA .item.cand { color:#c4b9a6; font-style:italic; cursor:default; }
.mockA .foot { margin-top:auto; padding:18px 22px; font-size:10px; color:#c4b9a6; }

/* 主区：开场白 + 分层信息 */
.mockA .main { padding:36px 44px 32px; }
.mockA h1 {
  font-family:"Songti SC","Noto Serif SC",serif; font-size:12px;
  color:#a89b87; letter-spacing:.28em; margin:0 0 20px; font-weight:400;
}

/* 开场白：当前状态脱离字段形式，成为第一眼 */
.mockA .opening {
  margin-bottom:22px;
}
.mockA .opening .meta-line {
  display:flex; gap:10px; align-items:baseline; margin-bottom:10px;
}
.mockA .opening .b-conf {
  display:inline-block; font-family:"Segoe UI",sans-serif;
  background:#2b2620; color:#faf7f2; font-size:10px;
  padding:3px 8px; border-radius:3px; letter-spacing:.05em; line-height:1.4;
}
.mockA .opening .time {
  font-size:11px; color:#b3a893; letter-spacing:.05em;
}
.mockA .opening .sentence {
  font-family:"Songti SC","Noto Serif SC",serif;
  font-size:20px; line-height:1.55; letter-spacing:.01em;
}

/* 字段块：间距呼吸、弱化标题、强调内容 */
.mockA .twocol {
  display:grid; grid-template-columns:1fr 1fr; gap:28px 44px;
  align-items:start;
}
.mockA .col { min-width:0; }
.mockA .field { margin-bottom:24px; }
.mockA .fhead {
  font-size:11px; color:#9a8f7e; letter-spacing:.18em; margin-bottom:4px;
  font-weight:600;
}
.mockA .fsub { margin-left:10px; font-size:10px; color:#c4b9a6; letter-spacing:.08em; font-weight:400; }
.mockA .fbody { padding-top:10px; }
.mockA .fbody.no-line { border-top:none; padding-top:8px; }
.mockA .fbody.with-line { border-top:1px solid #e6ddd0; }

/* 可能值得继续的事：动态的，视觉权重高 */
.mockA .next {
  display:flex; align-items:baseline; gap:14px;
  padding:8px 12px; margin:0 -12px 2px; border-radius:6px; cursor:pointer;
}
.mockA .next:hover { background:#f0e8da; }
.mockA .dot { width:6px; height:6px; border-radius:50%; background:#c4a35a; flex:none; }
.mockA .dot.gray { background:#c4b9a6; }
.mockA .txt { flex:1; font-size:13.5px; line-height:1.45; }
.mockA .from { font-size:11px; color:#a89b87; white-space:nowrap; }

/* 关键判断：认知层，视觉更安静 */
.mockA .dec {
  display:flex; align-items:baseline; gap:14px;
  padding:8px 0; border-bottom:1px solid #efe7db; font-size:13px; line-height:1.55;
}
.mockA .dec:last-child { border-bottom:none; }
.mockA .tag-cur {
  font-family:"Segoe UI",sans-serif; font-size:10px; padding:3px 8px;
  border-radius:3px; background:#2b2620; color:#faf7f2; flex:none;
  letter-spacing:.04em; line-height:1.3;
}
.mockA .tag-old {
  font-family:"Segoe UI",sans-serif; font-size:10px; padding:3px 8px;
  border-radius:3px; background:#efe7db; color:#9a8f7e; flex:none;
  letter-spacing:.04em; line-height:1.3;
}
.mockA .dtxt { flex:1; }
.mockA .dtxt.old { color:#9a8f7e; }
.mockA .dsrc {
  font-size:11px; color:#b3a893; margin-top:4px;
  padding-left:52px; line-height:1.5;
}

/* 会话现场引用 */
.mockA .quote {
  border-left:2px solid #d9cfbf; padding:3px 0 3px 12px;
  font-size:12.5px; color:#6b6053; margin-bottom:6px; line-height:1.6;
}
.mockA .quote b { color:#2b2620; font-weight:600; margin-right:6px; }

/* 产出：等宽字体，表格感 */
.mockA .row {
  display:flex; justify-content:space-between; align-items:baseline; gap:14px;
  padding:6px 0; border-bottom:1px solid #efe7db;
}
.mockA .row:last-child { border-bottom:none; }
.mockA .rn { font-family:ui-monospace,Consolas,monospace; font-size:11.5px; }
.mockA .meta { font-size:11px; color:#a89b87; white-space:nowrap; }
.mockA .more-link {
  all:unset; font:inherit; font-size:12px; color:#9a8f7e; cursor:pointer;
  text-decoration:underline; text-underline-offset:3px; text-decoration-color:#d9cfbf;
  margin-top:8px; display:inline-block;
}
.mockA .more-link:hover { color:#2b2620; text-decoration-color:#9a8f7e; }

/* 启动区 */
.mockA .launch {
  margin-top:16px; padding-top:20px; border-top:1px solid #e6ddd0;
  display:flex; align-items:baseline; gap:14px; flex-wrap:wrap;
}
.mockA .llabel { font-size:12px; color:#a89b87; letter-spacing:.06em; }
.mockA .ag {
  all:unset; font:inherit; font-size:13px; padding:6px 18px;
  border:1px solid #d9cfbf; border-radius:16px; cursor:pointer; color:#6b6053;
}
.mockA .ag:hover { border-color:#9a8f7e; color:#2b2620; }
.mockA .ag.on {
  background:#2b2620; color:#faf7f2; border-color:#2b2620; font-weight:600;
}
.mockA .go {
  all:unset; font:inherit; font-size:13px; padding:7px 26px;
  background:#c4a35a; color:#fffdf9; border-radius:16px; cursor:pointer;
  font-weight:600;
}
.mockA .go:hover { background:#b8934e; }
`;

// ═══ 附加屏 CSS（Session Map / 产出 / 接入态，A 视觉语言）═══
const cssA2 = `
/* ── Session Map ── */
.mockA .map-canvas { position:relative; height:360px; margin:8px 0 20px; }
.mockA .m-link { position:absolute; background:#d9cfbf; height:1px; }
.mockA .m-link.dash { background:none; border-top:1px dashed #d9cfbf; height:0; }
.mockA .m-link.v { width:1px; height:auto; }
.mockA .m-node { position:absolute; width:210px; cursor:pointer; }
.mockA .m-node .nd { width:11px; height:11px; border:1.5px solid #2b2620; background:#fffdf9; margin-bottom:9px; }
.mockA .m-node.dash .nd { border-style:dashed; border-color:#b3a893; }
.mockA .m-node.dim { opacity:.4; }
.mockA .m-node .nm { font-size:13px; font-weight:600; }
.mockA .m-node.sel .nm::after { content:""; display:block; height:2px; background:#c4a35a; margin-top:4px; width:26px; }
.mockA .m-node .tm { font-size:11px; color:#a89b87; margin-top:2px; }
.mockA .m-legend { position:absolute; right:0; bottom:0; font-size:11px; color:#c4b9a6; }
.mockA .m-detail { border-top:2px solid #2b2620; padding-top:16px; min-height:120px; }
.mockA .m-detail h3 { font-family:"Songti SC","Noto Serif SC",serif; font-size:17px; margin-bottom:8px; font-weight:700; }
.mockA .m-detail .sum { font-size:13px; color:#6b6053; line-height:1.7; }
.mockA .m-detail .src { font-size:11px; color:#a89b87; margin-top:8px; }

/* ── 产出（Viewer）── */
.mockA .vwrap { padding:28px 32px 24px; height:100%; display:flex; flex-direction:column; }
.mockA .v-toolbar { display:flex; gap:12px; align-items:center; margin-bottom:14px; }
.mockA .v-title { font-family:"Songti SC","Noto Serif SC",serif; font-size:12px; letter-spacing:.28em; color:#a89b87; font-weight:400; }
.mockA .v-modes { display:flex; border:1px solid #d9cfbf; border-radius:6px; overflow:hidden; }
.mockA .v-modes button { all:unset; font:inherit; font-size:12px; padding:5px 14px; cursor:pointer; color:#6b6053; border-right:1px solid #d9cfbf; }
.mockA .v-modes button:last-child { border-right:none; }
.mockA .v-modes button.on { background:#2b2620; color:#faf7f2; }
.mockA .v-live { margin-left:auto; font-size:11px; color:#5c7a52; }
.mockA .v-live::before { content:"● "; }
.mockA .v-tabs { display:flex; border-bottom:1px solid #e6ddd0; }
.mockA .v-tabs button { all:unset; font:inherit; font-size:13px; padding:8px 18px; cursor:pointer; color:#6b6053; border-bottom:2px solid transparent; margin-bottom:-1px; }
.mockA .v-tabs button.on { color:#2b2620; font-weight:600; border-bottom-color:#c4a35a; }
.mockA .v-tabs .ct { font-size:11px; color:#b3a893; margin-left:4px; }
.mockA .v-body { flex:1; display:grid; grid-template-columns:270px minmax(0,1fr); border:1px solid #e6ddd0; border-radius:8px; overflow:hidden; min-height:0; background:#fffdf9; }
.mockA .v-list { border-right:1px solid #e6ddd0; display:flex; flex-direction:column; min-height:0; }
.mockA .v-filter { padding:8px 10px; border-bottom:1px solid #efe7db; display:flex; gap:6px; }
.mockA .v-filter input { all:unset; font:inherit; font-size:12px; flex:1; padding:5px 9px; border:1px solid #d9cfbf; border-radius:5px; background:#fff; }
.mockA .v-items { overflow-y:auto; flex:1; }
.mockA .vi { padding:9px 13px; border-bottom:1px solid #efe7db; cursor:pointer; }
.mockA .vi:hover { background:#f4efe7; }
.mockA .vi.on { background:#fff; box-shadow:inset 3px 0 0 #c4a35a; }
.mockA .vi .n { font-family:ui-monospace,Consolas,monospace; font-size:12px; display:flex; justify-content:space-between; gap:8px; align-items:baseline; }
.mockA .vi .m { font-size:10.5px; color:#a89b87; margin-top:2px; }
.mockA .vi .ty { font-size:9px; padding:2px 6px; border-radius:3px; flex:none; letter-spacing:.04em; }
.mockA .vi .ty.add { background:#e8efdf; color:#5c7a52; }
.mockA .vi .ty.del { background:#f2e3dd; color:#a05a45; }
.mockA .vi .ty.mod { background:#f0e8da; color:#8a6a3a; }
.mockA .vi .ty.ext { background:#efe7db; color:#9a8f7e; }
.mockA .v-main { display:flex; flex-direction:column; min-height:0; }
.mockA .v-fhead { padding:11px 18px; border-bottom:1px solid #efe7db; display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
.mockA .v-fhead .fn { font-family:ui-monospace,Consolas,monospace; font-size:12.5px; font-weight:600; }
.mockA .v-fhead .fm { font-size:11px; color:#a89b87; margin-top:2px; }
.mockA .v-fhead .acts { display:flex; gap:6px; }
.mockA .v-fhead .acts button { all:unset; font:inherit; font-size:11px; padding:4px 11px; border:1px solid #d9cfbf; border-radius:5px; cursor:pointer; color:#6b6053; background:#fff; }
.mockA .v-fhead .acts button.on { border-color:#2b2620; color:#2b2620; font-weight:600; }
.mockA .v-fhead .acts button.gold { background:#c4a35a; color:#fffdf9; border-color:#c4a35a; font-weight:600; }
.mockA .v-content { flex:1; overflow-y:auto; padding:16px 20px; min-height:0; }
.mockA .v-code { font:12px/1.95 ui-monospace,Consolas,monospace; }
.mockA .v-code .add { color:#5c7a52; }
.mockA .v-code .del { color:#a05a45; }
.mockA .v-code .ctx { color:#9a8f7e; }
.mockA .v-code .mk { color:#c4b9a6; margin:0 10px 0 0; user-select:none; display:inline-block; width:12px; }
.mockA .v-code .ln { color:#c4b9a6; margin-right:14px; user-select:none; display:inline-block; min-width:26px; text-align:right; }
.mockA .v-md h2 { font-family:"Songti SC","Noto Serif SC",serif; font-size:17px; margin:0 0 10px; }
.mockA .v-md p { font-size:13px; color:#6b6053; line-height:1.85; margin:6px 0; }
.mockA .v-md blockquote { border-left:2px solid #c4a35a; padding-left:14px; margin:10px 0; font-family:"Songti SC","Noto Serif SC",serif; font-size:14px; color:#2b2620; }
.mockA .v-md ul { margin:6px 0 6px 18px; font-size:13px; color:#6b6053; line-height:2; }
.mockA .v-empty { flex:1; display:flex; align-items:center; justify-content:center; color:#c4b9a6; font-size:13px; }
.mockA .v-foot { padding:8px 18px; border-top:1px solid #efe7db; font-size:10.5px; color:#b3a893; display:flex; justify-content:space-between; }
.mockA .tm-rail { position:relative; padding-left:24px; }
.mockA .tm-rail::before { content:""; position:absolute; left:8px; top:6px; bottom:6px; width:1px; background:#e6ddd0; }
.mockA .tm-i { position:relative; padding:8px 0; cursor:pointer; }
.mockA .tm-i::before { content:""; position:absolute; left:-20px; top:14px; width:9px; height:9px; border:1.5px solid #2b2620; border-radius:50%; background:#fffdf9; }
.mockA .tm-i:first-child::before { background:#c4a35a; border-color:#c4a35a; }
.mockA .tm-i .t { font-size:12.5px; font-weight:600; }
.mockA .tm-i .m { font-size:10.5px; color:#a89b87; margin-top:2px; }

/* ── Kimi 接入态 ── */
.mockA .l-grid { display:grid; grid-template-columns:minmax(0,1fr) 250px; gap:20px; padding:28px 32px; height:100%; }
.mockA .l-frame { border:1.5px dashed #d9cfbf; border-radius:10px; background:#fffdf9; position:relative; display:flex; align-items:center; justify-content:center; min-height:420px; }
.mockA .l-frame .bd { position:absolute; top:12px; left:16px; font-size:11px; color:#a89b87; letter-spacing:.04em; }
.mockA .l-frame .ph { text-align:center; color:#c4b9a6; font-size:13px; line-height:2.1; }
.mockA .l-rail { border-left:1px solid #e6ddd0; padding-left:18px; font-size:12px; }
.mockA .l-rail h4 { font-size:10px; color:#b3a893; letter-spacing:.22em; margin:0 0 10px; font-weight:600; }
.mockA .l-rail .blk { margin-bottom:22px; }
.mockA .l-rail .r { display:flex; justify-content:space-between; gap:10px; padding:4px 0; }
.mockA .l-rail .r .k { color:#9a8f7e; }
.mockA .l-rail .r .v { text-align:right; color:#6b6053; }
.mockA .l-rail .r .v.ok { color:#2b2620; font-weight:600; }
.mockA .l-rail .cf { display:flex; justify-content:space-between; gap:8px; padding:5px 0; border-bottom:1px solid #efe7db; }
.mockA .l-rail .cf:last-of-type { border-bottom:none; }
.mockA .l-rail .cf a { color:#6b6053; text-decoration:none; cursor:pointer; font-family:ui-monospace,Consolas,monospace; font-size:11.5px; }
.mockA .l-rail .cf a:hover { color:#2b2620; text-decoration:underline; text-underline-offset:3px; }
.mockA .l-rail .cf .st { font-size:10.5px; color:#a89b87; }
.mockA .l-rail .note { font-size:10.5px; color:#c4b9a6; margin-top:8px; line-height:1.7; }
.mockA .l-rail .go { all:unset; font:inherit; font-size:12.5px; padding:7px 0; width:100%; text-align:center; background:#c4a35a; color:#fffdf9; border-radius:16px; cursor:pointer; font-weight:600; }
.mockA .l-rail .go:hover { background:#b8934e; }

.mockA .screen { display:none; }
.mockA .screen.on { display:block; }
`;

// ═══ 方向 B · 冷静现代 ═══
const cssB = `
.mockB { background:#f7f7f7; color:#1a1a1a; }
.mockB .side { background:#fff; border-right:1px solid #e4e4e4; }
.mockB .brand .name { font-size:16px; font-weight:700; letter-spacing:.01em; }
.mockB .brand .tag { font-size:10px; color:#999; margin-top:2px; letter-spacing:.03em; }
.mockB .label { font-size:9px; color:#b0b0b0; letter-spacing:.18em; margin:0 10px 7px; text-transform:uppercase; }
.mockB .item { padding:7px 12px; border-radius:4px; font-size:13px; color:#666; margin-bottom:1px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; cursor:pointer; }
.mockB .item:hover { background:#f2f2f2; }
.mockB .item.on { background:#e8e8e8; color:#1a1a1a; font-weight:600; }
.mockB .item .when { font-size:11px; color:#b0b0b0; }
.mockB .item.cand { color:#ccc; font-style:italic; cursor:default; }
.mockB .foot { margin-top:auto; padding:14px 20px; font-size:10px; color:#ccc; }
.mockB .main { padding:40px 44px 80px; max-width:760px; }
.mockB h1 { font-size:11px; color:#999; letter-spacing:.22em; margin:0 0 24px; font-weight:600; }
.mockB .fhead { font-size:11px; color:#999; letter-spacing:.1em; margin-bottom:6px; font-weight:500; }
.mockB .fsub { margin-left:8px; font-size:10px; color:#c0c0c0; }
.mockB .fbody { border-top:1px solid #e4e4e4; padding-top:10px; }
.mockB .state { font-size:18px; line-height:1.6; font-weight:400; }
.mockB .b-conf { display:inline-block; background:#1a1a1a; color:#fff; font-size:10px; padding:3px 8px; border-radius:3px; vertical-align:3px; margin-right:9px; letter-spacing:.03em; }
.mockB .next { display:flex; align-items:baseline; gap:12px; padding:10px 12px; margin:0 -12px; border-radius:4px; cursor:pointer; }
.mockB .next:hover { background:#ececec; }
.mockB .dot { width:5px; height:5px; border-radius:50%; background:#c0c0c0; flex:none; }
.mockB .txt { flex:1; font-size:14px; }
.mockB .from { font-size:11px; color:#b0b0b0; white-space:nowrap; }
.mockB .dec { display:flex; align-items:baseline; gap:12px; padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:13px; }
.mockB .dec:last-child { border-bottom:none; }
.mockB .tag-cur { font-size:10px; padding:2px 7px; border-radius:3px; background:#1a1a1a; color:#fff; flex:none; letter-spacing:.03em; }
.mockB .tag-old { font-size:10px; padding:2px 7px; border-radius:3px; background:#f0f0f0; color:#b0b0b0; flex:none; letter-spacing:.03em; }
.mockB .dtxt.old { color:#b0b0b0; }
.mockB .row { display:flex; justify-content:space-between; gap:12px; padding:7px 0; border-bottom:1px solid #f0f0f0; font-size:13px; }
.mockB .row:last-child { border-bottom:none; }
.mockB .rn { font-family:ui-monospace,Consolas,monospace; font-size:12px; }
.mockB .meta { font-size:11px; color:#b0b0b0; white-space:nowrap; }
.mockB .launch { margin-top:36px; padding-top:20px; border-top:1px solid #e4e4e4; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
.mockB .llabel { font-size:12px; color:#999; }
.mockB .ag { all:unset; font:inherit; font-size:13px; padding:5px 16px; border:1px solid #e4e4e4; border-radius:16px; cursor:pointer; color:#666; }
.mockB .ag:hover { border-color:#999; color:#1a1a1a; }
.mockB .ag.on { background:#1a1a1a; color:#fff; border-color:#1a1a1a; font-weight:600; }
.mockB .go { all:unset; font:inherit; font-size:13px; padding:6px 22px; background:#1a1a1a; color:#fff; border-radius:16px; cursor:pointer; font-weight:600; }
.mockB .go:hover { background:#333; }
`;

const screensHTML = (active) => `
  <div class="screen ${active === 'space' ? 'on' : ''}" data-screen="space">${mainSpace}</div>
  <div class="screen ${active === 'map' ? 'on' : ''}" data-screen="map">${mainMap}</div>
  <div class="screen ${active === 'out' ? 'on' : ''}" data-screen="out">${mainOut}</div>
  <div class="screen ${active === 'live' ? 'on' : ''}" data-screen="live">${mainLive}</div>
`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Arckeep · 完整视觉稿 v0.1 · A 方向四屏</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family:"Segoe UI","Microsoft YaHei",sans-serif; background:#faf7f2; }
.app { display:grid; grid-template-columns:216px minmax(0,1fr); min-height:100vh; }
.side { padding:22px 0; display:flex; flex-direction:column; }
.brand { padding:0 20px 16px; border-bottom:1px solid #e6ddd0; margin-bottom:8px; }
.sec { padding:12px 10px 4px; }
.sec:last-of-type { padding-bottom:0; }
.main { min-width:0; }
${cssA}
${cssA2}
</style>
</head>
<body>
<div class="app mockA" id="app">
${sidebarItems('sideA', 'space')}
${screensHTML('space')}
</div>
<script>
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#2b2620;color:#faf7f2;font-size:12px;padding:9px 20px;border-radius:6px;z-index:99;';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.remove(), 2600);
}

document.querySelectorAll('.scr-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scr-btn').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.screen').forEach(x => x.classList.remove('on'));
    btn.classList.add('on');
    document.querySelector('.screen[data-screen="' + btn.dataset.scr + '"]').classList.add('on');
  });
});

document.querySelectorAll('.ag').forEach(el => {
  el.addEventListener('click', () => {
    el.closest('.launch').querySelectorAll('.ag').forEach(x => x.classList.remove('on'));
    el.classList.add('on');
  });
});

const MAP_DETAIL = {
  mn1: { name:'产品困惑', sum:'讨论 KCC 后续价值，产生 3 个候选方向。', src:'Codex · 08-25 · 摘要由你确认' },
  mn2: { name:'不变与变', sum:'确定稳定核心假设：项目是中心，Agent 可替换。产生未决问题：管理者-执行者是否是最佳多 Agent 模式？', src:'Codex · 08-26 · 摘要由你确认' },
  mn3: { name:'Session Map 探索', sum:'（推测）此分叉探讨了 Session Map 定位，但你后来说"不想往这个方向深入"。分叉保留可查，不支配现在。', src:'Claude Code · 08-26 · 推测' },
  mn4: { name:'概要设计 v0.1', sum:'写入 D-01 到 D-14。确认 Viewer 和 Session Map 两个模块。', src:'Codex · 08-27 · 摘要由你确认' },
  mn5: { name:'原型迭代', sum:'第一版被否定为看板，Kimi 交付了流程版，融合版产出。当前探索中。', src:'Codex + Kimi · 今天 · 进行中' },
};
document.querySelectorAll('.m-node').forEach(n => {
  n.addEventListener('click', () => {
    document.querySelectorAll('.m-node').forEach(x => x.classList.remove('sel'));
    n.classList.add('sel');
    const d = MAP_DETAIL[n.id];
    document.getElementById('mDetail').innerHTML = '<h3>' + d.name + '</h3><div class="sum">' + d.sum + '</div><div class="src">' + d.src + '</div>';
  });
});
document.getElementById('mn2').classList.add('sel');

const V_FILES = [
  { name:'PRODUCT_DESIGN_PHILOSOPHY.md', ext:'md', meta:'08-26 16:42 · 9.4 KB', body:'md' },
  { name:'HIGH_LEVEL_DESIGN_V0.1.md', ext:'md', meta:'08-27 10:16 · 24 KB', body:'md' },
  { name:'arckeep-open-space-v0.2.html', ext:'html', meta:'08-27 14:52 · 31 KB', body:'html' },
  { name:'arckeep-resume-flow.html', ext:'html', meta:'08-27 11:19 · 40 KB', body:'html' },
  { name:'arckeep-resume-flow-fused.html', ext:'html', meta:'08-27 13:08 · 43 KB', body:'html' },
];
const V_CHANGES = [
  { name:'arckeep-open-space-v0.2.html', ty:'mod', st:'+72 −18', meta:'14:52', diff:[
    ['ctx','/* 完整 Viewer */'],
    ['del','.file-grid { display:grid; grid-template-columns:220px minmax(0,1fr); }'],
    ['add','.viewer-shell { display:grid; grid-template-rows:auto auto minmax(0,1fr); }'],
    ['add','.viewer-body { display:grid; grid-template-columns:270px minmax(0,1fr); }'],
    ['ctx',''],
    ['del','// 旧版：硬编码 5 个文件，无模式切换，无时间机器'],
    ['add','const V_FILES = [...]'],
    ['add','const V_CHANGES = [...]'],
    ['add','const V_TM = [...]'],
  ]},
  { name:'PRODUCT_DESIGN_PHILOSOPHY.md', ty:'mod', st:'+3 −1', meta:'14:38', diff:[
    ['ctx','## 13. 一句话总结'],
    ['del','> 以用户的长期工作为中心，让项目、认知与合作经验跨越 Agent 持续演进。'],
    ['add','> 以用户的长期工作为中心，让项目、认知与合作经验跨越 Agent 持续演进；'],
    ['add','> 保留完整历史，只在正确场景唤起正确经验，以克制、透明和可替换的方式帮助用户持续进步。'],
  ]},
  { name:'arckeep-resume-flow-fused.html', ty:'del', st:'−1082', meta:'13:08', diff:[
    ['del','<!DOCTYPE html>'],
    ['del','<!-- Arckeep 继续一项工作 原型 v4 -->'],
    ['del','... (整个文件被删除)'],
  ]},
];
const V_TM = [
  { t:'概要设计 v0.1 定稿', m:'08-27 10:16 · main · a3f9c2 · 2 个文件' },
  { t:'第一版原型（看板）', m:'08-27 09:41 · main · b7e2d1 · 1 个文件' },
  { t:'Session Map 探索', m:'08-26 22:38 · 非 Git 快照 · 1 个文件' },
];

let vmode='auto', vtab='files', vsel=null, vsrc=false;
const vItems=document.getElementById('vItems'), vContent=document.getElementById('vContent'),
      vFhead=document.getElementById('vFhead'), vFn=document.getElementById('vFn'),
      vFm=document.getElementById('vFm'), vActs=document.getElementById('vActs'),
      vFilter=document.getElementById('vFilter'), vCount=document.getElementById('vCount');

function tyLabel(t){ return {add:'新增',del:'删除',mod:'修改'}[t]||t; }
function vItemsRender(){
  const q=(vFilter.value||'').toLowerCase();
  vItems.innerHTML='';
  if(vtab==='files'){
    V_FILES.filter(f=>f.name.toLowerCase().includes(q)).forEach(f=>{
      const d=document.createElement('div');
      d.className='vi'+(vsel===f.name?' on':'');
      d.innerHTML='<div class="n"><span>'+f.name+'</span><span class="ty ext">'+f.ext+'</span></div><div class="m">'+f.meta+'</div>';
      d.onclick=()=>{vsel=f.name;vsrc=false;vItemsRender();vFileRender(f);};
      vItems.appendChild(d);
    });
    vCount.textContent=V_FILES.length+' 个文件';
  } else if(vtab==='changes'){
    V_CHANGES.filter(f=>f.name.toLowerCase().includes(q)).forEach(c=>{
      const d=document.createElement('div');
      d.className='vi'+(vsel==='c:'+c.name?' on':'');
      d.innerHTML='<div class="n"><span>'+c.name+'</span><span class="ty '+c.ty+'">'+tyLabel(c.ty)+'</span></div><div class="m">'+c.st+' · '+c.meta+'</div>';
      d.onclick=()=>{vsel='c:'+c.name;vItemsRender();vChangeRender(c);};
      vItems.appendChild(d);
    });
    vCount.textContent=V_CHANGES.length+' 个本轮变化';
  } else {
    V_TM.forEach((t,i)=>{
      const d=document.createElement('div');
      d.className='tm-i'+(vsel==='tm:'+i?' on':'');
      d.innerHTML='<div class="t">'+t.t+'</div><div class="m">'+t.m+'</div>';
      d.onclick=()=>{vsel='tm:'+i;vItemsRender();vCpRender(t);};
      vItems.appendChild(d);
    });
    vCount.textContent=V_TM.length+' 个检查点';
  }
}
function vFileRender(f){
  vFhead.style.display='flex'; vFn.textContent=f.name; vFm.textContent=f.meta;
  if(f.body==='html'){
    const find = 'V_FILES.find(x=>x.name===\"'+f.name+'\")';
    vActs.innerHTML='<button class="'+(vsrc?'':'on')+'" onclick="vsrc=false;vFileRender('+find+')">预览</button>'+
      '<button class="'+(vsrc?'on':'')+'" onclick="vsrc=true;vFileRender('+find+')">源文件</button>';
    vContent.innerHTML = vsrc
      ? '<div class="v-code"><span class="ln">1</span><span class="ctx">&lt;!DOCTYPE html&gt;</span><br><span class="ln">2</span><span class="ctx">&lt;html lang="zh-CN"&gt;</span><br><span class="ln">3</span><span class="ctx">... (原型省略源码)</span></div>'
      : '<div style="border:1.5px dashed #d9cfbf;border-radius:8px;padding:40px;text-align:center;color:#c4b9a6;font-size:13px;line-height:2;">安全预览（iframe sandbox）<br>HTML 文件以只读方式渲染，脚本不执行</div>';
  } else {
    vActs.innerHTML='';
    vContent.innerHTML='<div class="v-md"><h2>Arckeep 产品设计哲学</h2><p><strong>让工作连续，让进步复利。</strong></p><p>用户每次回来，都能准确地继续工作；每一次工作，也都能成为下一次更好的起点。</p><blockquote>项目是稳定中心，Agent 是可替换工具。</blockquote><ul><li>信息完整，注意力极简</li><li>可以学习，但不能擅自立法</li><li>对可能影响结果的理解保持透明</li></ul><p>... (原型省略完整内容)</p></div>';
  }
}
function vChangeRender(c){
  vFhead.style.display='flex'; vFn.textContent=c.name; vFm.textContent=tyLabel(c.ty)+' · '+c.st+' · '+c.meta;
  vActs.innerHTML='<button onclick="toast(&quot;原型未实现打开目录&quot;)">打开目录</button>';
  vContent.innerHTML='<div class="v-code">'+c.diff.map((l,i)=>'<div><span class="ln">'+(i+1)+'</span><span class="mk">'+(l[0]==='add'?'+':l[0]==='del'?'−':' ')+'</span><span class="'+l[0]+'">'+(l[1]||'&nbsp;')+'</span></div>').join('')+'</div>';
}
function vCpRender(t){
  vFhead.style.display='flex'; vFn.textContent=t.t; vFm.textContent=t.m;
  vActs.innerHTML='<button class="gold" onclick="toast(&quot;原型未实现 Git 操作 · 仅确认后执行&quot;)">从这里继续（Git 分叉）</button>';
  vContent.innerHTML='<div class="v-code"><span class="ctx">此检查点记录了在 '+t.m.split(' · ')[0]+' 的项目状态。</span><br><span class="ctx">真实产品中可选择单个文件查看变更对比或此时内容。</span><br>&nbsp;<br><span class="ctx">从这里继续会创建隔离 Git worktree，当前分支不受影响。</span></div>';
}
document.querySelectorAll('[data-vm]').forEach(b=>{
  b.addEventListener('click',()=>{
    vmode=b.dataset.vm;
    document.querySelectorAll('[data-vm]').forEach(x=>x.classList.toggle('on',x===b));
    toast('模式：'+{auto:'自动',dev:'开发',run:'运行'}[vmode]);
  });
});
document.querySelectorAll('[data-vt]').forEach(b=>{
  b.addEventListener('click',()=>{
    vtab=b.dataset.vt; vsel=null;
    document.querySelectorAll('[data-vt]').forEach(x=>x.classList.toggle('on',x===b));
    vFhead.style.display='none';
    vContent.innerHTML='<div class="v-empty">← 从左侧选择一项</div>';
    vItemsRender();
  });
});
vFilter.addEventListener('input',()=>vItemsRender());
if(V_FILES.length){vsel=V_FILES[0].name;vItemsRender();vFileRender(V_FILES[0]);}
</script>
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('written:', OUT, ' · ', html.length, 'chars');