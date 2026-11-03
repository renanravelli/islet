// Every UI string comes from strings.json, generated from section 6 of docs/design/ui-spec.md.

import { createContext, type ReactNode, useContext } from "react";
import strings from "./strings.json";

export type Locale = "pt-BR" | "en";
export type Key = keyof typeof strings.en;
export type Vars = Record<string, string | number>;

/** "pt-BR" or "en": the setting, or the system language when it is automatic. */
export function resolveLocale(setting: "auto" | Locale, system: string): Locale {
  if (setting !== "auto") return setting;
  return system.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

export function translate(locale: Locale, key: Key, vars: Vars = {}): string {
  const text: string = strings[locale][key] ?? strings.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Renders `**bold**` from the dictionary as <strong>. */
export function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of a fixed string
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): (key: Key, vars?: Vars) => string {
  const locale = useLocale();
  return (key, vars) => translate(locale, key, vars);
}
