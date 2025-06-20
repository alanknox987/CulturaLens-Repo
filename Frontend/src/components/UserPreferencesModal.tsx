// src/components/UserPreferencesModal.tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserPreferences } from '../contexts/UserPreferencesContext';
import VoicePreference from './VoicePreference'; // Import the new component

interface UserPreferencesModalProps {
  onClose: () => void;
}

const UserPreferencesModal: React.FC<UserPreferencesModalProps> = ({ onClose }) => {
  const { t, i18n } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const { 
    agePreference, 
    setAgePreference,
    genderPreference, 
    setGenderPreference,
    language, 
    setLanguage,
    voicePreference,
    setVoicePreference,
    fontSize, 
    setFontSize,
    theme,
    setTheme,
    savePreferences
  } = useUserPreferences();

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = e.target.value;
    setLanguage(newLanguage);
    i18n.changeLanguage(newLanguage);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await savePreferences();
    } catch (error) {
      console.error('Error saving preferences:', error);
    } finally {
      setIsSaving(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{t('userPreferences')}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="agePreference" className="block text-sm font-medium mb-1">
              {t('agePreference')}
            </label>
            <select
              id="agePreference"
              value={agePreference}
              onChange={(e) => setAgePreference(e.target.value)}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="3-5">{t('age3to5')}</option>
              <option value="6-7">{t('age6to7')}</option>
              <option value="8-10">{t('age8to10')}</option>
              <option value="11-13">{t('age11to13')}</option>
              <option value="14-18">{t('age14to18')}</option>
              <option value="19-24">{t('age19to24')}</option>
              <option value="25-34">{t('age25to34')}</option>
              <option value="35-49">{t('age35to49')}</option>
              <option value="50-64">{t('age50to64')}</option>
              <option value="65plus">{t('age65plus')}</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="genderPreference" className="block text-sm font-medium mb-1">
              {t('genderPreference')}
            </label>
            <select
              id="genderPreference"
              value={genderPreference}
              onChange={(e) => setGenderPreference(e.target.value)}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="female">{t('genderFemale')}</option>
              <option value="male">{t('genderMale')}</option>
              <option value="none">{t('genderNone')}</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="language" className="block text-sm font-medium mb-1">
              {t('language')}
            </label>
            <select
              id="language"
              value={language}
              onChange={handleLanguageChange}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
              <option value="pt">Português</option>
              <option value="ru">Русский</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="ar">العربية</option>
            </select>
          </div>
          
          {/* Voice Preference Component - Added here, just after language selection */}
          <div>
            <VoicePreference
              language={language}
              voicePreference={voicePreference}
              setVoicePreference={setVoicePreference}
            />
          </div>
          
          <div>
            <label htmlFor="theme" className="block text-sm font-medium mb-1">
              {t('theme')}
            </label>
            <select
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="system">{t('themeSystem')}</option>
              <option value="light">{t('themeLight')}</option>
              <option value="dark">{t('themeDark')}</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="fontSize" className="block text-sm font-medium mb-1">
              {t('fontSize')}
            </label>
            <select
              id="fontSize"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="small">{t('fontSizeSmall')}</option>
              <option value="medium">{t('fontSizeMedium')}</option>
              <option value="large">{t('fontSizeLarge')}</option>
            </select>
          </div>
        </div>
        
        <button
          onClick={handleSave}
          className="mt-6 w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 flex items-center justify-center"
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {t('saving') || ''}
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {t('savePreferences') || ''}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default UserPreferencesModal;