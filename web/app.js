const state = {
  index: null,
  digest: null,
  selectedDate: null,
  visibleMonth: null,
  collapsed: false
};

const weekdayRow = document.getElementById('weekdayRow');
const calendarGrid = document.getElementById('calendarGrid');
const monthLabel = document.getElementById('monthLabel');
const monthSubtitle = document.getElementById('monthSubtitle');
const dateList = document.getElementById('dateList');
const archiveCount = document.getElementById('archiveCount');
const pageTitle = document.getElementById('pageTitle');
const pageSummary = document.getElementById('pageSummary');
const selectedDateChip = document.getElementById('selectedDateChip');
const selectedCountChip = document.getElementById('selectedCountChip');
const cardsGrid = document.getElementById('cardsGrid');
const collapseSidebar = document.getElementById('collapseSidebar');
const sidebar = document.querySelector('.sidebar');
const prevMonth = document.getElementById('prevMonth');
const nextMonth = document.getElementById('nextMonth');
const cardTemplate = document.getElementById('cardTemplate');

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function buildDateFromKey(key) {
  return new Date(`${key}T00:00:00`);
}

function dateToKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long'
  }).format(date);
}

function initialsForName(name) {
  const parts = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'AI';
}

function renderMarkdownLite(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />');
}

function normalizeSourceKind(item) {
  const label = String(item.source_label || '').toLowerCase();
  const url = String(item.profile_url || '').toLowerCase();
  if (label.includes('podcast') || url.includes('youtube.com')) return 'podcast';
  if (label.includes('blog') || url.includes('/blog')) return 'blog';
  return 'x';
}

function avatarUrlForItem(item) {
  if (item.person_handle) {
    return `https://unavatar.io/x/${String(item.person_handle).replace(/^@/, '')}`;
  }
  if (normalizeSourceKind(item) === 'blog') {
    return 'https://www.anthropic.com/images/icons/apple-touch-icon.png';
  }
  if (normalizeSourceKind(item) === 'podcast') {
    return 'https://www.youtube.com/s/desktop/fe7d0c88/img/favicon_144x144.png';
  }
  return '';
}

function isSummaryCard(item) {
  const kind = normalizeSourceKind(item);
  return kind === 'blog' || kind === 'podcast';
}

function flattenCards(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.flatMap((item) => {
    const sections = Array.isArray(item.sections) ? item.sections : [];
    return sections.map((section) => ({ item, section }));
  });
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

function renderWeekdays() {
  weekdayRow.replaceChildren(
    ...WEEKDAYS.map((day) => {
      const div = document.createElement('div');
      div.className = 'weekday';
      div.textContent = day;
      return div;
    })
  );
}

function renderDateList() {
  const dates = state.index?.dates || [];
  archiveCount.textContent = `${dates.length}d`;
  dateList.replaceChildren(
    ...dates.map((entry) => {
      const button = document.createElement('button');
      button.className = `date-pill${entry.date === state.selectedDate ? ' active' : ''}`;
      button.type = 'button';
      button.innerHTML = `<span class="pill-date">${entry.date}</span><span class="pill-count">${entry.itemCount} cards</span>`;
      button.addEventListener('click', () => selectDate(entry.date));
      return button;
    })
  );
}

function renderCalendar() {
  if (!state.visibleMonth || !state.index) return;

  const [year, month] = state.visibleMonth.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const start = new Date(firstDay);
  const weekday = (firstDay.getDay() + 6) % 7;
  start.setDate(firstDay.getDate() - weekday);
  const availableDates = new Set((state.index.dates || []).map((entry) => entry.date));
  const selectedMonthLabel = formatMonthLabel(firstDay);

  monthLabel.textContent = selectedMonthLabel;
  monthSubtitle.textContent = state.selectedDate || 'Choose a day';

  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const key = dateToKey(current);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-button';
    if (monthKey(current) !== state.visibleMonth) button.classList.add('outside');
    if (availableDates.has(key)) button.classList.add('has-entry');
    if (key === state.selectedDate) button.classList.add('selected');
    button.textContent = String(current.getDate());
    button.disabled = !availableDates.has(key);
    if (availableDates.has(key)) {
      button.addEventListener('click', () => selectDate(key));
    }
    cells.push(button);
  }
  calendarGrid.replaceChildren(...cells);
}

function renderCards() {
  const payload = state.digest?.payload;
  const cards = payload ? flattenCards(payload) : [];
  pageTitle.textContent = payload?.title || 'AI Builders Daily';
  pageSummary.textContent = payload?.summary || 'No digest found for this date.';
  selectedDateChip.textContent = payload?.date || '--';
  selectedCountChip.textContent = `${cards.length} cards`;

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No digest published for this day.';
    cardsGrid.replaceChildren(empty);
    return;
  }

  const nodes = cards.map(({ item, section }) => {
    const fragment = cardTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.digest-card');
    const avatar = fragment.querySelector('[data-avatar]');
    const profileLink = fragment.querySelector('[data-profile-link]');
    const profileIdentity = fragment.querySelector('[data-profile-identity]');
    const profileMeta = fragment.querySelector('[data-profile-meta]');
    const title = fragment.querySelector('[data-card-title]');
    const summaryBlock = fragment.querySelector('[data-summary-block]');
    const summaryBody = fragment.querySelector('[data-card-body]');
    const fallbackBody = fragment.querySelector('[data-card-body-fallback]');
    const links = fragment.querySelector('[data-card-links]');

    const avatarUrl = avatarUrlForItem(item);
    if (avatarUrl) {
      avatar.style.backgroundImage = `url("${avatarUrl}")`;
    } else {
      avatar.classList.add('initials');
      avatar.textContent = initialsForName(item.person_name);
    }

    profileLink.textContent = item.person_name || 'Unknown';
    profileLink.href = item.profile_url || '#';
    profileIdentity.textContent = item.person_identity || item.source_label || '';
    profileMeta.textContent = `${item.source_label || ''} · ${String(item.posted_at || '').slice(0, 10)}`.replace(/^ · | · $/g, '');
    title.innerHTML = renderMarkdownLite(section.headline || '');

    const body = section.body || '';
    if (isSummaryCard(item)) {
      summaryBlock.hidden = false;
      summaryBody.innerHTML = renderMarkdownLite(body);
      fallbackBody.remove();
    } else {
      fallbackBody.innerHTML = renderMarkdownLite(body);
      summaryBlock.remove();
    }

    const sourceLinks = Array.isArray(section.source_links) ? section.source_links : [];
    links.replaceChildren(
      ...sourceLinks.map((entry) => {
        const anchor = document.createElement('a');
        anchor.className = 'card-link';
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        if (typeof entry === 'string') {
          anchor.href = entry;
          anchor.textContent = 'View source';
        } else {
          anchor.href = entry.url;
          anchor.textContent = entry.label || 'View source';
        }
        return anchor;
      })
    );

    return root;
  });

  cardsGrid.replaceChildren(...nodes);
}

async function selectDate(dateKey) {
  state.selectedDate = dateKey;
  state.visibleMonth = monthKey(buildDateFromKey(dateKey));
  state.digest = await fetchJson(`./data/digests/${dateKey}.json`);
  renderDateList();
  renderCalendar();
  renderCards();
}

function toggleSidebar() {
  state.collapsed = !state.collapsed;
  sidebar.dataset.collapsed = String(state.collapsed);
}

function shiftMonth(offset) {
  if (!state.visibleMonth) return;
  const [year, month] = state.visibleMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  state.visibleMonth = monthKey(date);
  renderCalendar();
}

async function init() {
  renderWeekdays();
  state.index = await fetchJson('./data/index.json');
  const latestDate = state.index.latestDate || state.index.dates?.[0]?.date;
  if (!latestDate) {
    renderCards();
    return;
  }
  collapseSidebar.addEventListener('click', toggleSidebar);
  prevMonth.addEventListener('click', () => shiftMonth(-1));
  nextMonth.addEventListener('click', () => shiftMonth(1));
  await selectDate(latestDate);
}

init().catch((error) => {
  pageSummary.textContent = error.message;
  cardsGrid.innerHTML = `<div class="empty-state">${error.message}</div>`;
});
