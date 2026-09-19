// 视图模块：只负责生成页面 HTML，所有数据与规则均来自接口。
export function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法纸浆发酵记录</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --bar:#7a9c63; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:400px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:64px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .progress { margin-bottom:14px; background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px 16px; } .progress-track { height:12px; background:#e7ece3; border-radius:999px; overflow:hidden; margin-top:6px; } .progress-bar { height:100%; background:var(--bar); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.warn { color:var(--warn); border-color:var(--warn); } .casebox { border:1px dashed var(--warn); border-radius:6px; padding:8px 10px; font-size:13px; } .warn { color:var(--warn); font-weight:700; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:130px; overflow:auto; font-size:13px; }
    .hint { color:var(--muted); font-size:12px; margin:6px 0 0; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法纸浆发酵记录</h1><div class="meta">缸位排他 · 每日观察 · 异常复核闭环</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增纸浆批次</h2>
        <label>批次编号</label><input name="code" required>
        <label>原料来源</label><input name="source" required>
        <label>浸泡缸</label><input name="vat" list="vatList" required><datalist id="vatList"></datalist>
        <label>负责人</label><input name="owner" required>
        <p class="hint">每口缸同时只能有一批在缸（入缸/发酵中/异常观察均占缸），冲突提交返回 409 且不落库；可抄纸后缸位释放。</p>
        <button>保存纸浆批次</button>
      </form>
      <form id="observeForm" style="margin-top:14px"><h2>每日观察记录</h2>
        <label>选择纸浆批次</label><select name="id" id="observeSelect"></select>
        <label>观察人</label><input name="observer" required>
        <label>温度（℃）</label><input name="temperature" required>
        <label>气味</label><input name="smell" placeholder="如：微酸 / 正常" required>
        <label>纤维松散度</label><input name="fiber" placeholder="如：开始松散 / 松散" required>
        <label>换水</label><select name="changedWater" required><option value="">请选择</option><option value="是">已换水</option><option value="否">未换水</option></select>
        <label>异味或霉点</label><select name="abnormal" required><option value="">请选择</option><option value="否">无（正常）</option><option value="是">有异味或霉点（转异常观察）</option></select>
        <p class="hint">四项观察缺项不得保存；勾选异常只能转异常观察，由另一人复核处置，连续两次正常且完成换水才恢复发酵。</p>
        <button>提交观察</button>
      </form>
      <form id="reviewForm" style="margin-top:14px"><h2>异常复核处置</h2>
        <label>待复核批次</label><select name="id" id="reviewSelect"></select>
        <label>复核人（须与上报人不同）</label><input name="reviewer" required>
        <label>处置措施</label><textarea name="disposal" placeholder="如：翻缸、换水、去除霉变层……" required></textarea>
        <p class="hint">复核后批次仍为异常观察；连续 2 次正常观察且完成换水才恢复发酵，期间不计入可抄纸进度。</p>
        <button>提交复核</button>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="progress"><strong>可抄纸进度</strong><span class="meta" id="progressText"></span><div class="progress-track"><div class="progress-bar" id="progressBar" style="width:0%"></div></div><p class="hint" id="pendingText"></p></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option><option value="入缸">入缸</option><option value="发酵中">发酵中</option><option value="异常观察">异常观察</option><option value="__pending">仅待复核</option><option value="可抄纸">可抄纸</option></select><input id="search" placeholder="搜索编号、缸位或关键词"></div>
      <div class="panel"><h2>批次记录</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    let items = [], stats = null;
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{'Content-Type':'application/json'} } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(describe(data));
      return data;
    }
    const MESSAGES = {
      vat_occupied: d => d.message || '该缸已有在缸批次，提交被拒绝（409，未保存）',
      code_duplicated: () => '批次编号已存在（409，未保存）',
      missing_fields: () => '存在缺项：温度、气味、纤维松散度、换水必须全部填写',
      review_required: () => '异常批次须先由另一人复核并填写处置，才能继续正常观察',
      reviewer_must_be_different: () => '复核人必须与上报人不是同一人',
      no_pending_review: () => '该批次没有待复核的异常观察',
      batch_ready: () => '该批次已可抄纸，不再接受观察',
      field_protected: () => '状态只能由观察/复核流程驱动，不能手动修改'
    };
    function describe(data) { return (MESSAGES[data.code] && MESSAGES[data.code](data)) || data.message || data.error || '请求失败'; }
    function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

    function renderStats() {
      if (!stats) return;
      statsEl.innerHTML = Object.entries(stats.counts).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      progressBar.style.width = stats.progress + '%';
      progressText.textContent = '：' + stats.readyCount + ' / ' + stats.progressDenominator + ' 批（' + stats.progress + '%，待复核批次不计入）';
      pendingText.textContent = stats.pendingReview ? '⚠ 当前有 ' + stats.pendingReview + ' 批待复核，缸位：' + stats.occupiedVats.map(v => v.vat + '(' + v.code + ')').join('、') : '在缸缸位：' + (stats.occupiedVats.map(v => v.vat + '(' + v.code + ')').join('、') || '无');
      document.querySelector('#vatList').innerHTML = [...new Set(items.map(i => i.vat))].map(v => '<option value="'+esc(v)+'">').join('');
    }
    function renderSelectors() {
      const observeItems = items.filter(i => i.status !== '可抄纸');
      observeSelect.innerHTML = observeItems.map(i => '<option value="'+esc(i.id)+'">'+esc(i.code)+' · '+esc(i.vat)+' · '+esc(i.status)+'</option>').join('') || '<option value="">暂无可观察批次</option>';
      const pending = items.filter(i => i.pendingReview);
      reviewSelect.innerHTML = pending.map(i => '<option value="'+esc(i.id)+'">'+esc(i.code)+' · '+esc(i.vat)+' · 上报人 '+esc(i.abnormalCase.reporter)+'</option>').join('') || '<option value="">暂无待复核批次</option>';
      reviewForm.querySelector('button').disabled = pending.length === 0;
    }
    function cardHtml(item) {
      const casebox = item.abnormalCase ? '<div class="casebox">' +
        (item.abnormalCase.review
          ? '<div>已复核：'+esc(item.abnormalCase.review.reviewer)+' → '+esc(item.abnormalCase.review.disposal)+'</div><div class="meta">连续正常换水 '+item.normalStreak+'/2 次后恢复发酵</div>'
          : '<div class="warn">待复核：'+esc(item.abnormalCase.reporter)+' 上报异味/霉点</div><div class="meta">'+esc(item.abnormalCase.smell)+'，'+esc(item.abnormalCase.fiber)+'</div>') +
        '</div>' : '';
      const obs = (item.observations || []).slice(-4).map(o => '<div>'+esc(o.date)+' '+esc(o.observer)+'：'+esc(o.temperature)+'℃，'+esc(o.smell)+'，'+esc(o.fiber)+'，'+(o.changedWater?'已换水':'未换水')+(o.abnormal?'，<span class="warn">异常</span>':'')+'</div>').join('');
      return '<article class="card"><h3>'+esc(item.code)+'</h3><span class="pill'+(item.pendingReview?' warn':'')+'">'+esc(item.status)+(item.pendingReview?' · 待复核':'')+'</span>'
        + '<div><b>原料</b> '+esc(item.source)+'</div><div><b>浸泡缸</b> '+esc(item.vat)+'</div><div><b>发酵天数</b> '+item.days+' / 7</div><div><b>负责人</b> '+esc(item.owner)+'</div>'
        + casebox
        + '<button class="secondary" type="button" data-note="'+esc(item.id)+'">追加备注</button>'
        + '<div class="logs meta">'+(obs || '暂无观察记录')+'</div></article>';
    }
    function render() {
      renderStats(); renderSelectors();
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => {
        if (status === '__pending') { if (!item.pendingReview) return false; }
        else if (status && item.status !== status) return false;
        return !q || JSON.stringify(item).includes(q);
      });
      cards.innerHTML = visible.map(cardHtml).join('');
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => {
        const note = prompt('记录备注');
        if (note) { try { await api('/api/items/'+btn.dataset.note+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } catch (e) { alert(e.message); } }
      });
    }
    async function load() {
      [items, stats] = await Promise.all([api('/api/items'), api('/api/stats')]);
      render();
    }
    async function submit(form, path) {
      try { await api(path, { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); form.reset(); await load(); }
      catch (e) { alert(e.message); }
    }
    createForm.onsubmit = e => { e.preventDefault(); submit(createForm, '/api/items'); };
    observeForm.onsubmit = e => { e.preventDefault(); submit(observeForm, '/api/items/'+observeSelect.value+'/observations'); };
    reviewForm.onsubmit = e => { e.preventDefault(); if (!reviewSelect.value) return alert('暂无待复核批次'); submit(reviewForm, '/api/items/'+reviewSelect.value+'/review'); };
    document.querySelector('#statusFilter').onchange = render;
    document.querySelector('#search').oninput = render;
    document.querySelector('#reload').onclick = load;
    load();
  </script>
</body>
</html>`;
}
