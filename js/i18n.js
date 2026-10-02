import { T, LANGS } from './text.js?v=1';

let lang = 'en';
export const getLang = () => lang;
export function detectLang() {
  const n = (navigator.language || 'en').toLowerCase();
  if (n.startsWith('ru')) return 'ru';
  if (n.startsWith('ms') || n.startsWith('id')) return 'ms';
  if (n.startsWith('zh')) return 'zh';
  return 'en';
}
export function t(key, vars) {
  let s = T[lang]?.[key] ?? T.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export function setLang(l) {
  lang = LANGS.some(x => x.id === l) ? l : 'en';
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}
export { LANGS };
