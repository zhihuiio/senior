export type AppLanguage = 'zh-CN' | 'en-US'

export const APP_LANGUAGE_STORAGE_KEY = 'senior.app.language'
export const DEFAULT_APP_LANGUAGE: AppLanguage = 'en-US'
let runtimeLanguage: AppLanguage = DEFAULT_APP_LANGUAGE

export function normalizeAppLanguage(value: string | null | undefined): AppLanguage {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return DEFAULT_APP_LANGUAGE
  }

  if (normalized.startsWith('en')) {
    return 'en-US'
  }

  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  return DEFAULT_APP_LANGUAGE
}

export function getStoredAppLanguage(): AppLanguage {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_LANGUAGE
  }

  const stored = window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY)
  if (stored) {
    return normalizeAppLanguage(stored)
  }

  const systemLanguage = window.navigator.languages?.[0] || window.navigator.language
  return normalizeAppLanguage(systemLanguage)
}

export function setRuntimeAppLanguage(language: AppLanguage): void {
  runtimeLanguage = language
}

export function setStoredAppLanguage(language: AppLanguage): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language)
}

export function pickByLanguage(language: AppLanguage, zhText: string, enText: string): string {
  return language === 'en-US' ? enText : zhText
}

export function pickText(zhText: string, enText: string): string {
  return pickByLanguage(runtimeLanguage, zhText, enText)
}

runtimeLanguage = getStoredAppLanguage()
