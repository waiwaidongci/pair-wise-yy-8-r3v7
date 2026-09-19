// 页面模块：单页前端。列表与统计只从 /api/overview 同一个快照渲染，
// 任何新增/观察/复核成功后重新拉取，保证刷新前后一致。
export function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法纸浆发酵记录</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --alert-bg:#f7e7e1; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:400px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:60px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    .checkline { display:flex; align-items:center; gap:14px; margin-top:10px; } .checkline label { display:flex; align-items:center; gap:6px; margin:0; color:var(--ink); } .checkline input { width:auto; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; } .stat.highlight strong { color:var(--accent); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.pending { background:var(--alert-bg); border-color:var(--warn); color:var(--warn); font-weight:700; } .pill.recovering { background:#fdf3df; border-color:#c89b3c; color:#8a6418; font-weight:700; } .pill.ready { background:#e7f0dd; border-color:var(--accent); color:var(--accent); font-weight:700; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:150px; overflow:auto; display:grid; gap:4px; } .warn { color:var(--warn); font-weight:700; }
    #banner { margin:0 28px; padding:0 14px; border-radius:8px; display:none; } #banner.show { display:block; padding:12px 14px; margin-top:14px; } #banner.error { background:var(--alert-bg); border:1px solid var(--warn); color:var(--warn); } #banner.ok { background:#e7f0dd; border:1px solid var(--accent); color:var(--accent); }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} #banner{margin:0 16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>古法纸浆发酵记录</h1><div class="meta">一缸一批 · 每日四项观察 · 异常双人复核闭环</div></div>
    <button id="reload">刷新</button>
  </header>
  <div id="banner" role="alert"></div>
  <main>
    <section>
      <form id="createForm">
        <h2>新增纸浆批次（入缸）</h2>
        <label>批次编号</label><input name="code" required placeholder="如 PF-002">
        <label>原料来源</label><input name="source" required placeholder="如 构树皮">
        <label>浸泡缸</label><input name="vat" required placeholder="如 三号缸">
        <label>负责人</label><input name="owner" required>
        <p class="meta">每口缸同时只能有一批发酵；缸位被占用时提交返回 409 且不落库。</p>
        <button>建档入缸</button>
      </form>

      <form id="observationForm" style="margin-top:14px">
        <h2>每日观察记录</h2>
        <label>选择批次</label><select name="id" id="observationSelect" required></select>
        <label>观察人</label><input name="observer" required>
        <label>温度</label><input name="temperature" required placeholder="如 25.1℃">
        <label>气味</label><input name="smell" required placeholder="如 微酸正常">
        <label>纤维松散度</label><input name="fiber" required placeholder="如 松散">
        <label>换水</label><select name="changedWater" required><option value="">请选择</option><option value="是">是，已换水</option><option value="否">否，未换水</option></select>
        <div class="checkline">
          <label><input type="checkbox" name="odor" value="是"> 异味</label>
          <label><input type="checkbox" name="mold" value="是"> 霉点</label>
        </div>
        <p class="meta">温度、气味、纤维松散度、换水缺项不得保存；勾选异味/霉点即转异常观察。</p>
        <button>提交观察</button>
      </form>

      <form id="reviewForm" style="margin-top:14px">
        <h2>异常复核与处置</h2>
        <label>待复核批次</label><select name="id" id="reviewSelect" required><option value="">无待复核批次</option></select>
        <label>复核人（须为另一人）</label><input name="reviewer" required>
        <label>处置措施</label><textarea name="disposal" required placeholder="如 换水翻缸、剔除霉斑、覆盖防尘…"></textarea>
        <label>复核结论</label><select name="result"><option>继续恢复观察</option><option>加严观察频次</option><option>上报师傅</option></select>
        <p class="meta">复核人不能是负责人本人或上报异常的观察人；复核后需连续两次正常且换水的观察才恢复发酵。</p>
        <button>提交复核</button>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option>
          <option>入缸</option><option>发酵中</option><option>可抄纸</option>
          <option value="异常观察·待复核">异常观察·待复核</option>
          <option value="异常观察·复核中恢复">异常观察·复核中恢复</option>
        </select>
        <input id="search" placeholder="搜索编号 / 缸位 / 负责人">
      </div>
      <div class="panel">
        <h2>批次记录</h2>
        <div class="grid" id="cards"></div>
      </div>
    </section>
  </main>
  <script>
    let batches = [];
    let stats = {};
    const $ = sel => document.querySelector(sel);

    function esc(v) {
      return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function flash(kind, text) {
      const b = $('#banner');
      b.textContent = text; b.className = 'show ' + kind;
      if (kind === 'ok') setTimeout(() => { b.className = ''; }, 3000);
    }
    async function api(path, options) {
      const res = await fetch(path, options && options.body
        ? { ...options, headers: { 'Content-Type': 'application/json' } }
        : options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.message || '请求失败'), { status: res.status, code: data.error });
      return data;
    }

    function effectiveStatus(item) {
      if (item.status === '异常观察') {
        return item.reviewState === 'pending' ? '异常观察·待复核' : '异常观察·复核中恢复';
      }
      return item.status;
    }

    function renderStats() {
      $('#stats').innerHTML = [
        ['入缸'], ['发酵中'], ['可抄纸进度'],
        ['异常观察·待复核'], ['异常观察·复核中恢复']
      ].map(([key]) => {
        const cls = key === '可抄纸进度' ? 'stat highlight' : 'stat';
        return '<div class="' + cls + '"><span>' + key + '</span><strong>' + (stats[key] || 0) + '</strong></div>';
      }).join('');
    }

    function renderSelectors() {
      const active = batches.filter(i => ['入缸','发酵中','异常观察'].includes(i.status));
      $('#observationSelect').innerHTML = active.length
        ? active.map(i => '<option value="' + esc(i.code) + '">' + esc(i.code) + ' · ' + esc(i.vat) + ' · ' + esc(effectiveStatus(i)) + '</option>').join('')
        : '<option value="">暂无可观察批次</option>';
      const pending = batches.filter(i => i.reviewState === 'pending');
      $('#reviewSelect').innerHTML = pending.length
        ? pending.map(i => '<option value="' + esc(i.code) + '">' + esc(i.code) + ' · ' + esc(i.vat) + ' · 待复核</option>').join('')
        : '<option value="">无待复核批次</option>';
    }

    function cardHtml(item) {
      const eff = effectiveStatus(item);
      const pillCls = item.reviewState === 'pending' ? 'pill pending'
        : item.reviewState === 'recovering' ? 'pill recovering'
        : item.status === '可抄纸' ? 'pill ready' : 'pill';
      let stateLine = '';
      if (item.reviewState === 'pending') stateLine = '<div class="warn">⚠ 待他人复核并填写处置，不计入可抄纸进度</div>';
      if (item.reviewState === 'recovering') stateLine = '<div class="meta">复核后恢复观察：连续正常且换水 ' + (item.recoveryStreak || 0) + '/2 次</div>';

      const obs = (item.observations || []).slice(-3).map(o =>
        '<div class="' + (o.abnormal ? 'warn' : '') + '">观察 ' + esc(o.at.slice(0, 10)) +
        '：' + esc(o.temperature) + ' / ' + esc(o.smell) + ' / ' + esc(o.fiber) +
        ' / 换水' + (o.changedWater ? '是' : '否') +
        (o.abnormal ? '（异味/霉点）' : '') + ' · ' + esc(o.observer) + '</div>'
      ).join('');
      const reviews = (item.reviews || []).slice(-2).map(r =>
        '<div class="meta">复核 ' + esc(r.at.slice(0, 10)) + '：' + esc(r.disposal) + ' · ' + esc(r.reviewer) + '</div>'
      ).join('');

      return '<article class="card">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">' + esc(item.code) + '</h3><span class="' + pillCls + '">' + eff + '</span></div>'
        + '<div class="meta">缸位：<b>' + esc(item.vat) + '</b> · 原料：' + esc(item.source) + ' · 负责人：' + esc(item.owner) + ' · 累计观察 ' + esc(item.days) + ' 天</div>'
        + stateLine
        + '<div class="logs">' + (reviews || '') + (obs || '<div class="meta">暂无观察记录</div>') + '</div>'
        + '</article>';
    }

    function renderCards() {
      const status = $('#statusFilter').value;
      const q = $('#search').value.trim();
      const visible = batches.filter(i => {
        if (status && effectiveStatus(i) !== status) return false;
        if (q && !(i.code + i.vat + i.owner + i.source).includes(q)) return false;
        return true;
      });
      $('#cards').innerHTML = visible.length ? visible.map(cardHtml).join('')
        : '<div class="meta">没有符合条件的批次</div>';
    }

    function render() {
      renderStats();
      renderSelectors();
      renderCards();
    }

    async function load() {
      const data = await api('/api/overview'); // 列表与统计同一快照
      batches = data.items;
      stats = data.stats;
      render();
    }

    function formObject(form) {
      const obj = {};
      for (const [k, v] of new FormData(form).entries()) obj[k] = v;
      return obj;
    }

    $('#createForm').onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/api/batches', { method: 'POST', body: JSON.stringify(formObject(e.target)) });
        e.target.reset(); flash('ok', '建档成功，已占用缸位'); await load();
      } catch (err) {
        flash('error', (err.status === 409 ? '缸位/编号冲突（409）：' : '保存失败：') + err.message);
      }
    };

    $('#observationForm').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      const payload = formObject(f);
      payload.odor = f.odor.checked ? '是' : '';
      payload.mold = f.mold.checked ? '是' : '';
      try {
        await api('/api/batches/' + encodeURIComponent(payload.id) + '/observations', {
          method: 'POST', body: JSON.stringify(payload)
        });
        f.reset(); flash('ok', '观察已保存'); await load();
      } catch (err) {
        flash('error', '观察未保存（' + err.status + '）：' + err.message);
      }
    };

    $('#reviewForm').onsubmit = async e => {
      e.preventDefault();
      const payload = formObject(e.target);
      if (!payload.id) return flash('error', '当前没有待复核批次');
      try {
        await api('/api/batches/' + encodeURIComponent(payload.id) + '/reviews', {
          method: 'POST', body: JSON.stringify(payload)
        });
        e.target.reset(); flash('ok', '复核处置已记录，进入恢复观察'); await load();
      } catch (err) {
        flash('error', '复核未保存（' + err.status + '）：' + err.message);
      }
    };

    $('#statusFilter').onchange = renderCards;
    $('#search').oninput = renderCards;
    $('#reload').onclick = () => load().then(() => flash('ok', '已刷新')).catch(err => flash('error', err.message));

    load().catch(err => flash('error', err.message));
  </script>
</body>
</html>`;
}
