import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations
import arTranslation from './locales/ar.json';
import deTranslation from './locales/de.json';
import enTranslation from './locales/en.json';
import esTranslation from './locales/es.json';
import frTranslation from './locales/fr.json';
import itTranslation from './locales/it.json';
import jaTranslation from './locales/ja.json';
import koTranslation from './locales/ko.json';
import ptTranslation from './locales/pt.json';
import ruTranslation from './locales/ru.json';
import zhTranslation from './locales/zh.json';
// Import other language translations as needed

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ar: {
        translation: arTranslation
      },
      de: {
        translation: deTranslation
      },
      en: {
        translation: enTranslation
      },
      es: {
        translation: esTranslation
      },
      fr: {
        translation: frTranslation
      },
      it: {
        translation: itTranslation
      },
      ja: {
        translation: jaTranslation
      },
      ko: {
        translation: koTranslation
      },
      pt: {
        translation: ptTranslation
      },
      ru: {
        translation: ruTranslation
      },
      zh: {
        translation: zhTranslation
      },
      // Add other languages as needed
    },
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development',
    interpolation: {
      escapeValue: false // Not needed for React
    }
  });

export default i18n;