import { useTranslation } from 'react-i18next';

export const useTranslationTyped = () => {
  const { t: originalT, i18n } = useTranslation();
  
  // Create a wrapper function that always returns a string
  const t = (key: string, options?: any): string => {
    const translation = originalT(key, options);
    return translation === null ? key : String(translation);
  };

  return { t, i18n };
};