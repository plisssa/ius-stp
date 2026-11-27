// Только демонстрация GitHub Pages. Рабочие данные сервера сюда не попадают.
function utcOffset(seconds, zone) {
  const name = new Intl.DateTimeFormat('en-US', {timeZone:zone, timeZoneName:'longOffset'})
    .formatToParts(new Date(seconds * 1000)).find(part => part.type === 'timeZoneName').value;
  const match = name.match(/GMT([+-])(\d\d):(\d\d)/);
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60) : 0;
}

// Тот же расчёт, что deadline() в app.py: календарные или рабочие часы по договору организации.
function slaDeadline(contract, holidays, priority, registered) {
  let left = contract.norms[priority] * 3600;
  if (contract.hours === 'calendar') return registered + left;
  let moment = registered;
  for (let step = 0; step < 400; step++) {
    const offset = utcOffset(moment, contract.tz);
    const wall = new Date((moment + offset) * 1000);
    const day = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) / 1000;
    const opening = day + contract.start * 3600 - offset, closing = day + contract.end * 3600 - offset;
    const weekday = wall.getUTCDay(), date = new Date(day * 1000).toISOString().slice(0, 10);
    if (weekday > 0 && weekday < 6 && !holidays.includes(date) && moment < closing) {
      moment = Math.max(moment, opening);
      if (left <= closing - moment) return moment + left;
      left -= closing - moment;
    }
    moment = day + 86400 + contract.start * 3600 - offset;
  }
  throw Error('Не удалось рассчитать срок SLA');
}

async function createBrowserDemo() {
  const [response, slaResponse] = await Promise.all([fetch('./data.json'), fetch('./sla.json')]);
  if (!response.ok || !slaResponse.ok) throw Error('Не удалось загрузить учебные обращения');
  const data = await response.json(), sla = await slaResponse.json();
  const visible = data.tickets.filter(ticket => ticket.org === 'ORG-A');
  const storageKey = 'stp-pages-demo-v2';
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
  saved.started ??= Date.now() / 1000;
  saved.decisions ??= {};
  function persist() { sessionStorage.setItem(storageKey, JSON.stringify(saved)); }
  persist();
  const actor = 'Демо в этой вкладке';
  const deadlines = Object.fromEntries(visible.map(t => [t.id, slaDeadline(sla[t.org], sla.holidays, t.priority, saved.started)]));
  return {
    get(path) {
      if (path === '/session') return {actor, articles:data.articles, sla:sla['ORG-A']};
      return visible.map(ticket => {
        const decision = saved.decisions[ticket.id];
        const log = [{actor:'портал', at:new Date(saved.started * 1000).toISOString(), event:'Регистрация', detail:'Waiting for support · Unassigned'}];
        if (decision) log.unshift({actor, at:decision.at, event:'Ручной ответ', detail:'Учебная запись в браузере'});
        return {...ticket, registered:saved.started, deadline:deadlines[ticket.id], answer:decision?.text || null,
          answered:decision?.answered || null, status:decision ? 'Waiting for customer' : 'Waiting for support',
          assignee:decision ? actor : null, proposals:[], log};
      });
    },
    decide(id, text) {
      if (!visible.some(t => t.id === id) || saved.decisions[id] || !text?.trim() || text.length > 2000)
        throw Error('Проверьте текст и состояние заявки');
      saved.decisions[id] = {text:text.trim(), at:new Date().toISOString(), answered:Date.now() / 1000};
      persist();
      return {message:'Демонстрационный ответ сохранён в этой вкладке.'};
    }
  };
}
