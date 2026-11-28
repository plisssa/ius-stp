'use strict';
// Интерфейс ИУС СТП: вход, портал клиента, рабочее место инженера, отчёты, уведомления.
// Цвета источников: клиент — синий, инженер — зелёный, ИИ — фиолетовый (предложение, ещё не применено), система — серый.

const $ = id => document.getElementById(id);
let S = null;            // сессия: пользователь и справочники
let busy = false;
let timer = null;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'tip') el.dataset.tip = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ---------------------------------------------------------------- подсказки при наведении
const TIP = h('div', {id: 'tip', role: 'tooltip'});
function showTip(el) {
  TIP.textContent = el.dataset.tip;
  TIP.classList.add('show');
  const r = el.getBoundingClientRect(), t = TIP.getBoundingClientRect();
  let x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
  let y = r.top - t.height - 8;
  if (y < 8) y = r.bottom + 8;
  TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
}
document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else TIP.classList.remove('show'); });
document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
document.addEventListener('focusout', () => TIP.classList.remove('show'));
document.addEventListener('scroll', () => TIP.classList.remove('show'), true);
const info = text => h('span', {class: 'info', tabindex: 0, tip: text, 'aria-label': text}, '?');

function toast(text) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {cache: 'no-store'} :
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await r.json().catch(() => ({}));
  // Сессия истекла во время работы — показать вход один раз, без повторного запроса сессии.
  if (r.status === 401 && path !== '/api/login' && path !== '/api/session') { S = null; clearInterval(timer); loginView(); throw Error('Нужен вход'); }
  if (!r.ok) throw Error(data.message || 'Запрос не выполнен');
  return data;
}

// ---------------------------------------------------------------- справочные функции
const tz = () => S.sla['ORG-A'].tz;
const fmt = (s, opts) => s ? new Date(s * 1000).toLocaleString('ru-RU', {timeZone: tz(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...opts}) : '—';
const has = role => S && S.roles.includes(role);
const STATUS = {
  'Waiting for support': {cls: 'st-support', ru: 'ждёт поддержку', tip: 'Waiting for support — ход за поддержкой: нужен ответ инженера.'},
  'Waiting for customer': {cls: 'st-customer', ru: 'ждёт клиента', tip: 'Waiting for customer — инженер ответил, ждём реакции клиента. Через 3 рабочих дня без ответа заявку можно закрыть (BR-19).'},
  'Closed': {cls: 'st-closed', ru: 'закрыта', tip: 'Closed — заявка закрыта. Клиент может возобновить её в течение 2 недель (BR-20).'},
};
const statusPill = s => h('span', {class: 'pill ' + STATUS[s].cls, tip: STATUS[s].tip}, s);
const PRIO_TIP = p => `Приоритет ${p}: первый ответ за ${S.sla['ORG-A'].norms[p]} ч по договору SLA (ORG-A, рабочие часы).`;
const prioPill = p => h('span', {class: 'pill ' + p, tip: PRIO_TIP(p)}, p);

function left(seconds) {
  const m = Math.ceil(Math.abs(seconds) / 60);
  const d = Math.floor(m / 1440), hh = Math.floor(m % 1440 / 60), mm = m % 60;
  return (d ? d + ' д ' : '') + (d || hh ? hh + ' ч ' : '') + mm + ' мин';
}

function slaState(t) {
  if (t.answered) return t.answered <= t.deadline ? ['done', 'ответ в срок'] : ['late-done', 'ответ с опозданием'];
  if (t.status === 'Closed') return ['done', 'закрыта'];
  const rest = t.deadline - Date.now() / 1000;
  if (rest <= 0) return ['late', 'просрочено на ' + left(rest)];
  return [rest <= 3600 ? 'warn' : 'ok', 'осталось ' + left(rest)];
}
const SLA_TIP = 'Срок первого ответа по SLA. Зелёный — больше часа, жёлтый — меньше часа (уже ушло предупреждение), красный — срок истёк (ушло письмо о нарушении).';
const slaBadge = t => { const [c, text] = slaState(t); return h('span', {class: 'sla ' + c, tip: SLA_TIP}, text); };

function hoursLabel(org) {
  const c = S.sla[org];
  return c.hours === 'working' ? `рабочие часы ${c.start}:00–${c.end}:00 МСК` : 'календарные часы';
}

function stepper(status) {
  const steps = [['Регистрация', 'Заявка получила номер ES-XXXX, исполнитель Unassigned, срок первого ответа.'],
    ['Waiting for support', STATUS['Waiting for support'].tip], ['Waiting for customer', STATUS['Waiting for customer'].tip], ['Closed', STATUS['Closed'].tip]];
  const current = status === 'Waiting for support' ? 1 : status === 'Waiting for customer' ? 2 : 3;
  return h('ol', {class: 'stepper', 'aria-label': 'Жизненный цикл заявки'}, steps.map(([name, tip], i) =>
    h('li', {class: i < current ? 'past' : i === current ? 'now' : '', tip, tabindex: 0, 'aria-current': i === current ? 'step' : false}, name)));
}

function meter(p, label = 'уверенность') {
  const bar = h('span', {class: 'meter-fill' + (p < 0.6 ? ' low' : '')});
  bar.style.width = Math.round(p * 100) + '%';
  return h('span', {class: 'meter', tip: 'Уверенность модели от 0 до 1. Ниже 0,6 — только подсказка, решение за инженером.'}, h('span', {class: 'meter-track'}, bar), h('small', {}, `${label} ${p.toFixed(2).replace('.', ',')}`));
}

function section(title, tip, ...children) {
  return h('section', {class: 'card'}, h('h2', {class: 'sec'}, title, tip ? info(tip) : null), ...children);
}

function pageHead(title, text, ...extra) {
  return h('div', {class: 'page-head'}, h('div', {}, h('h1', {}, title), h('p', {class: 'muted'}, text)), ...extra);
}

// ---------------------------------------------------------------- маршрутизация
const VIEWS = [
  {hash: '#/portal', title: 'Портал клиента', role: 'client', render: portal, tip: 'Так сервис видит клиент: создать обращение, следить за статусом, ответить инженеру.'},
  {hash: '#/queue', title: 'Рабочее место инженера', role: 'engineer', render: queue, tip: 'Очередь заявок всех клиентов, предложения ИИ-ассистента и ответы клиенту.'},
  {hash: '#/reports', title: 'Отчёты и KPI', role: 'head', alt: 'engineer', render: reportsView, tip: 'Отчёты из кейса (ФТ-27…29), показатели SLA и качество ИИ-ассистента.'},
  {hash: '#/notifications', title: 'Уведомления', role: 'engineer', render: notificationsView, tip: 'Письма и сообщения Slack, которые система отправила по правилам кейса.'},
];

function nav() {
  const allowed = VIEWS.filter(v => has(v.role) || (v.alt && has(v.alt)));
  const current = location.hash.split('/').slice(0, 2).join('/');
  $('nav').replaceChildren(...allowed.map(v => h('a', {href: v.hash, tip: v.tip, 'aria-current': current === v.hash ? 'page' : false}, v.title)));
  $('who').replaceChildren(h('span', {tip: 'Роли: ' + S.roles.map(r => ({client: 'клиент', engineer: 'инженер', head: 'руководитель'})[r]).join(', ')}, S.name), S.local ? '' : h('button', {onclick: logout}, 'Выйти'));
  return allowed;
}

async function route() {
  clearInterval(timer);
  TIP.classList.remove('show');
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
window.addEventListener('DOMContentLoaded', () => { document.body.append(TIP); route(); });

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
    err, h('button', {class: 'primary wide', type: 'submit'}, 'Войти'),
    h('div', {class: 'legend'},
      h('b', {}, 'В сервисе четыре раздела'),
      h('p', {}, 'Портал клиента — создать обращение и следить за ним.'),
      h('p', {}, 'Рабочее место инженера — очередь, предложения ИИ, ответы.'),
      h('p', {}, 'Отчёты и KPI, уведомления — для контроля сроков и качества.')));
  $('view').replaceChildren(h('div', {class: 'login'}, form));
  login.focus();
}

async function logout() {
  await api('/api/logout', {}).catch(() => {});
  S = null; history.replaceState(null, '', '#/'); loginView();
}

// ---------------------------------------------------------------- общая лента сообщений
const ROLE = {client: 'Клиент', engineer: 'Инженер'};
function thread(messages, skipFirst) {
  const list = skipFirst ? messages.slice(1) : messages;
  if (!list.length) return null;
  return h('div', {class: 'thread'}, list.map(m => h('div', {class: 'msg ' + m.role},
    h('div', {class: 'msg-head'}, h('span', {class: 'who-tag ' + m.role}, ROLE[m.role]), h('b', {}, m.author), h('small', {}, fmt(m.at))),
    h('p', {}, m.text))));
}

function clientMessage(t) {
  const first = t.messages[0];
  return h('article', {class: 'origin'},
    h('div', {class: 'msg-head'}, h('span', {class: 'who-tag client'}, 'Клиент'), h('b', {}, t.author_name + ' · ' + t.org), h('small', {}, fmt(t.registered))),
    h('h3', {}, t.title),
    h('p', {}, first ? first.text : t.body));
}

// ---------------------------------------------------------------- портал клиента
function nextStep(t) {
  if (t.status === 'Closed') {
    const until = t.closed + 14 * 86400;
    return Date.now() / 1000 <= until ? `Заявка закрыта (${t.close_reason}). Если проблема вернулась, её можно возобновить до ${fmt(until)}.` : `Заявка закрыта (${t.close_reason}).`;
  }
  if (t.status === 'Waiting for customer') return 'Инженер ответил. Напишите ответ или отметьте, помогло ли решение.';
  return t.answered ? 'Ваше сообщение передано инженеру, он ответит в этой заявке.' : `Инженер ответит до ${fmt(t.deadline)} (${hoursLabel(t.org)}).`;
}

async function portal(selected) {
  const sel = (id, items, value) => h('select', {id}, items.map(i => h('option', {value: i, selected: i === value}, i)));
  const contract = S.sla[S.org];
  const prio = sel('prio', S.priorities, 'P3');
  const hint = h('p', {class: 'hint'});
  const showHint = () => hint.textContent = `Первый ответ — не позже чем через ${contract.norms[prio.value]} ч (${hoursLabel(S.org)}).`;
  prio.addEventListener('change', showHint); showHint();
  const title = h('input', {id: 'title', maxlength: 200, required: true, placeholder: 'Например: не открывается отчёт после обновления'});
  const body = h('textarea', {id: 'body', maxlength: 4000, required: true, placeholder: 'Что произошло, когда, какой текст ошибки на экране'});
  const topic = sel('topic', S.topics), type = sel('type', S.types, 'Ошибка');
  const field = (id, label, tip, input) => h('div', {class: 'field'}, h('label', {class: 'label', for: id}, label, info(tip)), input);
  const form = h('form', {class: 'card form', onsubmit: async e => {
    e.preventDefault();
    if (busy) return; busy = true;
    try {
      const r = await api('/api/tickets', {title: title.value, body: body.value, topic: topic.value, type: type.value, priority: prio.value});
      toast(r.message); title.value = ''; body.value = '';
      location.hash = '#/portal/' + r.id;
    } catch (x) { toast(x.message); } finally { busy = false; }
  }},
    h('h2', {class: 'sec'}, 'Новое обращение', info('После отправки заявка получит номер ES-XXXX, статус «Waiting for support» и исполнителя «Unassigned». Инженеры получат письмо и сообщение в Slack.')),
    field('title', 'Тема', 'Коротко, в одну строку: что не работает.', title),
    h('div', {class: 'two'},
      field('topic', 'Категория', 'По категории ассистент подберёт статью базы знаний для первого вопроса инженера.', topic),
      field('type', 'Тип обращения', 'Справочник типов из кейса (ASM-11). Инженер может исправить тип.', type)),
    field('prio', 'Приоритет', 'От приоритета зависит срок первого ответа по договору SLA вашей организации.', prio), hint,
    field('body', 'Описание', 'Чем подробнее описание, тем точнее первый ответ. Пароли не указывайте.', body),
    h('div', {class: 'row spread'}, h('small', {}, S.name + ' · ' + S.org), h('button', {class: 'primary', type: 'submit', tip: 'Отправить обращение в поддержку'}, 'Send')));
  const side = h('section', {class: 'stack'});
  $('view').replaceChildren(
    pageHead('Портал клиента', 'Создайте обращение и следите за ответом поддержки. Здесь видны заявки вашей организации.'),
    h('div', {class: 'portal'}, form, side));
  const load = async () => {
    const rows = await api('/api/tickets?view=client');
    const list = rows.length ? h('div', {class: 'mine'}, rows.map(t => h('a', {href: '#/portal/' + t.id, class: 'item', 'aria-current': t.id === selected ? 'true' : false},
      h('div', {class: 'row spread'}, h('span', {class: 'row'}, h('b', {}, t.id), prioPill(t.priority)), statusPill(t.status)),
      h('strong', {}, t.title), h('small', {}, t.answered ? 'Инженер ответил' : 'Ответ до ' + fmt(t.deadline))))) :
      h('p', {class: 'blank'}, 'Обращений пока нет. Заполните форму слева и нажмите «Send».');
    const parts = [section('Обращения организации', 'Все заявки, созданные через портал сотрудниками вашей организации.', list)];
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
  if (t.status === 'Waiting for customer') buttons.push(
    h('button', {class: 'primary', onclick: act('Помогло'), tip: 'Решение помогло — заявка закроется с причиной «решено» (BR-22).'}, 'Помогло, закрыть'),
    h('button', {onclick: act('Не помогло'), tip: 'Заявка вернётся инженеру на повторную диагностику (BR-21).'}, 'Не помогло'));
  if (t.status !== 'Closed') buttons.push(h('button', {onclick: act('Ответ', true), tip: 'Сообщение увидит инженер; статус станет «Waiting for support».'}, 'Отправить сообщение'));
  const reopen = t.status === 'Closed' && Date.now() / 1000 - t.closed <= 14 * 86400;
  return h('article', {class: 'card stack'},
    h('div', {class: 'row spread'}, h('div', {class: 'row'}, h('b', {}, t.id), prioPill(t.priority), statusPill(t.status)), h('a', {href: '#/portal'}, 'Закрыть карточку')),
    h('h2', {}, t.title), stepper(t.status),
    h('p', {class: 'next'}, h('b', {}, 'Что дальше: '), nextStep(t)),
    thread(t.messages),
    t.status === 'Closed' ? (reopen ? h('div', {class: 'stack'}, text, h('button', {onclick: act('Возобновить'), tip: 'Заявка вернётся в статус «Waiting for support», исполнитель сохранится (ASM-04).'}, 'Возобновить заявку')) : null) :
      h('div', {class: 'stack'}, text, h('div', {class: 'row'}, buttons)));
}

// ---------------------------------------------------------------- рабочее место инженера
const Q = {search: '', status: 'open', priority: '', mine: false, ai: false, rows: []};

async function queue(selected) {
  const search = h('input', {type: 'search', placeholder: 'Номер, тема, организация', value: Q.search, 'aria-label': 'Поиск'});
  const status = h('select', {'aria-label': 'Статус', tip: 'Фильтр по статусу заявки'}, [['open', 'Открытые'], ['Waiting for support', 'Ждут поддержку'], ['Waiting for customer', 'Ждут клиента'], ['Closed', 'Закрытые'], ['', 'Все']].map(([v, l]) => h('option', {value: v, selected: Q.status === v}, l)));
  const prio = h('select', {'aria-label': 'Приоритет', tip: 'Фильтр по приоритету'}, [['', 'Все приоритеты'], ...S.priorities.map(p => [p, p])].map(([v, l]) => h('option', {value: v, selected: Q.priority === v}, l)));
  const check = (key, label, tip) => { const box = h('input', {type: 'checkbox', checked: Q[key]}); box.addEventListener('change', () => { Q[key] = box.checked; draw(); }); return h('label', {class: 'check', tip}, box, label); };
  const count = h('span', {class: 'pill', tip: 'Показано / всего заявок'});
  const list = h('div', {class: 'queue', role: 'list'});
  const detail = h('section', {class: 'workspace', id: 'detail'});
  $('view').replaceChildren(
    pageHead('Рабочее место инженера', 'Слева — очередь заявок всех клиентов, справа — выбранная заявка: обращение, предложения ИИ и ваш ответ.'),
    h('div', {class: 'split'},
      h('aside', {class: 'card list'},
        h('div', {class: 'filters'}, h('div', {class: 'row spread'}, h('h2', {class: 'sec'}, 'Очередь', info('Сначала заявки, которые ждут поддержку, затем по ближайшему сроку SLA.')), count),
          search, h('div', {class: 'row'}, status, prio),
          h('div', {class: 'row'}, check('mine', 'Мои заявки', 'Заявки, где вы исполнитель'), check('ai', 'Есть предложение ИИ', 'Заявки, где предложение ассистента ждёт вашего решения'))),
        list),
      detail));
  const draw = () => {
    const q = Q.search.trim().toLowerCase();
    const rows = Q.rows.filter(t => (Q.status === 'open' ? t.status !== 'Closed' : !Q.status || t.status === Q.status) &&
      (!Q.priority || t.priority === Q.priority) && (!Q.mine || t.assignee === S.name) && (!Q.ai || t.ai.length) &&
      (!q || [t.id, t.title, t.topic, t.org].join(' ').toLowerCase().includes(q)));
    count.textContent = rows.length + ' / ' + Q.rows.length;
    list.replaceChildren(...(rows.length ? rows.slice(0, 400).map(t => {
      const [state] = slaState(t);
      return h('a', {href: '#/queue/' + t.id, class: 'item sla-' + state, role: 'listitem', 'aria-current': t.id === selected ? 'true' : false},
        h('div', {class: 'row spread'}, h('span', {class: 'row'}, prioPill(t.priority), h('small', {}, t.id + ' · ' + t.org)), slaBadge(t)),
        h('strong', {}, t.title),
        h('div', {class: 'row spread'}, h('span', {class: 'row'}, statusPill(t.status), h('small', {}, t.assignee || 'Unassigned')),
          h('span', {class: 'row'}, t.ai.includes('A4') ? h('span', {class: 'ai-chip', tip: 'Черновик первого ответа от ИИ ждёт вашего решения'}, 'ИИ: черновик') : null,
            t.ai.includes('A1') ? h('span', {class: 'ai-chip', tip: 'ИИ считает, что тип обращения отличается от указанного клиентом — проверьте'}, 'ИИ: другой тип') : null)));
    }) : [h('p', {class: 'blank'}, 'Нет заявок по этим условиям')]));
  };
  search.addEventListener('input', () => { Q.search = search.value; draw(); });
  status.addEventListener('change', () => { Q.status = status.value; draw(); });
  prio.addEventListener('change', () => { Q.priority = prio.value; draw(); });
  const load = async () => { Q.rows = await api('/api/tickets'); draw(); };
  await load();
  if (selected) await engineerTicket(selected, detail);
  else detail.replaceChildren(h('div', {class: 'card empty'},
    h('h2', {}, 'Выберите заявку в очереди'),
    h('p', {}, 'Карточка заявки читается сверху вниз:'),
    h('ol', {}, h('li', {}, h('b', {}, 'Обращение клиента'), ' — что написал клиент.'),
      h('li', {}, h('b', {class: 'ai-text'}, 'Предложения ИИ'), ' — тип, оценка приоритета и черновик ответа. Ничего не применяется без вас.'),
      h('li', {}, h('b', {}, 'Ваш ответ клиенту'), ' — отправка первого и следующих ответов.')),
    h('p', {class: 'muted'}, 'Справа в карточке — срок SLA, параметры, статья базы знаний и журнал действий.')));
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
  if (quiet && box.contains(document.activeElement) && document.activeElement.matches('textarea,select')) return;
  const article = S.articles.find(a => a.topic === t.topic);
  const run = (path, body, okText) => async () => {
    if (busy) return; busy = true; box.classList.add('busy');
    try { const r = await api(`/api/tickets/${id}/${path}`, body()); toast(r.message || okText); delete drafts[id]; }
    catch (x) { toast(x.message); }
    finally { busy = false; box.classList.remove('busy'); await engineerTicket(id, box); Q.rows = await api('/api/tickets').catch(() => Q.rows); }
  };
  const a1 = t.proposals.find(p => p.kind === 'A1');
  const a2 = t.proposals.find(p => p.kind === 'A2');
  const a4 = t.proposals.find(p => p.kind === 'A4' && !p.decision);
  const a4done = t.proposals.find(p => p.kind === 'A4' && p.decision && p.decision !== 'Устарело');

  // --- 2. Предложения ИИ
  const decided = p => h('span', {class: 'state done', tip: `Решение принял(а) ${p.decided_by} ${fmt(p.decided_at)}`}, `${p.decision.toLowerCase()}: ${p.decided_by}`);
  const waiting = () => h('span', {class: 'state wait', tip: 'Предложение ещё не применено и ждёт вашего решения'}, 'ждёт решения');
  const ai = [];
  if (a1) {
    const typeSel = h('select', {'aria-label': 'Тип обращения'}, S.types.map(x => h('option', {selected: x === (t.type || a1.draft)}, x)));
    ai.push(h('div', {class: 'proposal'},
      h('div', {class: 'prop-head'}, h('span', {class: 'code', tip: 'А1 — тип обращения (ИИ-01)'}, 'А1'), h('b', {}, 'Тип обращения'), a1.decision ? decided(a1) : waiting()),
      h('p', {class: 'prop-value'}, a1.draft, t.type ? h('small', {}, t.type === a1.draft ? ' — совпадает с типом, который указал клиент' : ` — клиент указал «${t.type}»`) : null),
      h('div', {class: 'row spread'}, meter(a1.confidence), h('small', {tip: 'Модель: TF-IDF и логистическая регрессия, обучена на 5282 обращениях'}, 'классификатор')),
      a1.decision ? null : h('div', {class: 'row'},
        h('button', {onclick: run('type', () => ({action: 'Принять', proposal: a1.id})), tip: 'Записать тип в заявку'}, 'Принять'),
        typeSel, h('button', {onclick: run('type', () => ({action: 'Изменить', proposal: a1.id, value: typeSel.value})), tip: 'Записать выбранный в списке тип'}, 'Изменить'))));
  }
  if (a2) {
    const rank = p => S.priorities.indexOf(p);
    const differs = a2.draft !== t.priority && a2.confidence >= 0.6;
    ai.push(h('div', {class: 'proposal'},
      h('div', {class: 'prop-head'}, h('span', {class: 'code', tip: 'А2 — проверка соответствия приоритета описанию (ИИ-02)'}, 'А2'), h('b', {}, 'Приоритет по описанию'), h('span', {class: 'state info-state', tip: 'Это подсказка: приоритет меняется только после обоснования клиента (BR-14)'}, 'подсказка')),
      h('p', {class: 'prop-value'}, `${a2.draft}`, h('small', {}, ` — указан ${t.priority}`)),
      differs ? h('p', {class: 'flag'}, rank(a2.draft) > rank(t.priority) ? 'Описание похоже на менее срочное обращение. Можно запросить у клиента обоснование приоритета.' : 'Описание похоже на более срочное обращение. Проверьте, не занижен ли приоритет.') : null,
      meter(a2.confidence)));
  }
  if (t.status !== 'Closed' && !t.answered) {
    ai.push(h('div', {class: 'proposal'},
      h('div', {class: 'prop-head'}, h('span', {class: 'code', tip: 'А4 — черновик первого ответа (ИИ-04)'}, 'А4'), h('b', {}, 'Черновик первого ответа'), a4 ? waiting() : null),
      a4 ? h('div', {class: 'stack-s'},
        h('p', {}, 'Черновик вставлен в поле «Ваш ответ клиенту» ниже. Проверьте, подходит ли вопрос к проблеме клиента.'),
        h('div', {class: 'row spread'}, meter(a4.confidence), h('small', {tip: article ? article.text : ''}, 'источник: ' + a4.source)))
        : h('div', {class: 'stack-s'},
          h('p', {}, 'Языковая модель выберет диагностический вопрос из статьи базы знаний или предложит ручную диагностику.'),
          h('button', {class: 'ai-btn', onclick: run('suggest', () => ({}), ''), tip: 'Контроллер прочитает заявку и статью через MCP-инструменты, вызовет модель и проверит ответ. Ничего не отправляется клиенту.'}, 'Подготовить черновик'))));
  } else if (a4done) {
    ai.push(h('div', {class: 'proposal'}, h('div', {class: 'prop-head'}, h('span', {class: 'code'}, 'А4'), h('b', {}, 'Черновик первого ответа'), decided(a4done))));
  }
  const aiPanel = ai.length ? h('section', {class: 'card ai-panel'},
    h('div', {class: 'row'}, h('span', {class: 'ai-badge'}, 'ИИ'), h('span', {class: 'muted'}, 'Ассистент только предлагает — ничего не применяется без вашего решения'),
      info('Тип записывается после «Принять» или «Изменить», ответ уходит клиенту только после вашей отправки. Вызовы инструментов ассистента и ваши решения видны в журнале заявки.')),
    ...ai) : null;

  // --- 3. Ваш ответ клиенту
  let composer = null;
  if (t.status !== 'Closed') {
    const text = h('textarea', {'aria-label': 'Ответ клиенту', placeholder: 'Напишите ответ клиенту или подготовьте черновик ИИ выше', maxlength: 2000});
    text.value = drafts[id] ?? (a4 ? a4.draft : '');
    const origin = h('p', {class: 'origin-note'});
    const actions = h('div', {class: 'row'});
    const refresh = () => {
      const v = text.value.trim();
      text.classList.toggle('from-ai', !!a4 && v === a4.draft.trim());
      origin.replaceChildren(...(a4 ? [h('span', {class: 'ai-chip'}, v === a4.draft ? 'текст ИИ без правок' : 'текст ИИ с вашими правками'), ' Отправляя, вы принимаете решение по черновику.'] : []));
      if (!t.answered) {
        actions.replaceChildren(...(a4 ? [
          h('button', {class: 'primary', disabled: !v, onclick: run('decision', () => ({action: v === a4.draft ? 'Принять' : 'Изменить', proposal: a4.id, text: text.value})),
            tip: v === a4.draft ? 'Отправить черновик ИИ без изменений (решение «Принять»)' : 'Отправить ваш исправленный текст (решение «Изменить»)'}, v === a4.draft ? 'Принять черновик и отправить' : 'Отправить с правками'),
          h('button', {class: 'danger', onclick: run('decision', () => ({action: 'Отклонить', proposal: a4.id})), tip: 'Черновик не подходит. Заявка останется открытой, ответьте вручную.'}, 'Отклонить черновик')]
          : [h('button', {class: 'primary', disabled: !v, onclick: run('decision', () => ({action: 'Вручную', text: text.value})), tip: 'Первый ответ остановит отсчёт SLA, вы станете исполнителем, статус — «Waiting for customer»'}, 'Отправить первый ответ')]));
      } else {
        actions.replaceChildren(
          h('button', {class: 'primary', disabled: !v, onclick: run('reply', () => ({text: text.value})), tip: 'Статус станет «Waiting for customer»'}, 'Отправить'),
          t.status === 'Waiting for customer' ? h('button', {disabled: !t.can_close, onclick: run('close', () => ({})),
            tip: t.can_close ? 'Закрыть: клиент не отвечает 3 рабочих дня (BR-19)' : 'Станет доступно через 3 рабочих дня без ответа клиента (BR-19)'}, 'Закрыть: нет ответа клиента') : null);
      }
    };
    text.addEventListener('input', () => { drafts[id] = text.value; refresh(); });
    refresh();
    composer = h('section', {class: 'card composer'},
      h('div', {class: 'row'}, t.answered ? h('span', {class: 'muted'}, 'Клиент увидит ответ в портале.') :
        h('ol', {class: 'steps'}, h('li', {}, 'подготовьте черновик ИИ или пишите сами'), h('li', {}, 'проверьте и поправьте текст'), h('li', {}, 'отправьте')),
        info(t.answered ? 'Ответ меняет статус на «Waiting for customer».' : 'Первый ответ фиксирует соблюдение SLA, назначает вас исполнителем (BR-05) и меняет статус на «Waiting for customer» (BR-18).')),
      text, origin, actions);
  }

  // --- правая колонка
  const [state, stateText] = slaState(t);
  const span = Math.max(1, t.deadline - t.registered);
  const used = Math.min(1, Math.max(0, ((t.answered || Date.now() / 1000) - t.registered) / span));
  const bar = h('span', {class: 'progress-fill ' + state}); bar.style.width = Math.round(used * 100) + '%';
  const slaCard = h('section', {class: 'card sla-card ' + state},
    h('h2', {class: 'sec'}, 'Срок первого ответа', info('Считается от регистрации по договору SLA организации: P1–P4 = 1, 4, 8, 24 ч. За час до срока инженеры получают предупреждение, после срока — письмо о нарушении инженерам и руководителю.')),
    h('p', {class: 'sla-big'}, stateText),
    h('span', {class: 'progress', tip: 'Доля времени до срока, которая уже прошла'}, bar),
    h('small', {}, `до ${fmt(t.deadline)} · ${hoursLabel(t.org)}`));
  const row = (label, value, tip) => [h('dt', {tip}, label), h('dd', {}, value)];
  const params = section('Параметры заявки', null, h('dl', {},
    row('Исполнитель', t.assignee || 'Unassigned', 'Первый ответивший инженер становится исполнителем (BR-05)'),
    row('Тип обращения', t.type || 'не указан', 'Указывает клиент, инженер может исправить (ASM-11)'),
    row('Категория', t.topic, 'По категории выбирается статья базы знаний'),
    row('Организация', t.org, 'Организация-клиент и её договор SLA'),
    row('Автор', t.author_name, null),
    row('Зарегистрирована', fmt(t.registered), null)));
  const kb = article ? section('База знаний · ' + article.id, 'Утверждённая статья по категории заявки. Из неё ИИ берёт диагностический вопрос.', h('p', {}, article.text)) : null;
  const actorClass = a => a === 'harness' || a === 'ассистент' ? 'ai' : a === 'портал' || a === 'контроль SLA' ? 'system' : 'engineer';
  const actorLabel = {ai: 'ИИ', system: 'система', engineer: 'человек'};
  const log = h('details', {class: 'card log-card'},
    h('summary', {tip: 'Неизменяемая история: регистрация, вызовы инструментов ИИ, решения и ответы с автором'}, h('b', {}, 'Журнал заявки '), h('span', {class: 'pill'}, t.log.length)),
    h('ul', {class: 'log'}, t.log.map(e => { const c = actorClass(e.actor); return h('li', {class: 'log-' + c},
      h('div', {class: 'row'}, h('span', {class: 'who-tag ' + c}, actorLabel[c]), h('b', {}, e.event)),
      h('small', {}, new Date(e.at).toLocaleString('ru-RU', {timeZone: tz()}) + ' · ' + e.actor), e.detail ? h('div', {class: 'detail'}, e.detail) : null); })));

  box.replaceChildren(
    h('header', {class: 'ticket-head'},
      h('div', {class: 'row'}, h('span', {class: 'eyebrow'}, 'Заявка ' + t.id), prioPill(t.priority), statusPill(t.status), t.close_reason ? h('span', {class: 'pill', tip: 'Причина закрытия'}, t.close_reason) : null),
      h('h1', {}, t.title), stepper(t.status)),
    h('div', {class: 'cols'},
      h('div', {class: 'stack'},
        h('div', {class: 'zone'}, h('span', {class: 'zone-num'}, '1'), h('h2', {class: 'zone-title'}, 'Обращение клиента')),
        clientMessage(t), thread(t.messages, true),
        aiPanel ? h('div', {class: 'zone'}, h('span', {class: 'zone-num ai'}, '2'), h('h2', {class: 'zone-title'}, 'Предложения ИИ')) : null, aiPanel,
        composer ? h('div', {class: 'zone'}, h('span', {class: 'zone-num'}, aiPanel ? '3' : '2'), h('h2', {class: 'zone-title'}, t.answered ? 'Ваш ответ клиенту' : 'Ваш первый ответ клиенту')) : null, composer),
      h('div', {class: 'stack'}, slaCard, params, kb, log)));
}

// ---------------------------------------------------------------- отчёты
async function reportsView() {
  const today = new Date().toLocaleDateString('sv-SE', {timeZone: tz()});
  const from = h('input', {type: 'date', value: today.slice(0, 8) + '01', 'aria-label': 'С'});
  const to = h('input', {type: 'date', value: today, 'aria-label': 'По'});
  const out = h('div', {class: 'stack'});
  $('view').replaceChildren(
    pageHead('Отчёты и показатели', 'Отчёты из кейса, показатели SLA и качество ИИ-ассистента за выбранный период регистрации заявок.',
      h('div', {class: 'row'}, h('small', {}, 'Период'), from, to)), out);
  const load = async () => {
    const r = await api(`/api/reports?from=${from.value}&to=${to.value}`);
    const k = r.kpi, pct = v => v == null ? '—' : String(v).replace('.', ',') + ' %';
    const tile = (value, label, tip) => h('div', {class: 'card tile', tip, tabindex: 0}, h('b', {}, value), h('span', {}, label));
    const bars = rows => { const max = Math.max(1, ...rows.map(x => x[1])); return h('table', {}, h('tr', {}, h('th', {}, 'Значение'), h('th', {}, 'Заявок'), h('th', {}, '')),
      rows.map(([name, n]) => h('tr', {}, h('td', {}, name), h('td', {}, n), h('td', {class: 'barcell'}, barEl(n / max))))); };
    const cls = S.classifier;
    out.replaceChildren(
      h('div', {class: 'tiles'},
        tile(k.tickets, 'заявок за период', 'Сколько заявок зарегистрировано в выбранный период'),
        tile(pct(k.sla_share), 'первых ответов в срок · KPI-01', 'Доля заявок с первым ответом до срока среди тех, где ответ дан или срок уже истёк. Цель — не менее 95 %.'),
        tile(pct(k.median_share), 'время ответа от норматива · KPI-02', 'Медиана: какую долю нормативного срока занял первый ответ. Цель — не более 50 %.'),
        tile(k.breaches, 'нарушений срока', 'Заявки, по которым истёк срок первого ответа (ушло письмо о нарушении)'),
        tile(k.open, 'открытых заявок', 'Заявки не в статусе Closed')),
      h('div', {class: 'grid2'},
        section('Заявки по типам обращений', 'Отчёт ФТ-27: количество заявок за период в разрезе типов.', bars(r.by_type)),
        section('Заявки по приоритетам', 'Отчёт ФТ-29: количество заявок за период в разрезе приоритетов.', bars(r.by_priority))),
      section('Сотрудники клиентов с неудовлетворёнными заявками', 'Отчёт ФТ-28: авторы заявок за период, которые не закрыты с причиной «решено» (ASM-09).',
        r.unsatisfied.length ? h('table', {}, h('tr', {}, h('th', {}, 'Сотрудник'), h('th', {}, 'Организация'), h('th', {}, 'Заявки')),
          r.unsatisfied.slice(0, 50).map(([name, org, ids]) => h('tr', {}, h('td', {}, name), h('td', {}, org), h('td', {}, ids.length > 6 ? ids.slice(0, 6).join(', ') + ` и ещё ${ids.length - 6}` : ids.join(', '))))) : h('p', {class: 'blank'}, 'Нет')),
      h('div', {class: 'grid2'},
        section('Решения по предложениям ИИ', 'Сколько предложений ассистента инженеры приняли без правок, изменили или отклонили (ИИ-10).', h('table', {},
          h('tr', {}, h('th', {}, 'Предложение'), h('th', {}, 'Принято'), h('th', {}, 'Изменено'), h('th', {}, 'Отклонено')),
          h('tr', {}, h('td', {}, 'А4 · черновик ответа'), h('td', {}, k.drafts['Принять']), h('td', {}, k.drafts['Изменить']), h('td', {}, k.drafts['Отклонить'])),
          h('tr', {}, h('td', {}, 'А1 · тип обращения'), h('td', {}, k.types['Принять']), h('td', {}, k.types['Изменить']), h('td', {}, k.types['Отклонить'])))),
        cls ? section('Качество классификатора', 'Проверка на 1321 отложенном обращении. «Базовая» — точность, если всегда отвечать самым частым классом.',
          h('table', {}, h('tr', {}, h('th', {}, 'Задача'), h('th', {}, 'Accuracy'), h('th', {}, 'Macro-F1'), h('th', {}, 'Базовая')),
            h('tr', {}, h('td', {}, 'А1 · тип'), h('td', {}, cls.metrics.type.accuracy), h('td', {}, cls.metrics.type.macro_f1), h('td', {}, cls.metrics.type.baseline_majority)),
            h('tr', {}, h('td', {}, 'А2 · приоритет'), h('td', {}, cls.metrics.priority.accuracy), h('td', {}, cls.metrics.priority.macro_f1), h('td', {}, cls.metrics.priority.baseline_majority))),
          h('small', {}, 'Цель ИИ-01: accuracy ≥ 0,85 и macro-F1 ≥ 0,80. Данные синтетические, оценка оптимистична.')) : null));
  };
  from.addEventListener('change', load); to.addEventListener('change', load);
  await load();
}

function barEl(share) { const b = h('div', {class: 'bar'}); b.style.width = Math.round(share * 100) + '%'; return b; }

// ---------------------------------------------------------------- уведомления
const KIND_TIP = {
  'Новая заявка': 'BR-12: о новой заявке — отдельное письмо каждому инженеру и сообщение в канал Slack.',
  'Обновление заявки': 'BR-12: клиент ответил — письмо исполнителю (или всем инженерам, если исполнителя нет).',
  'Смена статуса': 'BR-12: смена статуса — сообщение в канал Slack.',
  'Предупреждение SLA': 'BR-11: за час до срока первого ответа — письмо всем инженерам (ASM-10).',
  'Нарушение SLA': 'BR-10: срок первого ответа истёк — письмо всем инженерам и руководителю.',
};

async function notificationsView() {
  const chan = h('select', {'aria-label': 'Канал'}, [['', 'Все каналы'], ['email', 'Почта'], ['slack', 'Slack']].map(([v, l]) => h('option', {value: v}, l)));
  const list = h('div', {class: 'card'});
  $('view').replaceChildren(
    pageHead('Журнал уведомлений', 'Письма и сообщения Slack, которые система отправила бы по правилам кейса. В учебном сервисе они не уходят наружу.', chan),
    list);
  const load = async () => {
    const rows = await api('/api/notifications' + (chan.value ? '?channel=' + chan.value : ''));
    list.replaceChildren(...(rows.length ? rows.map(n => h('div', {class: 'note'},
      h('span', {class: 'chan ' + n.channel, tip: n.channel === 'email' ? 'Корпоративная почта: отдельное письмо с деталями' : 'Канал #support в корпоративном Slack'}, n.channel === 'email' ? 'Письмо' : 'Slack'),
      h('div', {}, h('div', {class: 'row spread'}, h('b', {tip: KIND_TIP[n.kind] || ''}, n.kind + ' · ', h('a', {href: '#/queue/' + n.ticket}, n.ticket)), h('small', {}, fmt(n.at))),
        h('small', {}, 'Кому: ' + n.recipients), h('p', {}, n.text)))) : [h('p', {class: 'blank'}, 'Уведомлений пока нет. Они появятся, когда клиент создаст заявку или подойдёт срок.')]));
  };
  chan.addEventListener('change', load);
  await load();
  timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 20000);
}
