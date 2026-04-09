/* ══════════════════════════════════════════════════════════════
   TaskTopo — 智能任务规划器
   拓扑排序 + 优先级评分调度引擎
   ══════════════════════════════════════════════════════════════ */

'use strict';

// ── State ──────────────────────────────────────────────────────
let tasks = [];
let editingTaskId  = null;
let modalTaskId    = null;
let connectMode    = false;   // graph edit mode
let connectSource  = null;    // first-clicked node id

// ── Storage ────────────────────────────────────────────────────
const STORAGE_KEY = 'taskTopo_v1';

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    tasks = raw ? JSON.parse(raw) : [];
  } catch { tasks = []; }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ── Utilities ──────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function daysUntil(deadlineStr) {
  if (!deadlineStr) return Infinity;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((new Date(deadlineStr + 'T00:00:00') - now) / 86400000);
}

function formatDeadline(deadlineStr) {
  if (!deadlineStr) return null;
  const d = daysUntil(deadlineStr);
  if (d < 0)   return { text: `${-d}d overdue`,  cls: 'overdue' };
  if (d === 0) return { text: 'Due today',        cls: 'urgent'  };
  if (d <= 3)  return { text: `Due in ${d}d`,    cls: 'urgent'  };
  return       { text: `${d} days`,              cls: ''        };
}

function wlLabel(w) { return { high: 'High', medium: 'Med', low: 'Low' }[w] ?? w; }

// Map willingness value → badge class
function wlClass(w) { return { high: 'wl-high', medium: 'wl-mid', low: 'wl-low' }[w] ?? ''; }

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Priority Scoring ───────────────────────────────────────────
// Score = willingness × 40  +  urgency (0–120)
function score(task) {
  const w = { high: 3, medium: 2, low: 1 }[task.willingness] ?? 2;
  let u = 0;
  if (task.deadline) {
    const d = daysUntil(task.deadline);
    if      (d < 0)   u = 120;
    else if (d === 0) u = 100;
    else if (d <= 3)  u = 80;
    else if (d <= 7)  u = 60;
    else if (d <= 14) u = 40;
    else if (d <= 30) u = 20;
    else              u = 5;
  }
  return w * 40 + u;
}

// ── Cycle Detection ────────────────────────────────────────────
function wouldCycle(taskId, depId) {
  const seen = new Set();
  function dfs(cur) {
    if (cur === taskId) return true;
    if (seen.has(cur))  return false;
    seen.add(cur);
    return (tasks.find(t => t.id === cur)?.dependencies ?? []).some(dfs);
  }
  return dfs(depId);
}

// ── Kahn's Topological Sort + Priority Queue ───────────────────
function computeSchedule() {
  const pending = tasks.filter(t => !t.completed);
  const done    = tasks.filter(t =>  t.completed);
  const doneSet = new Set(done.map(t => t.id));

  const inDeg    = Object.fromEntries(pending.map(t => [t.id, 0]));
  const children = Object.fromEntries(pending.map(t => [t.id, []]));

  pending.forEach(t => {
    t.dependencies.forEach(dep => {
      if (doneSet.has(dep)) return; // already satisfied
      if (inDeg[dep] !== undefined) {
        children[dep].push(t.id);
        inDeg[t.id]++;
      }
    });
  });

  let queue  = pending.filter(t => inDeg[t.id] === 0);
  const result = [];

  while (queue.length > 0) {
    queue.sort((a, b) => score(b) - score(a));
    const cur = queue.shift();
    result.push(cur);
    (children[cur.id] ?? []).forEach(cid => {
      if (--inDeg[cid] === 0) {
        const child = pending.find(t => t.id === cid);
        if (child) queue.push(child);
      }
    });
  }

  // Append cycled tasks (shouldn't occur with UI guard) and done tasks
  const seen   = new Set(result.map(t => t.id));
  const cycled = pending.filter(t => !seen.has(t.id)).sort((a,b) => score(b)-score(a));
  return [...result, ...cycled, ...done];
}

// ── Layer Computation (for graph layout) ───────────────────────
function computeLayers() {
  const memo = {};
  function depth(id) {
    if (id in memo) return memo[id];
    memo[id] = 0; // break recursion
    const t = tasks.find(x => x.id === id);
    if (!t || !t.dependencies.length) return (memo[id] = 0);
    const valid = t.dependencies.filter(d => tasks.some(x => x.id === d));
    memo[id] = valid.length ? 1 + Math.max(...valid.map(depth)) : 0;
    return memo[id];
  }
  tasks.forEach(t => depth(t.id));
  return memo;
}

// ── CRUD ───────────────────────────────────────────────────────
function createTask(data) {
  const t = {
    id: genId(),
    name: data.name.trim(),
    description: (data.description ?? '').trim(),
    deadline: data.deadline || null,
    estimatedHours: parseFloat(data.estimatedHours) || 1,
    willingness: data.willingness || 'medium',
    dependencies: [],
    completed: false,
    createdAt: new Date().toISOString(),
  };
  tasks.push(t);
  saveTasks();
  return t;
}

function updateTask(id, data) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  Object.assign(t, {
    name: data.name.trim(),
    description: (data.description ?? '').trim(),
    deadline: data.deadline || null,
    estimatedHours: parseFloat(data.estimatedHours) || 1,
    willingness: data.willingness || 'medium',
  });
  saveTasks();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  tasks.forEach(t => { t.dependencies = t.dependencies.filter(d => d !== id); });
  saveTasks();
}

function toggleComplete(id) {
  const t = tasks.find(x => x.id === id);
  if (t) { t.completed = !t.completed; saveTasks(); }
}

// ── Stats ──────────────────────────────────────────────────────
function computeStats() {
  const total   = tasks.length;
  const done    = tasks.filter(t => t.completed).length;
  const urgent  = tasks.filter(t => !t.completed && t.deadline && daysUntil(t.deadline) >= 0 && daysUntil(t.deadline) <= 3).length;
  const overdue = tasks.filter(t => !t.completed && t.deadline && daysUntil(t.deadline) < 0).length;
  const pct     = total ? Math.round((done / total) * 100) : 0;
  return { total, done, urgent, overdue, pct };
}

// ── Render: Stats Bar ──────────────────────────────────────────
function renderStats() {
  const s = computeStats();
  document.getElementById('stat-total').textContent   = s.total;
  document.getElementById('stat-done').textContent    = s.done;
  document.getElementById('stat-urgent').textContent  = s.urgent;
  document.getElementById('stat-overdue').textContent = s.overdue;
  document.getElementById('progress-fill').style.width = s.pct + '%';
  document.getElementById('progress-pct').textContent  = s.pct + '%';
}

// ── Render: Sidebar Task List ──────────────────────────────────
function renderTaskList() {
  document.getElementById('task-count').textContent = tasks.length;
  const container = document.getElementById('task-list');

  if (!tasks.length) {
    container.innerHTML = '<p style="color:var(--text-3);font-size:12px;text-align:center;padding:24px 0;">Add your first task above ✦</p>';
    return;
  }

  container.innerHTML = '';
  tasks.forEach(task => {
    const dl = formatDeadline(task.deadline);
    const depNames = task.dependencies.map(d => tasks.find(t => t.id === d)?.name).filter(Boolean);

    const el = document.createElement('div');
    el.className = 'task-item' + (task.completed ? ' completed' : '');
    el.dataset.id = task.id;
    el.innerHTML = `
      <input type="checkbox" class="task-check" ${task.completed ? 'checked' : ''} title="标记完成" />
      <div class="task-item-body">
        <div class="task-item-name${task.completed ? ' done' : ''}">${escHtml(task.name)}</div>
        <div class="task-item-meta">
          <span class="badge ${wlClass(task.willingness)}">${wlLabel(task.willingness)}</span>
          ${dl ? `<span class="badge deadline ${dl.cls}">${escHtml(dl.text)}</span>` : ''}
          <span class="badge hours">${task.estimatedHours}h</span>
          ${depNames.map(n => `<span class="badge dep">← ${escHtml(n)}</span>`).join('')}
        </div>
      </div>
      <div class="task-item-actions">
        <button class="btn-icon dep" title="管理依赖">⛓</button>
        <button class="btn-icon edit" title="编辑">✎</button>
        <button class="btn-icon del" title="删除">✕</button>
      </div>
    `;

    el.querySelector('.task-check').addEventListener('change', () => {
      toggleComplete(task.id); refresh();
    });
    el.querySelector('.btn-icon.del').addEventListener('click', () => {
      if (editingTaskId === task.id) cancelEdit();
      deleteTask(task.id);
      showToast('Task deleted'); refresh();
    });
    el.querySelector('.btn-icon.edit').addEventListener('click', () => beginEdit(task));
    el.querySelector('.btn-icon.dep').addEventListener('click', () => openDepModal(task.id));

    container.appendChild(el);
  });
}

// ── Render: Schedule ──────────────────────────────────────────
function renderSchedule() {
  const list = document.getElementById('schedule-list');
  const scheduled = computeSchedule();

  if (!scheduled.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No tasks yet</div>
        <div class="empty-sub">Add tasks on the left — the optimal order will appear here</div>
      </div>`;
    return;
  }

  list.innerHTML = '';
  let rank = 1;
  scheduled.forEach(task => {
    const dl  = formatDeadline(task.deadline);
    const s   = score(task);
    const pct = Math.min(100, Math.round((s / 240) * 100));
    const depNames = task.dependencies.map(d => tasks.find(t => t.id === d)?.name).filter(Boolean);
    const isDone   = task.completed;

    const card = document.createElement('div');
    card.className = [
      'schedule-card',
      isDone ? 'done-card' : `wl-${task.willingness === 'medium' ? 'mid' : task.willingness}`,
    ].join(' ');

    card.innerHTML = `
      <div class="rank-badge ${isDone ? 'done-rank' : 'num'}">${isDone ? '✓' : rank}</div>
      <div class="card-body">
        <div class="card-name${isDone ? ' done' : ''}">${escHtml(task.name)}</div>
        ${task.description ? `<div class="card-desc">${escHtml(task.description)}</div>` : ''}
        <div class="card-meta">
          <span class="badge ${wlClass(task.willingness)}">${wlLabel(task.willingness)}</span>
          ${dl ? `<span class="badge deadline ${dl.cls}">${escHtml(dl.text)}</span>` : ''}
          <span class="badge hours">⏱ ${task.estimatedHours}h</span>
        </div>
        ${!isDone ? `
          <div class="score-row">
            <span class="score-lbl">Priority</span>
            <div class="score-track"><div class="score-fill" style="width:${pct}%"></div></div>
            <span class="score-val">${s} pts</span>
          </div>` : ''}
        ${depNames.length ? `
          <div class="card-deps">Requires: <strong>${depNames.map(escHtml).join(' → ')}</strong></div>
        ` : ''}
      </div>
    `;

    list.appendChild(card);
    if (!isDone) rank++;
  });
}

// ── Connect Mode ───────────────────────────────────────────────
function toggleConnectMode() {
  connectMode = !connectMode;
  connectSource = null;
  const btn = document.getElementById('btn-connect-mode');
  const container = document.getElementById('graph-container');
  btn.classList.toggle('active', connectMode);
  container.classList.toggle('connect-mode', connectMode);
  updateConnectHint();
  renderGraph();
}

function updateConnectHint() {
  const hint = document.getElementById('connect-hint');
  if (!connectMode) { hint.classList.add('hidden'); return; }
  hint.classList.remove('hidden');
  if (connectSource === null) {
    hint.innerHTML = '⛓ <strong>Connect mode</strong>: click the task that needs to wait for another <span class="hint-esc" id="hint-esc-btn">Exit ✕</span>';
  } else {
    const src = tasks.find(t => t.id === connectSource);
    hint.innerHTML = `✦ Selected <strong>${escHtml(src?.name ?? '')}</strong> — click another node to link, or click the same node to cancel <span class="hint-esc" id="hint-esc-btn">Exit ✕</span>`;
  }
  document.getElementById('hint-esc-btn')?.addEventListener('click', () => {
    connectMode = false; connectSource = null;
    document.getElementById('btn-connect-mode').classList.remove('active');
    document.getElementById('graph-container').classList.remove('connect-mode');
    updateConnectHint();
    renderGraph();
  });
}

// ── Render: Graph ──────────────────────────────────────────────
function renderGraph() {
  const svg = document.getElementById('dependency-graph');
  const W   = svg.clientWidth  || 700;
  const H   = svg.clientHeight || 420;
  svg.innerHTML = '';

  // Remove old tooltips
  document.querySelectorAll('#graph-container .graph-tooltip').forEach(el => el.remove());

  if (!tasks.length) {
    const t = svgEl('text');
    t.setAttribute('x', W / 2); t.setAttribute('y', H / 2);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', 'var(--text-3)'); t.setAttribute('font-size', '14');
    t.setAttribute('font-family', 'system-ui,sans-serif');
    t.textContent = 'No tasks — add one in the sidebar first';
    svg.appendChild(t);
    return;
  }

  const layers    = computeLayers();
  const numLayers = Math.max(...Object.values(layers), 0) + 1;
  const byLayer   = {};
  tasks.forEach(t => { const l = layers[t.id] ?? 0; (byLayer[l] ??= []).push(t); });

  // Node dimensions
  const NW = 110, NH = 38, PX = 80, PY = 60;
  const positions = {};

  for (let l = 0; l < numLayers; l++) {
    const group = byLayer[l] ?? [];
    const x = numLayers === 1
      ? W / 2
      : PX + l * ((W - PX * 2) / (numLayers - 1));

    group.forEach((t, i) => {
      const y = group.length === 1
        ? H / 2
        : PY + i * ((H - PY * 2) / (group.length - 1));
      positions[t.id] = { x, y };
    });
  }

  // Defs: arrowhead + drop shadow
  const defs = svgEl('defs');

  const filter = svgEl('filter');
  filter.setAttribute('id', 'node-shadow');
  filter.setAttribute('x', '-20%'); filter.setAttribute('y', '-30%');
  filter.setAttribute('width', '140%'); filter.setAttribute('height', '160%');
  const fe = svgEl('feDropShadow');
  fe.setAttribute('dx', '0'); fe.setAttribute('dy', '4');
  fe.setAttribute('stdDeviation', '6'); fe.setAttribute('flood-color', 'rgba(0,0,0,.5)');
  filter.appendChild(fe);
  defs.appendChild(filter);

  const marker = svgEl('marker');
  marker.setAttribute('id', 'arrow');
  marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '8'); marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const poly = svgEl('polygon');
  poly.setAttribute('points', '0 0, 8 3, 0 6');
  poly.setAttribute('fill', 'var(--text-3)');
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Edges
  tasks.forEach(task => {
    task.dependencies.forEach(depId => {
      const from = positions[depId];
      const to   = positions[task.id];
      if (!from || !to) return;

      const x1 = from.x + NW / 2, y1 = from.y;
      const x2 = to.x   - NW / 2, y2 = to.y;
      const cx  = (x1 + x2) / 2;

      const path = svgEl('path');
      path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      path.setAttribute('stroke', 'var(--border-light)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arrow)');
      svg.appendChild(path);
    });
  });

  // Nodes
  const colorMap = { high: 'var(--wl-high)', medium: 'var(--wl-mid)', low: 'var(--wl-low)' };

  tasks.forEach(task => {
    const pos   = positions[task.id];
    if (!pos) return;
    const color = task.completed ? 'var(--text-3)' : (colorMap[task.willingness] ?? 'var(--purple)');
    const s     = score(task);

    const g = svgEl('g');
    g.setAttribute('transform', `translate(${pos.x - NW / 2},${pos.y - NH / 2})`);
    g.style.cursor = 'pointer';

    // Selected source node ring
    if (connectMode && connectSource === task.id) {
      const ring = svgEl('rect');
      ring.setAttribute('x', '-6'); ring.setAttribute('y', '-6');
      ring.setAttribute('width', NW + 12); ring.setAttribute('height', NH + 12);
      ring.setAttribute('rx', '15');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', 'white'); ring.setAttribute('stroke-width', '2.5');
      ring.setAttribute('stroke-dasharray', '6 3');
      ring.setAttribute('opacity', '0.9');
      g.appendChild(ring);
    }

    // Glow
    if (!task.completed) {
      const glow = svgEl('rect');
      glow.setAttribute('x', '-4'); glow.setAttribute('y', '-4');
      glow.setAttribute('width', NW + 8); glow.setAttribute('height', NH + 8);
      glow.setAttribute('rx', '13');
      glow.setAttribute('fill', color); glow.setAttribute('opacity', '0.15');
      g.appendChild(glow);
    }

    // Main rect
    const rect = svgEl('rect');
    rect.setAttribute('width', NW); rect.setAttribute('height', NH);
    rect.setAttribute('rx', '10');
    rect.setAttribute('fill', color);
    rect.setAttribute('opacity', task.completed ? '0.4' : '1');
    rect.setAttribute('filter', 'url(#node-shadow)');
    g.appendChild(rect);

    // Label
    const label = task.name.length > 11 ? task.name.slice(0, 11) + '…' : task.name;
    const txt = svgEl('text');
    txt.setAttribute('x', NW / 2); txt.setAttribute('y', NH / 2);
    txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('dominant-baseline', 'middle');
    txt.setAttribute('fill', 'white'); txt.setAttribute('font-size', '11');
    txt.setAttribute('font-weight', '700'); txt.setAttribute('font-family', 'Inter,system-ui,sans-serif');
    txt.setAttribute('pointer-events', 'none');
    txt.textContent = label;
    g.appendChild(txt);

    // Score badge (top-right corner)
    const bx = NW - 2, by = 0;
    const badgeCircle = svgEl('circle');
    badgeCircle.setAttribute('cx', bx); badgeCircle.setAttribute('cy', by);
    badgeCircle.setAttribute('r', '13');
    badgeCircle.setAttribute('fill', 'var(--surface)');
    badgeCircle.setAttribute('stroke', color); badgeCircle.setAttribute('stroke-width', '1.5');
    g.appendChild(badgeCircle);

    const badgeTxt = svgEl('text');
    badgeTxt.setAttribute('x', bx); badgeTxt.setAttribute('y', by);
    badgeTxt.setAttribute('text-anchor', 'middle'); badgeTxt.setAttribute('dominant-baseline', 'middle');
    badgeTxt.setAttribute('fill', color); badgeTxt.setAttribute('font-size', '9');
    badgeTxt.setAttribute('font-weight', '800'); badgeTxt.setAttribute('font-family', 'Inter,system-ui,sans-serif');
    badgeTxt.setAttribute('pointer-events', 'none');
    badgeTxt.textContent = s;
    g.appendChild(badgeTxt);

    // Hover tooltip
    const tip = document.createElement('div');
    tip.className = 'graph-tooltip';
    tip.innerHTML = `
      <strong>${escHtml(task.name)}</strong>
      <div class="tt-row">Willingness: ${wlLabel(task.willingness)}</div>
      <div class="tt-row">Priority: ${s} pts</div>
      ${task.deadline ? `<div class="tt-row">Deadline: ${task.deadline}</div>` : ''}
      ${task.completed ? `<div class="tt-row" style="color:var(--green)">✓ Completed</div>` : ''}
      <div class="tt-row" style="color:var(--purple-light);margin-top:4px" id="tip-dep-${task.id}"></div>
    `;
    document.getElementById('graph-container').appendChild(tip);

    g.addEventListener('mouseenter', e => {
      if (connectMode) {
        const depTip = tip.querySelector(`#tip-dep-${task.id}`);
        if (depTip) {
          if (connectSource === null) depTip.textContent = 'Click to select as source';
          else if (connectSource === task.id) depTip.textContent = '(selected)';
          else {
            const src = tasks.find(t => t.id === connectSource);
            const already = src?.dependencies.includes(task.id);
            const cycle   = wouldCycle(connectSource, task.id);
            depTip.textContent = cycle ? '⚠ Would create a cycle'
              : already ? 'Click to remove this dependency'
              : `Click: ${escHtml(src?.name ?? '')} depends on this`;
          }
        }
      }
      const cr = document.getElementById('graph-container').getBoundingClientRect();
      tip.style.left = (e.clientX - cr.left + 14) + 'px';
      tip.style.top  = (e.clientY - cr.top  + 14) + 'px';
      tip.classList.add('visible');
    });
    g.addEventListener('mouseleave', () => tip.classList.remove('visible'));

    // Click: connect mode logic
    g.addEventListener('click', () => {
      if (!connectMode) return;
      if (connectSource === null) {
        // First click — select source
        connectSource = task.id;
        updateConnectHint();
        renderGraph();
      } else if (connectSource === task.id) {
        // Clicked same node — deselect
        connectSource = null;
        updateConnectHint();
        renderGraph();
      } else {
        // Second click — create or remove dependency
        const src = tasks.find(t => t.id === connectSource);
        if (!src) return;
        if (wouldCycle(connectSource, task.id)) {
          showToast('⚠ Circular dependency — connection cancelled', 'error');
          connectSource = null;
          updateConnectHint();
          renderGraph();
          return;
        }
        const alreadyIdx = src.dependencies.indexOf(task.id);
        if (alreadyIdx !== -1) {
          src.dependencies.splice(alreadyIdx, 1);
          showToast(`Removed: ${src.name} → ${task.name}`);
        } else {
          src.dependencies.push(task.id);
          showToast(`Linked: ${src.name} depends on ${task.name}`, 'success');
        }
        saveTasks();
        connectSource = null;
        updateConnectHint();
        refresh();
      }
    });

    svg.appendChild(g);
  });
}

// ── Dep Modal ──────────────────────────────────────────────────
function openDepModal(taskId) {
  modalTaskId = taskId;
  const task  = tasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('modal-task-name').textContent = task.name;
  const list   = document.getElementById('dep-list');
  const others = tasks.filter(t => t.id !== taskId);
  list.innerHTML = '';

  if (!others.length) {
    list.innerHTML = '<p style="color:var(--text-3);font-size:13px;">No other tasks available to set as prerequisites.</p>';
  } else {
    others.forEach(other => {
      const cycle   = wouldCycle(taskId, other.id);
      const checked = task.dependencies.includes(other.id);
      const dl      = formatDeadline(other.deadline);

      const row = document.createElement('label');
      row.className = 'dep-option' + (cycle ? ' cycle-disabled' : '');
      row.title     = cycle ? '⚠ Would create a circular dependency' : '';
      row.innerHTML = `
        <input type="checkbox" value="${other.id}" ${checked ? 'checked' : ''} ${cycle ? 'disabled' : ''} />
        <span class="dep-option-name">${escHtml(other.name)}</span>
        <span class="badge ${wlClass(other.willingness)}">${wlLabel(other.willingness)}</span>
        ${dl ? `<span class="badge deadline ${dl.cls}">${escHtml(dl.text)}</span>` : ''}
      `;
      list.appendChild(row);
    });
  }

  document.getElementById('dep-modal').classList.remove('hidden');
}

function closeDepModal() {
  document.getElementById('dep-modal').classList.add('hidden');
  modalTaskId = null;
}

function saveDepModal() {
  if (!modalTaskId) return;
  const deps = [...document.querySelectorAll('#dep-list input[type="checkbox"]:checked')]
    .map(cb => cb.value);
  const t = tasks.find(x => x.id === modalTaskId);
  if (t) { t.dependencies = deps; saveTasks(); }
  closeDepModal();
  showToast('Dependencies updated', 'success');
  refresh();
}

// ── Form ───────────────────────────────────────────────────────
function readForm() {
  return {
    name:           document.getElementById('f-name').value,
    description:    document.getElementById('f-desc').value,
    deadline:       document.getElementById('f-deadline').value,
    estimatedHours: document.getElementById('f-hours').value,
    willingness:    document.querySelector('input[name="wl"]:checked')?.value ?? 'medium',
  };
}

function resetForm() {
  document.getElementById('task-form').reset();
  document.querySelector('input[name="wl"][value="medium"]').checked = true;
  document.getElementById('f-hours').value = '2';
  editingTaskId = null;
  document.getElementById('form-submit-btn').textContent = '+ Add Task';
  document.getElementById('form-submit-btn').classList.remove('editing');
  document.getElementById('form-icon').textContent    = '✦';
  document.getElementById('form-heading').textContent = 'New Task';
}

function beginEdit(task) {
  editingTaskId = task.id;
  document.getElementById('f-name').value     = task.name;
  document.getElementById('f-desc').value     = task.description;
  document.getElementById('f-deadline').value = task.deadline ?? '';
  document.getElementById('f-hours').value    = task.estimatedHours;
  (document.querySelector(`input[name="wl"][value="${task.willingness}"]`) ?? {}).checked = true;
  document.getElementById('form-submit-btn').textContent = '✎ Save Changes';
  document.getElementById('form-submit-btn').classList.add('editing');
  document.getElementById('form-icon').textContent    = '✎';
  document.getElementById('form-heading').textContent = 'Edit Task';
  document.getElementById('f-name').focus();
}

function cancelEdit() { resetForm(); }

function handleSubmit(e) {
  e.preventDefault();
  const data = readForm();
  if (!data.name.trim()) { showToast('Please enter a task name', 'error'); return; }

  if (editingTaskId) {
    updateTask(editingTaskId, data);
    showToast('Task updated');
  } else {
    createTask(data);
    showToast('Task added ✦', 'success');
  }

  resetForm();
  refresh();
}

// ── Toast ──────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'visible' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.className = 'hidden', 220);
  }, 2400);
}

// ── Tabs ───────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'graph') renderGraph();
    });
  });
}

// ── SVG Helper ─────────────────────────────────────────────────
function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

// ── Full Refresh ───────────────────────────────────────────────
function refresh() {
  renderStats();
  renderTaskList();
  renderSchedule();
  if (document.getElementById('tab-graph').classList.contains('active')) renderGraph();
}

// ── Event Wiring ───────────────────────────────────────────────
function initEvents() {
  document.getElementById('task-form').addEventListener('submit', handleSubmit);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    renderSchedule(); showToast('Schedule computed ✦', 'success');
  });
  document.getElementById('btn-run-algo').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="schedule"]').click();
    renderSchedule(); showToast('Schedule computed ✦', 'success');
  });
  document.getElementById('btn-connect-mode').addEventListener('click', toggleConnectMode);

  document.getElementById('modal-close').addEventListener('click', closeDepModal);
  document.getElementById('modal-cancel').addEventListener('click', closeDepModal);
  document.getElementById('modal-save').addEventListener('click', saveDepModal);
  document.getElementById('dep-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('dep-modal')) closeDepModal();
  });

  // Graph resize
  new ResizeObserver(() => {
    if (document.getElementById('tab-graph').classList.contains('active')) renderGraph();
  }).observe(document.getElementById('graph-container'));

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('dep-modal').classList.contains('hidden')) closeDepModal();
      else if (connectMode) {
        connectMode = false; connectSource = null;
        document.getElementById('btn-connect-mode').classList.remove('active');
        document.getElementById('graph-container').classList.remove('connect-mode');
        updateConnectHint(); renderGraph();
      }
      else if (editingTaskId) cancelEdit();
    }
  });
}

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
  initTabs();
  initEvents();
  refresh();
});
