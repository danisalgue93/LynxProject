import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translations
import enTranslations from './locales/en.json';
import esTranslations from './locales/es.json';

const resources = {
  en: { translation: enTranslations },
  es: { translation: esTranslations },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });

// Setup logic for prioritizing language
export const initializeLanguage = async () => {
  // 1. Check if user manually selected a language
  const savedLanguage = localStorage.getItem('appLanguage');
  if (savedLanguage) {
    i18n.changeLanguage(savedLanguage);
    document.documentElement.lang = savedLanguage;
    return;
  }

  // 2. Check browser language
  const browserLangExact = navigator.language || '';
  const browserLang = browserLangExact.split('-')[0].toLowerCase();
  
  // If the browser language is explicitly one we support, we can use it directly
  if (browserLang === 'es' || browserLang === 'en') {
    i18n.changeLanguage(browserLang);
    document.documentElement.lang = browserLang;
    return;
  }

  // 3. Default: use browser language or fallback to English
  i18n.changeLanguage('en');
  document.documentElement.lang = 'en';
};

// Listen to language changes to update the HTML lang attribute
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

// Use this helper when the user manually changes the language from the UI
export const setUserLanguage = (lng: string) => {
  localStorage.setItem('appLanguage', lng);
  i18n.changeLanguage(lng);
};

export default i18n;
