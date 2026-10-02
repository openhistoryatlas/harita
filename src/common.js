// Helpers shared by the story page and the site index. The build inlines this file into both.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Per browser preferences. Storage can be missing or blocked, so every access is guarded.
const pref = (key, allowed, fallback) => { try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; } catch { return fallback; } };
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

// A translatable field for the current language, falling back to the default language.
const pick = (field, lang, defaultLang, fallback = '') => field?.[lang] ?? field?.[defaultLang] ?? fallback;

function fillSelect(sel, items, current, label) {
  sel.setAttribute('aria-label', label); sel.innerHTML = '';
  for (const { value, text } of items) { const o = document.createElement('option'); o.value = value; o.textContent = text; o.selected = value === current; sel.appendChild(o); }
}

// file:// pages refuse history.pushState, so fall back to setting the hash directly
function setHash(h, push) {
  if (location.hash === h) return;
  try { (push ? history.pushState : history.replaceState).call(history, null, '', h); }
  catch { if (push) location.hash = h; else location.replace(h); }
}
const hashParts = () => decodeURIComponent(location.hash.slice(1)).split('/').filter(Boolean);

// a web server resolves a folder to its index.html, a file:// URL shows a listing instead
const isFile = location.protocol === 'file:';
const storyLink = (id, lang) => `./${id}/${isFile ? 'index.html' : ''}#${lang}`;
const siteLink = lang => `../${isFile ? 'index.html' : ''}#${lang}`;

// The footer note on every page; the build fills in the repository URL from package.json
const REPO = '/*__REPO__*/';
const credit = ui => ui.generated_by.replace('{harita}', `<a href="${REPO}" target="_blank" rel="noopener">harita</a>`);

const applyPalette = id => { document.documentElement.dataset.palette = id; savePref('palette', id); };
const toggleLabel = (ui, allOpen) => allOpen ? ui.collapse_all : ui.expand_all;
