import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { common as enCommon } from "../locales/en/common";
import { settings as enSettings } from "../locales/en/settings";
import { steam as enSteam } from "../locales/en/steam";
import { gameCard as enGameCard } from "../locales/en/gameCard";
import { common as arCommon } from "../locales/ar/common";
import { settings as arSettings } from "../locales/ar/settings";
import { steam as arSteam } from "../locales/ar/steam";
import { gameCard as arGameCard } from "../locales/ar/gameCard";

export type Language = "en" | "ar";
type Variables = Record<string, string | number>;
type Dictionary = Record<string, string>;

const dictionaries: Record<Language, Dictionary> = {
  en: { ...enCommon, ...enSettings, ...enSteam, ...enGameCard },
  ar: { ...arCommon, ...arSettings, ...arSteam, ...arGameCard }
};

type TranslationContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, variables?: Variables) => string;
};

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  const t = useCallback((key: string, variables: Variables = {}) => {
    const translated = dictionaries[language][key] ?? dictionaries.en[key];
    if (!translated) {
      if (import.meta.env.DEV) console.warn(`[i18n] Missing translation key: ${key}`);
      return key;
    }
    return translated.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(variables[name] ?? `{{${name}}}`)
    );
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);
  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation() {
  const value = useContext(TranslationContext);
  if (!value) throw new Error("useTranslation must be used within TranslationProvider");
  return value;
}
