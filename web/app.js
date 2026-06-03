const state = {
  index: null,
  digest: null,
  selectedDate: null,
  visibleMonth: null,
  collapsed: false,
  language: 'zh'
};

const weekdayRow = document.getElementById('weekdayRow');
const calendarGrid = document.getElementById('calendarGrid');
const monthLabel = document.getElementById('monthLabel');
const monthSubtitle = document.getElementById('monthSubtitle');
const pageTitle = document.getElementById('pageTitle');
const calendarDropdown = document.getElementById('calendarDropdown');
const calendarPopover = document.getElementById('calendarPopover');
const contentHeaderDateButton = document.getElementById('contentHeaderDateButton');
const contentHeaderDate = document.getElementById('contentHeaderDate');
const selectedDateChip = document.getElementById('selectedDateChip');
const selectedCountChip = document.getElementById('selectedCountChip');
const cardsGrid = document.getElementById('cardsGrid');
const railTitle = document.getElementById('railTitle');
const railSummaryCard = document.getElementById('railSummaryCard');
const railSummaryZh = document.getElementById('railSummaryZh');
const railSummaryEn = document.getElementById('railSummaryEn');
const languageToggleButton = document.getElementById('languageToggleButton');
const sourceBlogCount = document.getElementById('sourceBlogCount');
const sourcePodcastCount = document.getElementById('sourcePodcastCount');
const sourceXCount = document.getElementById('sourceXCount');
const sourceBlogList = document.getElementById('sourceBlogList');
const sourcePodcastList = document.getElementById('sourcePodcastList');
const sourceXList = document.getElementById('sourceXList');
const sourceXToggle = document.getElementById('sourceXToggle');
const prevMonth = document.getElementById('prevMonth');
const nextMonth = document.getElementById('nextMonth');
const cardTemplate = document.getElementById('cardTemplate');

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_VISIBLE_X_SOURCES = 8;

function setCalendarOpen(isOpen) {
  calendarPopover.hidden = !isOpen;
  contentHeaderDateButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function buildDateFromKey(key) {
  return new Date(`${key}T00:00:00`);
}

function dateToKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function formatPostedAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw.slice(0, 10);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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
    .replace(/https?:\/\/[^\s<]+/g, (url) => `<a class="card-link" href="${url}" target="_blank" rel="noreferrer">${url}</a>`)
    .replace(/(^|[\s(>])@([A-Za-z0-9_]{1,15})\b/g, (match, prefix, handle) => `${prefix}<a class="card-link" href="https://x.com/${handle}" target="_blank" rel="noreferrer">@${handle}</a>`)
    .replace(/\n/g, '<br />');
}

function applyLinkExpansions(text, section) {
  let output = String(text || '');
  const expansions = Array.isArray(section?.linkExpansions) ? section.linkExpansions : [];
  expansions
    .slice()
    .sort((left, right) => String(right.shortUrl || '').length - String(left.shortUrl || '').length)
    .forEach((entry) => {
      const shortUrl = String(entry?.shortUrl || '').trim();
      if (!shortUrl) return;
      if (entry.kind === 'external' && entry.resolvedUrl) {
        output = output.split(shortUrl).join(entry.resolvedUrl);
        return;
      }
      output = output.split(shortUrl).join('');
    });

  return output
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function stripSummaryPrefix(text) {
  return String(text || '')
    .replace(/^English:\s*/i, '')
    .replace(/^中文：\s*/i, '')
    .trim();
}

function splitBilingualSummary(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitSummaryLanguage(summary) {
  const parts = splitBilingualSummary(summary);
  return {
    english: parts[0] ? stripSummaryPrefix(parts[0]) : '',
    chinese: parts[1] ? stripSummaryPrefix(parts[1]) : ''
  };
}

function buildBulletList(text, isChinese = false) {
  const list = document.createElement('ul');
  list.className = `detail-bullets${isChinese ? ' detail-bullets-cn' : ''}`;
  const segments = isChinese
    ? text.split(/[；;]\s*/)
    : text.split(/;\s+/);
  segments
    .map((part) => part.trim().replace(isChinese ? /。$/ : /\.$/, ''))
    .filter(Boolean)
    .forEach((part) => {
      const item = document.createElement('li');
      item.className = 'detail-bullet';
      item.innerHTML = renderMarkdownLite(part);
      list.appendChild(item);
    });
  return list;
}

function renderRailSummary(summary) {
  const { english, chinese } = splitSummaryLanguage(summary);
  const nodes = [];

  if (english) {
    nodes.push(buildBulletList(english, false));
  }

  if (english && chinese) {
    const divider = document.createElement('div');
    divider.className = 'detail-summary-divider';
    nodes.push(divider);
  }

  if (chinese) {
    nodes.push(buildBulletList(chinese, true));
  }

  if (nodes.length === 0) {
    const paragraph = document.createElement('p');
    paragraph.className = 'detail-summary-line';
    paragraph.textContent = 'No digest found for this date.';
    return [paragraph];
  }

  return nodes;
}

function renderSingleLanguageSummary(summary, language) {
  const { english, chinese } = splitSummaryLanguage(summary);
  const text = language === 'zh' ? chinese : english;
  if (!text) {
    const paragraph = document.createElement('p');
    paragraph.className = 'detail-summary-line';
    paragraph.textContent = 'No digest found for this date.';
    return [paragraph];
  }
  return [buildBulletList(text, language === 'zh')];
}

function splitHeadlineLanguages(headline) {
  const value = String(headline || '').trim();
  if (!value) {
    return {
      chinese: '',
      english: ''
    };
  }
  const segments = value
    .split(/\s*(?:[|｜]|·)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chinese = segments.find((part) => /[\u3400-\u9fff]/.test(part)) || '';
  const english = segments.find((part) => !/[\u3400-\u9fff]/.test(part)) || '';
  return {
    chinese: chinese || value,
    english
  };
}

function stripBoldMarkdown(text) {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1');
}

function renderCardHeadline(headline, language) {
  const { chinese, english } = splitHeadlineLanguages(headline);
  if (language === 'en') {
    return renderMarkdownLite(stripBoldMarkdown(english || chinese || ''));
  }
  const chineseHtml = renderMarkdownLite(chinese || '');
  if (!english || normalizeComparableText(chinese) === normalizeComparableText(english)) {
    return chineseHtml;
  }
  return `${chineseHtml} <span class="card-title-separator">|</span> <span class="card-title-en">${renderMarkdownLite(stripBoldMarkdown(english))}</span>`;
}

function normalizeMediaEntries(section) {
  const candidates = Array.isArray(section?.media) ? section.media : [];
  return candidates
    .map((entry) => {
      if (typeof entry === 'string') {
        return { url: entry, alt: '' };
      }
      if (entry?.url) {
        return {
          url: entry.url,
          alt: entry.alt || ''
        };
      }
      return null;
    })
    .filter(Boolean);
}

function previewHostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function trimPreviewText(text, maxLength = 280) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function renderQuoteMeta(preview) {
  const authorName = String(preview?.authorName || '').trim();
  const authorHandle = String(preview?.authorHandle || '').replace(/^@/, '').trim();
  const parts = [];
  if (authorName) {
    parts.push(`<span class="preview-author">${renderMarkdownLite(authorName)}</span>`);
  }
  if (authorHandle) {
    parts.push(`<span class="preview-handle">@${renderMarkdownLite(authorHandle)}</span>`);
  }
  if (preview?.displayDate) {
    parts.push(`<span class="preview-date">${renderMarkdownLite(preview.displayDate)}</span>`);
  }
  if (parts.length === 0) return '';
  return parts.join(' <span class="preview-dot">·</span> ');
}

function renderPreviewCard(preview) {
  if (!preview || !preview.resolvedUrl) return null;

  const card = document.createElement('a');
  card.className = `preview-card${preview.type === 'tweet' ? ' preview-card-tweet' : ''}`;
  card.href = preview.resolvedUrl;
  card.target = '_blank';
  card.rel = 'noreferrer';

  if (preview.type === 'tweet') {
    const metaHtml = renderQuoteMeta(preview);
    if (metaHtml) {
      const meta = document.createElement('div');
      meta.className = 'preview-meta-line';
      meta.innerHTML = metaHtml;
      card.appendChild(meta);
    }

    const previewText = state.language === 'zh'
      ? (preview.textZh || preview.text || '')
      : (preview.text || '');

    if (previewText) {
      const text = document.createElement('div');
      text.className = 'preview-text';
      text.innerHTML = renderMarkdownLite(trimPreviewText(previewText, 360));
      card.appendChild(text);
    }
    return card;
  }

  if (preview.image) {
    const image = document.createElement('img');
    image.className = 'preview-image';
    image.src = preview.image;
    image.alt = preview.title || preview.siteName || 'Link preview image';
    image.loading = 'eager';
    image.decoding = 'async';
    card.appendChild(image);
  }

  return null;
}

function renderSectionPreviews(previews) {
  return (Array.isArray(previews) ? previews : [])
    .map((preview) => renderPreviewCard(preview))
    .filter(Boolean);
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

  const url = String(item.profile_url || '');
  if (url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const match = url.match(/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `https://unavatar.io/youtube/${match[1]}`;
      }
    }

    try {
      const hostname = new URL(url).hostname;
      if (hostname) {
        return `https://unavatar.io/${hostname}`;
      }
    } catch (e) {
      // ignore
    }
  }

  if (normalizeSourceKind(item) === 'blog') {
    return 'https://unavatar.io/anthropic.com';
  }
  if (normalizeSourceKind(item) === 'podcast') {
    return 'https://unavatar.io/youtube.com';
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
  }).sort((left, right) => {
    const leftTime = Date.parse(left.item?.posted_at || '') || 0;
    const rightTime = Date.parse(right.item?.posted_at || '') || 0;
    return rightTime - leftTime;
  });
}

function splitXBody(text) {
  const paragraphs = String(text || '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chinese = [];
  const original = [];
  for (const paragraph of paragraphs) {
    if (/[\u3400-\u9fff]/.test(paragraph)) {
      chinese.push(paragraph);
    } else {
      original.push(paragraph);
    }
  }
  return {
    original: original.join('\n\n'),
    chinese: chinese.join('\n\n')
  };
}

function splitBodyByLanguage(text) {
  const paragraphs = String(text || '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chinese = [];
  const english = [];
  for (const paragraph of paragraphs) {
    if (/[\u3400-\u9fff]/.test(paragraph)) {
      chinese.push(paragraph);
    } else {
      english.push(paragraph);
    }
  }
  return {
    chinese: chinese.join('\n\n'),
    english: english.join('\n\n')
  };
}

function normalizeComparableText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function renderXChineseBody(splitBody) {
  const original = splitBody.original || '';
  const chinese = splitBody.chinese || splitBody.original || '';
  if (!chinese) return '';
  if (original && normalizeComparableText(chinese) === normalizeComparableText(original)) {
    return '';
  }
  return `<div class="translation-copy">${renderMarkdownLite(chinese)}</div>`;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

function setLanguage(language) {
  state.language = language;
  railSummaryCard.classList.toggle('is-zh', language === 'zh');
  railSummaryCard.classList.toggle('is-en', language === 'en');
  languageToggleButton.textContent = language === 'zh' ? 'En' : '中';
  languageToggleButton.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换到中文');
  if (state.digest) {
    renderCards();
  }
}

function renderSourceList(container, entries, formatter) {
  const items = entries.map((entry) => {
    const anchor = document.createElement('a');
    anchor.className = 'source-inline-link';
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.href = entry.url || '#';
    anchor.textContent = formatter(entry);
    return anchor;
  });

  const nodes = [];
  items.forEach((anchor, index) => {
    nodes.push(anchor);
    if (index < items.length - 1) {
      const separator = document.createElement('span');
      separator.className = 'source-inline-separator';
      separator.textContent = ' | ';
      nodes.push(separator);
    }
  });

  container.replaceChildren(...nodes);
}

function renderSources() {
  const sources = state.sources || { blogs: [], podcasts: [], x: [] };
  const visibleXSources = sources.x || [];
  sourceBlogCount.textContent = String(sources.blogs.length || 0);
  sourcePodcastCount.textContent = String(sources.podcasts.length || 0);
  sourceXCount.textContent = String(sources.x.length || 0);
  renderSourceList(sourceBlogList, sources.blogs || [], (entry) => entry.name);
  renderSourceList(sourcePodcastList, sources.podcasts || [], (entry) => entry.name);
  renderSourceList(sourceXList, visibleXSources, (entry) => entry.handle ? `${entry.name} (@${entry.handle})` : entry.name);
  if (sourceXToggle) {
    sourceXToggle.hidden = true;
  }
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
    const isInMonth = monthKey(current) === state.visibleMonth;
    const hasEntry = availableDates.has(key);
    if (!isInMonth) {
      button.classList.add('outside');
    } else if (hasEntry) {
      button.classList.add('has-entry');
    } else {
      button.classList.add('no-entry');
    }
    if (key === state.selectedDate) button.classList.add('selected');
    button.textContent = String(current.getDate());
    button.disabled = !hasEntry;
    if (hasEntry) {
      button.addEventListener('click', () => selectDate(key));
    }
    cells.push(button);
  }
  calendarGrid.replaceChildren(...cells);
}

function renderCards() {
  const payload = state.digest?.payload;
  const cards = payload ? flattenCards(payload) : [];
  const language = state.language || 'zh';
  pageTitle.textContent = '哎嘛 AI Builder News';
  contentHeaderDate.textContent = payload?.date || '--';
  selectedDateChip.textContent = payload?.date || '--';
  selectedCountChip.textContent = `${cards.length} cards`;
  railTitle.textContent = 'Overview';
  railSummaryZh.replaceChildren(...renderSingleLanguageSummary(payload?.summary, 'zh'));
  railSummaryEn.replaceChildren(...renderSingleLanguageSummary(payload?.summary, 'en'));

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
    const xOriginal = fragment.querySelector('[data-x-original]');
    const summaryBlock = fragment.querySelector('[data-summary-block]');
    const summaryBody = fragment.querySelector('[data-card-body]');
    const fallbackBody = fragment.querySelector('[data-card-body-fallback]');
    const media = fragment.querySelector('[data-card-media]');
    const previews = fragment.querySelector('[data-card-previews]');
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
    profileMeta.textContent = `${item.source_label || ''} · ${formatPostedAt(item.posted_at)}`.replace(/^ · | · $/g, '');
    title.innerHTML = renderCardHeadline(section.headline || '', language);

    const body = applyLinkExpansions(section.body || '', section);
    if (isSummaryCard(item)) {
      summaryBlock.hidden = false;
      const splitBody = splitBodyByLanguage(body);
      const summaryText = language === 'zh'
        ? (splitBody.chinese || splitBody.english || '')
        : (splitBody.english || splitBody.chinese || '');
      summaryBody.innerHTML = renderMarkdownLite(summaryText);
      xOriginal.remove();
      fallbackBody.remove();
    } else {
      const splitBody = splitXBody(body);
      if (language === 'zh') {
        const chineseText = splitBody.chinese || splitBody.original || '';
        xOriginal.hidden = false;
        xOriginal.classList.add('is-plain-translation');
        xOriginal.innerHTML = `<div class="translation-copy">${renderMarkdownLite(chineseText)}</div>`;
        fallbackBody.remove();
      } else {
        const englishText = splitBody.original || splitBody.chinese || '';
        xOriginal.classList.remove('is-plain-translation');
        fallbackBody.innerHTML = `<div class="original-english-copy">${renderMarkdownLite(englishText)}</div>`;
        xOriginal.remove();
      }
      summaryBlock.remove();
    }

    const mediaEntries = normalizeMediaEntries(section);
    if (mediaEntries.length > 0) {
      media.hidden = false;
      media.replaceChildren(
        ...mediaEntries.map((entry) => {
          const image = document.createElement('img');
          image.className = 'card-image';
          image.src = entry.url;
          image.alt = entry.alt || title.textContent || item.person_name || 'Post image';
          image.loading = 'eager';
          image.decoding = 'async';
          return image;
        })
      );
    } else {
      media.remove();
    }

    const previewEntries = renderSectionPreviews((section.previews || []).filter((entry) => entry.type === 'tweet'));
    if (previewEntries.length > 0) {
      previews.hidden = false;
      previews.replaceChildren(...previewEntries);
    } else {
      previews.remove();
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
  renderCalendar();
  renderCards();
  setCalendarOpen(false);
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
  state.sources = await fetchJson('./data/sources.json').catch(() => ({ blogs: [], podcasts: [], x: [] }));
  state.sourceXExpanded = false;
  renderSources();
  setLanguage('zh');
  const latestDate = state.index.latestDate || state.index.dates?.[0]?.date;
  if (!latestDate) {
    renderCards();
    return;
  }
  languageToggleButton.addEventListener('click', () => {
    setLanguage(state.language === 'zh' ? 'en' : 'zh');
  });
  sourceXToggle.addEventListener('click', () => {
    state.sourceXExpanded = !state.sourceXExpanded;
    renderSources();
  });
  contentHeaderDateButton.addEventListener('click', () => {
    const isOpen = contentHeaderDateButton.getAttribute('aria-expanded') === 'true';
    setCalendarOpen(!isOpen);
  });
  document.addEventListener('click', (event) => {
    if (!calendarDropdown.contains(event.target)) {
      setCalendarOpen(false);
    }
  });
  const sourcesToggleBtn = document.getElementById('sourcesToggleBtn');
  const sourcesPopover = document.getElementById('sourcesPopover');
  if (sourcesToggleBtn && sourcesPopover) {
    sourcesToggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      sourcesPopover.classList.toggle('is-open');
    });
    document.addEventListener('click', (event) => {
      if (!sourcesPopover.contains(event.target) && !sourcesToggleBtn.contains(event.target)) {
        sourcesPopover.classList.remove('is-open');
      }
    });
  }

  prevMonth.addEventListener('click', () => shiftMonth(-1));
  nextMonth.addEventListener('click', () => shiftMonth(1));
  await selectDate(latestDate);
}

init().catch((error) => {
  if (railSummaryZh) {
    railSummaryZh.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'detail-summary-line',
      textContent: error.message
    }));
  }
  cardsGrid.innerHTML = `<div class="empty-state">${error.message}</div>`;
});
