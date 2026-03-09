const refreshBtn = document.querySelector('#refreshBtn');
const timestampEl = document.querySelector('#timestamp');
const highlightsEl = document.querySelector('#highlights');
const marketsEl = document.querySelector('#markets');
const errorsEl = document.querySelector('#errors');

function fmtTimestamp(ts) {
  return new Date(ts).toLocaleString();
}

function render(data) {
  timestampEl.textContent = `Last updated: ${fmtTimestamp(data.generatedAt)}`;
  highlightsEl.innerHTML = '';
  marketsEl.innerHTML = '';

  for (const line of data.highlights) {
    const li = document.createElement('li');
    li.textContent = line;
    highlightsEl.appendChild(li);
  }

  for (const market of data.markets) {
    const card = document.createElement('article');
    card.className = 'market-card';
    card.innerHTML = `
      <h3>${market.title}</h3>
      <p class="meta">${market.platform}</p>
      <p>${market.snapshot}</p>
      <a href="${market.link}" target="_blank" rel="noreferrer">Open market ↗</a>
    `;
    marketsEl.appendChild(card);
  }

  errorsEl.textContent = data.errors.length
    ? `Data source warnings: ${data.errors.join(' | ')}`
    : '';
}

async function refresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Loading…';

  try {
    const response = await fetch('/api/summary');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
  } catch (error) {
    errorsEl.textContent = `Unable to load data: ${error.message}`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh summary';
  }
}

refreshBtn.addEventListener('click', refresh);
refresh();
