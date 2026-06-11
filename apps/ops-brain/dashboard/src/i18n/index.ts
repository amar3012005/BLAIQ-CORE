import { useState, useCallback, createContext, useContext } from 'react';
import { zh } from './zh';
import { en } from './en';

const langs = { zh, en } as const;
export type Lang = keyof typeof langs;
export type { Translations } from './zh';

function detectLang(): Lang {
  // 1. 用户手动设置过的优先
  const stored = localStorage.getItem('lang') as Lang;
  if (stored && stored in langs) return stored;
  // 2. 检测浏览器语言
  const browserLang = navigator.language?.toLowerCase() || '';
  if (browserLang.startsWith('zh')) return 'zh';
  return 'en'; // 默认英文
}

export function useLanguage() {
  const [lang, setLang] = useState<Lang>(detectLang);

  const t = langs[lang];

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    localStorage.setItem('lang', l);
  }, []);

  return { t, lang, switchLang };
}

// Context-based approach for sharing language state across the app
export const LanguageContext = createContext<ReturnType<typeof useLanguage> | null>(null);

export function useT() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Fallback: return zh translations directly when used outside provider
    return langs['zh'];
  }
  return ctx.t;
}
