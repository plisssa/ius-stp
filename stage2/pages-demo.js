// Только демонстрация GitHub Pages. Рабочие данные сервера сюда не попадают.
async function createBrowserDemo() {
  const response = await fetch('./data.json');
  if (!response.ok) throw Error('Не удалось загрузить учебные обращения');
  const data = await response.json();
  const visible = data.tickets.filter(ticket => ticket.org === 'ORG-A');
  const storageKey = 'stp-pages-demo-v1';
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
  saved.started ??= Date.now() / 1000;
  saved.decisions ??= {};
  function persist() { sessionStorage.setItem(storageKey, JSON.stringify(saved)); }
  persist();
  const actor = 'Демо в этой вкладке';
  return {
    get(path) {
      if (path === '/session') return {actor, articles:data.articles};
      return visible.map(ticket => {
        const decision = saved.decisions[ticket.id];
        const hours = {P2:4, P3:8, P4:24}[ticket.priority];
        return {...ticket, deadline:saved.started+hours*3600, answer:decision?.text||null, proposals:[],
          log:decision?[{actor, at:decision.at, event:'Ручной ответ', detail:'Учебная запись в браузере'}]:[]};
      });
    },
    decide(id, text) {
      if (!visible.some(t => t.id === id) || saved.decisions[id] || !text?.trim() || text.length > 2000)
        throw Error('Проверьте текст и состояние заявки');
      saved.decisions[id] = {text:text.trim(), at:new Date().toISOString()};
      persist();
      return {message:'Демонстрационный ответ сохранён в этой вкладке.'};
    }
  };
}
