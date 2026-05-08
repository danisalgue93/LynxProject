import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translations
import enTranslations from './locales/en.json';
import esTranslations from './locales/es.json';

const resources = {
  en: { translation: enTranslations },
  es: { translation: esTranslations },
};

// South American country codes + Spain
const spanishCountries = [
  'ES', // Spain
  'AR', // Argentina
  'BO', // Bolivia
  'BR', // Brazil
  'CL', // Chile
  'CO', // Colombia
  'EC', // Ecuador
  'GY', // Guyana
  'PY', // Paraguay
  'PE', // Peru
  'SR', // Suriname
  'UY', // Uruguay
  'VE', // Venezuela
  'FK', // Falkland Islands
  'GF', // French Guiana
];

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

  // 3. Fallback: Check IP for Geolocation caching if the browser is another language
  try {
    const cachedGeoLang = localStorage.getItem('geoLangCache');
    if (cachedGeoLang) {
       i18n.changeLanguage(cachedGeoLang);
       document.documentElement.lang = cachedGeoLang;
       return;
    }

    const response = await fetch('https://ipapi.co/json/');
    if (!response.ok) throw new Error('API Error');
    
    const data = await response.json();
    
    let detectedLang = 'en'; // default final
    if (data && data.country_code) {
      if (spanishCountries.includes(data.country_code.toUpperCase())) {
        detectedLang = 'es';
      }
    }
    
    // Cache the geo result so we don't call the API on every load
    localStorage.setItem('geoLangCache', detectedLang);
    
    i18n.changeLanguage(detectedLang);
    document.documentElement.lang = detectedLang;

  } catch (error) {
    console.warn('Error detecting location for language. Falling back to English.', error);
    // 4. Default final
    i18n.changeLanguage('en');
    document.documentElement.lang = 'en';
  }
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
