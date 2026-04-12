import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_APP_LANGUAGE,
  getStoredAppLanguage,
  pickByLanguage,
  setRuntimeAppLanguage,
  setStoredAppLanguage,
  type AppLanguage
} from './common'

interface I18nContextValue {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  t: (zhText: string, enText: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

interface I18nProviderProps {
  children: ReactNode
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [language, setLanguageState] = useState<AppLanguage>(() => getStoredAppLanguage())

  useEffect(() => {
    setRuntimeAppLanguage(language)
    setStoredAppLanguage(language)
  }, [language])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        setLanguageState(nextLanguage)
      },
      t: (zhText, enText) => pickByLanguage(language, zhText, enText)
    }),
    [language]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }

  return context
}

export type { AppLanguage }
