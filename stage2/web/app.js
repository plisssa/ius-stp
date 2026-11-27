'use strict';
// Интерфейс ИУС СТП: вход, портал клиента, очередь инженера, отчёты, уведомления.

const $ = id => document.getElementById(id);
let S = null;            // сессия: пользователь и справочники
let busy = false;
let timer = null;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function toast(text) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {cache: 'no-store'} :
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') { S = null; route(); throw Error('Нужен вход'); }
  if (!r.ok) throw Error(data.message || 'Запрос не выполнен');
  return data;
}

const tz = () => S.sla['ORG-A'].tz;
const fmt = (s, opts) => s ? new Date(s * 1000).toLocaleString('ru-RU', {timeZone: tz(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...opts}) : '—';
const has = role => S && S.roles.includes(role);
const statusClass = s => s === 'Waiting for support' ? 'st-support' : s === 'Waiting for customer' ? 'st-customer' : 'st-closed';
const statusPill = s => h('span', {class: 'pill ' + statusClass(s)}, s);
const prioPill = p => h('span', {class: 'pill ' + p}, p);

function left(seconds) {
  const m = Math.ceil(Math.abs(seconds) / 60);
  const d = Math.floor(m / 1440), hh = Math.floor(m % 1440 / 60), mm = m % 60;
  return (d ? d + ' д ' : '') + (d || hh ? hh + ' ч ' : '') + mm + ' мин';
}

function slaBadge(t) {
  if (t.answered) return h('span', {class: 'sla done'}, t.answered <= t.deadline ? 'ответ в срок' : 'ответ с опозданием');
  if (t.status === 'Closed') return h('span', {class: 'sla done'}, 'закрыта');
  const rest = t.deadline - Date.now() / 1000;
  if (rest <= 0) return h('span', {class: 'sla late'}, 'просрочено на ' + left(rest));
  return h('span', {class: 'sla ' + (rest <= 3600 ? 'warn' : 'ok')}, 'осталось ' + left(rest));
}

function hoursLabel(org) {
  const c = S.sla[org];
  return c.hours === 'working' ? `рабочие часы ${c.start}:00–${c.end}:00 МСК` : 'календарные часы';
}

// ---------------------------------------------------------------- маршрутизация
const VIEWS = [
  {hash: '#/portal', title: 'Портал клиента', role: 'client', render: portal},
  {hash: '#/queue', title: 'Очередь', role: 'engineer', render: queue},
  {hash: '#/reports', title: 'Отчёты и KPI', role: 'head', alt: 'engineer', render: reportsView},
  {hash: '#/notifications', title: 'Уведомления', role: 'engineer', render: notificationsView},
];

function nav() {
  const allowed = VIEWS.filter(v => has(v.role) || (v.alt && has(v.alt)));
  const current = location.hash.split('/').slice(0, 2).join('/');
  $('nav').replaceChildren(...allowed.map(v => h('a', {href: v.hash, 'aria-current': current === v.hash ? 'page' : false}, v.title)));
  $('who').replaceChildren(h('span', {}, S.name), S.local ? '' : h('button', {onclick: logout}, 'Выйти'));
  return allowed;
}

async function route() {
  clearInterval(timer);
  if (!S) {
    try { S = await api('/api/session'); } catch { return loginView(); }
  }
  const allowed = nav();
  const current = location.hash.split('/').slice(0, 2).join('/');
  const view = allowed.find(v => v.hash === current) || allowed.find(v => v.role === 'engineer') || allowed[0];
  if (!view) return $('view').replaceChildren(h('p', {class: 'blank'}, 'Для вашей учётной записи нет доступных разделов.'));
  if (view.hash !== current) { history.replaceState(null, '', view.hash); nav(); }
  document.title = view.title + ' · СТП';
  await view.render(location.hash.split('/')[2]);
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

// ---------------------------------------------------------------- вход
function loginView() {
  $('nav').replaceChildren(); $('who').replaceChildren();
  document.title = 'Вход · СТП';
  if (window.top !== window.self) {
    return $('view').replaceChildren(h('div', {class: 'login'}, h('div', {class: 'card stack'},
      h('h1', {}, 'Служба технической поддержки'),
      h('p', {}, 'Сервис открывается в отдельной вкладке: так браузер сохранит вход.'),
      h('a', {href: location.href, target: '_blank', rel: 'noopener'}, h('button', {class: 'primary'}, 'Открыть сервис')))));
  }
  const err = h('p', {class: 'error', role: 'alert'});
  const login = h('input', {id: 'login', autocomplete: 'username', required: true});
  const pass = h('input', {id: 'password', type: 'password', autocomplete: 'current-password', required: true});
  const form = h('form', {class: 'card', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { await api('/api/login', {login: login.value.trim(), password: pass.value}); S = null; pass.value = ''; await route(); }
    catch (x) { err.textContent = x.message; }
  }},
    h('h1', {}, 'Вход'),
    h('p', {class: 'muted'}, 'Учебный сервис обработки обращений в службу технической поддержки (вариант 12).'),
    h('label', {class: 'label', for: 'login'}, 'Логин'), login,
    h('label', {class: 'label', for: 'password'}, 'Пароль'), pass,
    err, h('button', {class: 'primary', type: 'submit'}, 'Войти'));
  $('view').replaceChildren(h('div', {class: 'login'}, form));
  login.focus();
}

async function logout() {
  await api('/api/logout', {}).catch(() => {});
  S = null; history.replaceState(null, '', '#/'); loginView();
}

// ---------------------------------------------------------------- портал клиента
async function portal(selected) {
  const sel = (id, items, value) => h('select', {id}, items.map(i => h('option', {value: i, selected: i === value}, i)));
  const contract = S.sla[S.org];
  const prio = sel('prio', S.priorities, 'P3');
  const hint = h('p', {class: 'hint'});
  const showHint = () => hint.textContent = `Первый ответ — за ${contract.norms[prio.value]} ч (${hoursLabel(S.org)}). Новая заявка получает номер ES-XXXX, статус «Waiting for support» и исполнителя «Unassigned».`;
  prio.addEventListener('change', showHint); showHint();
  const title = h('input', {id: 'title', maxlength: 200, required: true, placeholder: 'Коротко о проблеме'});
  const body = h('textarea', {id: 'body', maxlength: 4000, required: true, placeholder: 'Что произошло, когда, текст ошибки'});
  const topic = sel('topic', S.topics), type = sel('type', S.types, 'Ошибка');
  const form = h('form', {class: 'card', onsubmit: async e => {
    e.preventDefault();
    if (busy) return; busy = true;
    try {
      const r = await api('/api/tickets', {title: title.value, body: body.value, topic: topic.value, type: type.value, priority: prio.value});
      toast(r.message); title.value = ''; body.value = '';
      location.hash = '#/portal/' + r.id;
    } catch (x) { toast(x.message); } finally { busy = false; }
  }},
    h('h2', {}, 'Новое обращение'),
    h('label', {class: 'label', for: 'title'}, 'Тема'), title,
    h('div', {class: 'row'},
      h('div', {class: 'grow'}, h('label', {class: 'label', for: 'topic'}, 'Категория'), topic),
      h('div', {class: 'grow'}, h('label', {class: 'label', for: 'type'}, 'Тип обращения'), type)),
    h('label', {class: 'label', for: 'prio'}, 'Приоритет'), prio,
    h('label', {class: 'label', for: 'body'}, 'Описание'), body, hint,
    h('div', {class: 'row spread'}, h('small', {}, S.name + ' · ' + S.org), h('button', {class: 'primary', type: 'submit'}, 'Send')));
  const side = h('section', {class: 'stack'});
  $('view').replaceChildren(h('div', {class: 'portal'}, form, side));
  const load = async () => {
    const rows = await api('/api/tickets?view=client');
    const list = h('div', {class: 'mine'}, rows.length ? rows.map(t => h('a', {href: '#/portal/' + t.id, class: 'item', 'aria-current': t.id === selected ? 'true' : false},
      h('div', {class: 'row spread'}, h('small', {}, t.id + ' · ' + fmt(t.registered)), statusPill(t.status)),
      h('strong', {}, t.title), h('small', {}, t.answered ? 'Инженер ответил' : 'Ответ до ' + fmt(t.deadline)))) :
      h('p', {class: 'blank'}, 'Обращений пока нет. Заполните форму слева.'));
    const parts = [h('div', {class: 'card'}, h('div', {class: 'row spread'}, h('h2', {}, 'Обращения организации'), h('small', {}, S.org)), h('div', {class: 'stack'}, list))];
    if (selected) parts.unshift(await clientTicket(selected));
    side.replaceChildren(...parts);
  };
  await load();
  timer = setInterval(() => { if (!document.hidden && !document.activeElement?.matches('textarea,input')) load().catch(() => {}); }, 20000);
}

async function clientTicket(id) {
  let t;
  try { t = await api('/api/tickets/' + id + '?view=client'); } catch (x) { return h('p', {class: 'blank'}, x.message); }
  const text = h('textarea', {placeholder: 'Сообщение инженеру', maxlength: 2000});
  const act = (action, needText) => async () => {
    if (needText && !text.value.trim()) return toast('Напишите сообщение');
    try { await api(`/api/tickets/${id}/client`, {action, text: text.value}); toast('Готово'); route(); } catch (x) { toast(x.message); }
  };
  const buttons = [];
  if (t.status === 'Waiting for customer') buttons.push(h('button', {class: 'primary', onclick: act('Помогло')}, 'Помогло, закрыть'), h('button', {onclick: act('Не помогло')}, 'Не помогло'));
  if (t.status !== 'Closed') buttons.push(h('button', {onclick: act('Ответ', true)}, 'Отправить сообщение'));
  const reopen = t.status === 'Closed' && Date.now() / 1000 - t.closed <= 14 * 86400;
  return h('article', {class: 'card stack'},
    h('div', {class: 'row spread'}, h('div', {class: 'row'}, h('b', {}, t.id), prioPill(t.priority), statusPill(t.status)), h('a', {href: '#/portal'}, 'Закрыть карточку')),
    h('h2', {}, t.title),
    h('small', {}, t.status === 'Closed' ? 'Закрыта ' + fmt(t.closed) + ' · ' + t.close_reason : t.answered ? 'Первый ответ ' + fmt(t.answered) : 'Первый ответ до ' + fmt(t.deadline) + ' · ' + hoursLabel(t.org)),
    thread(t.messages),
    t.status === 'Closed' ? (reopen ? h('div', {class: 'stack'}, text, h('button', {onclick: act('Возобновить')}, 'Возобновить заявку')) : h('small', {}, 'Срок возобновления (2 недели) истёк')) :
      h('div', {class: 'stack'}, text, h('div', {class: 'row'}, buttons)));
}

function thread(messages) {
  return h('div', {class: 'thread'}, messages.map(m => h('div', {class: 'msg ' + m.role}, h('small', {}, (m.role === 'client' ? (m.author.startsWith('Клиент') ? '' : 'Клиент · ') : 'Инженер · ') + m.author + ' · ' + fmt(m.at)), m.text)));
}

// ---------------------------------------------------------------- очередь инженера
const Q = {search: '', status: 'open', priority: '', mine: false, rows: []};

async function queue(selected) {
  const search = h('input', {type: 'search', placeholder: 'Номер, тема или текст', value: Q.search, 'aria-label': 'Поиск'});
  const status = h('select', {'aria-label': 'Статус'}, [['open', 'Открытые'], ['Waiting for support', 'Waiting for support'], ['Waiting for customer', 'Waiting for customer'], ['Closed', 'Closed'], ['', 'Все']].map(([v, l]) => h('option', {value: v, selected: Q.status === v}, l)));
  const prio = h('select', {'aria-label': 'Приоритет'}, [['', 'Все приоритеты'], ...S.priorities.map(p => [p, p])].map(([v, l]) => h('option', {value: v, selected: Q.priority === v}, l)));
  const mine = h('label', {class: 'row muted'}, h('input', {type: 'checkbox', checked: Q.mine, class: 'check'}), 'Мои заявки');
  const count = h('span', {class: 'pill'});
  const list = h('div', {class: 'queue'});
  const detail = h('section', {class: 'card', id: 'detail'});
  $('view').replaceChildren(h('div', {class: 'split'},
    h('aside', {class: 'card list'}, h('div', {class: 'filters'}, h('div', {class: 'row spread'}, h('h2', {}, 'Обращения'), count), search, h('div', {class: 'row'}, status, prio), mine), list),
    detail));
  const draw = () => {
    const q = Q.search.trim().toLowerCase();
    const rows = Q.rows.filter(t => (Q.status === 'open' ? t.status !== 'Closed' : !Q.status || t.status === Q.status) &&
      (!Q.priority || t.priority === Q.priority) && (!Q.mine || t.assignee === S.name) &&
      (!q || [t.id, t.title, t.topic, t.org].join(' ').toLowerCase().includes(q)));
    count.textContent = rows.length + ' / ' + Q.rows.length;
    list.replaceChildren(...(rows.length ? rows.slice(0, 400).map(t => h('a', {href: '#/queue/' + t.id, class: 'item', 'aria-current': t.id === selected ? 'true' : false},
      h('div', {class: 'row spread'}, h('small', {}, t.id + ' · ' + t.org), prioPill(t.priority)),
      h('strong', {}, t.title),
      h('div', {class: 'row spread'}, h('small', {}, t.assignee || 'Unassigned'), slaBadge(t)))) : [h('p', {class: 'blank'}, 'Нет обращений по этим условиям')]));
  };
  search.addEventListener('input', () => { Q.search = search.value; draw(); });
  status.addEventListener('change', () => { Q.status = status.value; draw(); });
  prio.addEventListener('change', () => { Q.priority = prio.value; draw(); });
  mine.querySelector('input').addEventListener('change', e => { Q.mine = e.target.checked; draw(); });
  const load = async () => { Q.rows = await api('/api/tickets'); draw(); };
  await load();
  if (selected) await engineerTicket(selected, detail);
  else detail.replaceChildren(h('p', {class: 'blank'}, 'Выберите обращение в очереди. Цвет срока: зелёный — больше часа, жёлтый — меньше часа, красный — срок истёк.'));
  timer = setInterval(() => {
    if (document.hidden || busy || document.activeElement?.matches('textarea,input,select')) return;
    load().catch(() => {});
    if (selected) engineerTicket(selected, detail, true).catch(() => {});
  }, 20000);
}

const drafts = {};

async function engineerTicket(id, box, quiet) {
  let t;
  try { t = await api('/api/tickets/' + id); } catch (x) { return box.replaceChildren(h('p', {class: 'blank'}, x.message)); }
  const article = S.articles.find(a => a.topic === t.topic);
  const run = (path, body, okText) => async () => {
    if (busy) return; busy = true; box.classList.add('busy');
    try { const r = await api(`/api/tickets/${id}/${path}`, body()); toast(r.message || okText); delete drafts[id]; }
    catch (x) { toast(x.message); }
    finally { busy = false; box.classList.remove('busy'); await engineerTicket(id, box); Q.rows = await api('/api/tickets'); }
  };
  const a1 = t.proposals.find(p => p.kind === 'A1');
  const a2 = t.proposals.find(p => p.kind === 'A2');
  const a4 = t.proposals.find(p => p.kind === 'A4' && !p.decision);
  const assist = h('section', {class: 'card assist'}, h('h3', {}, h('span', {class: 'tag'}, 'ИИ'), 'Ассистент предлагает, решение за вами'));
  if (a1) {
    const typeSel = h('select', {'aria-label': 'Тип обращения'}, S.types.map(x => h('option', {selected: x === (t.type || a1.draft)}, x)));
    assist.append(h('div', {class: 'suggestion stack'},
      h('div', {class: 'row spread'}, h('b', {}, 'А1 · Тип обращения'), h('small', {}, 'уверенность ' + a1.confidence.toFixed(2))),
      h('p', {}, a1.draft + (t.type && t.type !== a1.draft ? ` (клиент указал: ${t.type})` : '')),
      a1.decision ? h('small', {}, `${a1.decision} · ${a1.decided_by}`) :
        h('div', {class: 'row'}, h('button', {onclick: run('type', () => ({action: 'Принять', proposal: a1.id}))}, 'Принять'), typeSel,
          h('button', {onclick: run('type', () => ({action: 'Изменить', proposal: a1.id, value: typeSel.value}))}, 'Изменить'))));
  }
  if (a2) {
    const rank = p => S.priorities.indexOf(p);
    const differs = a2.draft !== t.priority && a2.confidence >= 0.6;
    assist.append(h('div', {class: 'suggestion stack'},
      h('div', {class: 'row spread'}, h('b', {}, 'А2 · Приоритет по описанию'), h('small', {}, 'уверенность ' + a2.confidence.toFixed(2))),
      differs ? h('p', {class: 'flag'}, `Описание больше похоже на ${a2.draft}, указан ${t.priority}. ` + (rank(a2.draft) > rank(t.priority) ? 'Можно запросить у клиента обоснование приоритета.' : 'Возможно, приоритет занижен.'))
        : h('p', {}, `Совпадает с указанным приоритетом ${t.priority} или модель не уверена.`)));
  }
  const composer = h('div', {class: 'stack'});
  const text = h('textarea', {'aria-label': 'Ответ клиенту', placeholder: 'Ответ клиенту', maxlength: 2000});
  text.value = drafts[id] ?? (a4 ? a4.draft : '');
  text.addEventListener('input', () => { drafts[id] = text.value; });
  if (t.status !== 'Closed') {
    if (!t.answered) {
      const suggestBtn = h('button', {disabled: !!a4, onclick: run('suggest', () => ({}), '')}, 'Подготовить черновик');
      assist.append(h('div', {class: 'suggestion stack'},
        h('div', {class: 'row spread'}, h('b', {}, 'А4 · Черновик первого ответа'), suggestBtn),
        a4 ? h('p', {class: 'source'}, `Черновик по ${a4.source} · оценка модели ${a4.confidence} · проверьте, подходит ли вопрос к проблеме`) :
          h('small', {}, 'Модель выбирает вопрос из статьи базы знаний или предлагает ручную диагностику.')));
      const buttons = () => {
        const v = text.value.trim();
        return a4 ? [h('button', {class: 'primary', disabled: !v, onclick: run('decision', () => ({action: v === a4.draft ? 'Принять' : 'Изменить', proposal: a4.id, text: text.value}))}, v === a4.draft ? 'Принять черновик' : 'Отправить с правками'),
          h('button', {class: 'danger', onclick: run('decision', () => ({action: 'Отклонить', proposal: a4.id}))}, 'Отклонить черновик')]
          : [h('button', {class: 'primary', disabled: !v, onclick: run('decision', () => ({action: 'Вручную', text: text.value}))}, 'Отправить первый ответ')];
      };
      const row = h('div', {class: 'row'}, buttons());
      text.addEventListener('input', () => row.replaceChildren(...buttons()));
      composer.append(h('h3', {}, 'Первый ответ'), text, row);
    } else {
      composer.append(h('h3', {}, 'Ответ клиенту'), text, h('div', {class: 'row'},
        h('button', {class: 'primary', onclick: run('reply', () => ({text: text.value}))}, 'Отправить'),
        t.status === 'Waiting for customer' ? h('button', {disabled: !t.can_close, title: t.can_close ? '' : 'Доступно через 3 рабочих дня без ответа клиента', onclick: run('close', () => ({}))}, 'Закрыть: нет ответа клиента') : null));
    }
  }
  const params = h('section', {class: 'card'}, h('h3', {}, 'Параметры'), h('dl', {},
    h('dt', {}, 'Срок первого ответа'), h('dd', {}, fmt(t.deadline), ' ', slaBadge(t)), h('dd', {}, h('small', {}, hoursLabel(t.org))),
    h('dt', {}, 'Исполнитель'), h('dd', {}, t.assignee || 'Unassigned'),
    h('dt', {}, 'Тип обращения'), h('dd', {}, t.type || 'не указан'),
    h('dt', {}, 'Категория'), h('dd', {}, t.topic),
    h('dt', {}, 'Организация · автор'), h('dd', {}, t.org + ' · ' + t.author_name),
    h('dt', {}, 'Зарегистрирована'), h('dd', {}, fmt(t.registered))));
  const kb = article ? h('section', {class: 'card'}, h('h3', {}, 'База знаний · ' + article.id), h('p', {}, article.text)) : null;
  const log = h('details', {class: 'card'}, h('summary', {}, h('b', {}, 'Журнал заявки '), h('span', {class: 'pill'}, t.log.length)),
    h('ul', {class: 'log'}, t.log.map(e => h('li', {}, h('b', {}, e.event), ' · ', h('small', {}, new Date(e.at).toLocaleString('ru-RU', {timeZone: tz()}) + ' · ' + e.actor), h('div', {}, h('small', {}, e.detail))))));
  if (quiet && document.activeElement === box.querySelector('textarea')) return;
  box.replaceChildren(
    h('div', {class: 'detail-head'}, h('div', {class: 'row'}, h('b', {}, t.id), prioPill(t.priority), statusPill(t.status), t.close_reason ? h('span', {class: 'pill'}, t.close_reason) : null), h('h1', {}, t.title)),
    h('div', {class: 'cols'},
      h('div', {class: 'stack'}, thread(t.messages), t.status === 'Closed' ? null : assist, composer.childNodes.length ? h('section', {class: 'card'}, composer) : null, log),
      h('div', {class: 'stack'}, params, kb)));
}

// ---------------------------------------------------------------- отчёты
async function reportsView() {
  const today = new Date().toLocaleDateString('sv-SE', {timeZone: tz()});
  const from = h('input', {type: 'date', value: today.slice(0, 8) + '01', 'aria-label': 'С'});
  const to = h('input', {type: 'date', value: today, 'aria-label': 'По'});
  const out = h('div', {class: 'stack'});
  $('view').replaceChildren(h('div', {class: 'stack'},
    h('div', {class: 'row spread'}, h('h1', {}, 'Отчёты и показатели'), h('div', {class: 'row'}, h('small', {}, 'Период'), from, to))), out);
  const load = async () => {
    const r = await api(`/api/reports?from=${from.value}&to=${to.value}`);
    const k = r.kpi, pct = v => v == null ? '—' : v + ' %';
    const tile = (value, label) => h('div', {class: 'card tile'}, h('b', {}, value), h('span', {}, label));
    const bars = rows => { const max = Math.max(1, ...rows.map(x => x[1])); return h('table', {}, h('tr', {}, h('th', {}, 'Значение'), h('th', {}, 'Заявок'), h('th', {}, '')),
      rows.map(([name, n]) => h('tr', {}, h('td', {}, name), h('td', {}, n), h('td', {class: 'barcell'}, barEl(n / max))))); };
    const cls = S.classifier;
    out.replaceChildren(
      h('div', {class: 'tiles'}, tile(k.tickets, 'заявок за период'), tile(pct(k.sla_share), 'первых ответов в срок (KPI-01, цель ≥ 95 %)'),
        tile(pct(k.median_share), 'медиана времени ответа от норматива (KPI-02, цель ≤ 50 %)'), tile(k.breaches, 'нарушений срока'), tile(k.open, 'открытых заявок')),
      h('div', {class: 'grid2'},
        h('section', {class: 'card'}, h('h2', {}, 'Заявки по типам обращений (ФТ-27)'), bars(r.by_type)),
        h('section', {class: 'card'}, h('h2', {}, 'Заявки по приоритетам (ФТ-29)'), bars(r.by_priority))),
      h('section', {class: 'card'}, h('h2', {}, 'Сотрудники клиентов с неудовлетворёнными заявками (ФТ-28)'),
        h('p', {class: 'muted'}, 'Автор заявки за период, не закрытой с причиной «решено» (ASM-09).'),
        r.unsatisfied.length ? h('table', {}, h('tr', {}, h('th', {}, 'Сотрудник'), h('th', {}, 'Организация'), h('th', {}, 'Заявки')),
          r.unsatisfied.slice(0, 50).map(([name, org, ids]) => h('tr', {}, h('td', {}, name), h('td', {}, org), h('td', {}, ids.length > 6 ? ids.slice(0, 6).join(', ') + ` и ещё ${ids.length - 6}` : ids.join(', '))))) : h('p', {class: 'blank'}, 'Нет')),
      h('div', {class: 'grid2'},
        h('section', {class: 'card'}, h('h2', {}, 'Решения по предложениям ИИ'), h('table', {},
          h('tr', {}, h('th', {}, 'Предложение'), h('th', {}, 'Принято'), h('th', {}, 'Изменено'), h('th', {}, 'Отклонено')),
          h('tr', {}, h('td', {}, 'А4 · черновик ответа'), h('td', {}, k.drafts['Принять']), h('td', {}, k.drafts['Изменить']), h('td', {}, k.drafts['Отклонить'])),
          h('tr', {}, h('td', {}, 'А1 · тип обращения'), h('td', {}, k.types['Принять']), h('td', {}, k.types['Изменить']), h('td', {}, k.types['Отклонить'])))),
        cls ? h('section', {class: 'card'}, h('h2', {}, 'Качество классификатора'), h('p', {class: 'muted'}, cls.trained_on + ' · версия ' + cls.version),
          h('table', {}, h('tr', {}, h('th', {}, 'Задача'), h('th', {}, 'Accuracy'), h('th', {}, 'Macro-F1'), h('th', {}, 'Базовая')),
            h('tr', {}, h('td', {}, 'А1 · тип'), h('td', {}, cls.metrics.type.accuracy), h('td', {}, cls.metrics.type.macro_f1), h('td', {}, cls.metrics.type.baseline_majority)),
            h('tr', {}, h('td', {}, 'А2 · приоритет'), h('td', {}, cls.metrics.priority.accuracy), h('td', {}, cls.metrics.priority.macro_f1), h('td', {}, cls.metrics.priority.baseline_majority))),
          h('small', {}, 'Цель ИИ-01: accuracy ≥ 0,85 и macro-F1 ≥ 0,80. «Базовая» — доля самого частого класса.')) : null));
  };
  from.addEventListener('change', load); to.addEventListener('change', load);
  await load();
}

function barEl(share) { const b = h('div', {class: 'bar'}); b.style.width = Math.round(share * 100) + '%'; return b; }

// ---------------------------------------------------------------- уведомления
async function notificationsView() {
  const chan = h('select', {'aria-label': 'Канал'}, [['', 'Все каналы'], ['email', 'Почта'], ['slack', 'Slack']].map(([v, l]) => h('option', {value: v}, l)));
  const list = h('div', {class: 'card'});
  $('view').replaceChildren(h('div', {class: 'stack'},
    h('div', {class: 'row spread'}, h('h1', {}, 'Журнал уведомлений'), chan),
    h('p', {class: 'muted'}, 'Письма и сообщения Slack, которые система отправила бы по правилам кейса: новая заявка, обновление, смена статуса, предупреждение за час, нарушение срока. В учебном сервисе они не уходят наружу.'),
    list));
  const load = async () => {
    const rows = await api('/api/notifications' + (chan.value ? '?channel=' + chan.value : ''));
    list.replaceChildren(...(rows.length ? rows.map(n => h('div', {class: 'note'},
      h('span', {class: 'chan ' + n.channel}, n.channel === 'email' ? 'Письмо' : 'Slack'),
      h('div', {}, h('div', {class: 'row spread'}, h('b', {}, n.kind + ' · ', h('a', {href: '#/queue/' + n.ticket}, n.ticket)), h('small', {}, fmt(n.at))),
        h('small', {}, 'Кому: ' + n.recipients), h('p', {}, n.text)))) : [h('p', {class: 'blank'}, 'Уведомлений пока нет. Они появятся, когда клиент создаст заявку или подойдёт срок.')]));
  };
  chan.addEventListener('change', load);
  await load();
  timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 20000);
}
