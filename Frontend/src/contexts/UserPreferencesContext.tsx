import React from 'react';
import { useEffect, useState, createContext, useContext } from 'react';
import { Auth } from 'aws-amplify';
import i18n from 'i18next';

interface UserPreferencesContextType {
  language: string;
  setLanguage: (language: string) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  agePreference: string;
  setAgePreference: (agePreference: string) => void;
  genderPreference: string;
  setGenderPreference: (genderPreference: string) => void;
  voicePreference: string;
  setVoicePreference: (voicePreference: string) => void;
  fontSize: string;
  setFontSize: (fontSize: string) => void;
  savePreferences: () => Promise<void>;
}

const defaultContext: UserPreferencesContextType = {
  language: 'en',
  setLanguage: () => {},
  theme: 'light',
  setTheme: () => {},
  agePreference: '8-10',
  setAgePreference: () => {},
  genderPreference: 'female',
  setGenderPreference: () => {},
  voicePreference: 'system',
  setVoicePreference: () => {},
  fontSize: 'medium',
  setFontSize: () => {},
  savePreferences: async () => {}
};

export const UserPreferencesContext = createContext<UserPreferencesContextType>(defaultContext);

export const useUserPreferences = () => useContext(UserPreferencesContext);

interface UserPreferencesProviderProps {
  children: React.ReactNode;
}

export const UserPreferencesProvider: React.FC<UserPreferencesProviderProps> = ({ children }) => {
  // Initialize state with values from localStorage
  const [language, setLanguageState] = useState<string>(
    () => localStorage.getItem('userLanguage') || i18n.language || 'en'
  );
  
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(
    () => (localStorage.getItem('userTheme') as 'light' | 'dark' | 'system') || 
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  
  const [agePreference, setAgePreferenceState] = useState<string>(
    () => localStorage.getItem('agePreference') || '8-10'
  );
  
  const [genderPreference, setGenderPreferenceState] = useState<string>(
    () => localStorage.getItem('genderPreference') || 'female'
  );
  
  const [voicePreference, setVoicePreferenceState] = useState<string>(
    () => localStorage.getItem('voicePreference') || 'system'
  );
  
  const [fontSize, setFontSizeState] = useState<string>(
    () => localStorage.getItem('fontSize') || 'medium'
  );
  
  // Apply theme class to html element
  useEffect(() => {
    if (theme === 'system') {
      // Use system preference
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      
      // Add listener for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        if (e.matches) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      };
      
      mediaQuery.addEventListener('change', handleChange);
      
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    } else if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);
  
  // Apply language changes
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language]);
  
  // Apply font size changes to document root
  useEffect(() => {
    // Remove any existing font size classes
    document.documentElement.classList.remove('text-sm', 'text-base', 'text-lg', 'text-xl');
    
    // Add the appropriate class based on fontSize
    switch (fontSize) {
      case 'small':
        document.documentElement.classList.add('text-sm');
        break;
      case 'medium':
        document.documentElement.classList.add('text-base');
        break;
      case 'large':
        document.documentElement.classList.add('text-lg');
        break;
      case 'x-large':
        document.documentElement.classList.add('text-xl');
        break;
      default:
        document.documentElement.classList.add('text-base');
    }
  }, [fontSize]);
  
  // Load user preferences from Cognito on mount
  useEffect(() => {
    const loadUserPreferences = async () => {
      try {
        const user = await Auth.currentAuthenticatedUser();
        const userAttributes = await Auth.userAttributes(user);
        
        // Check if user has custom preferences in attributes
        const customPreferences = userAttributes.find(
          attr => attr.Name === 'custom:preferences'
        );
        
        if (customPreferences && customPreferences.Value) {
          const preferences = JSON.parse(customPreferences.Value);
          
          if (preferences.language) {
            setLanguageState(preferences.language);
          }
          
          if (preferences.theme) {
            setThemeState(preferences.theme);
          }
          
          if (preferences.agePreference) {
            setAgePreferenceState(preferences.agePreference);
          }
          
          if (preferences.genderPreference) {
            setGenderPreferenceState(preferences.genderPreference);
          }
          
          if (preferences.voicePreference) {
            setVoicePreferenceState(preferences.voicePreference);
          }
          
          if (preferences.fontSize) {
            setFontSizeState(preferences.fontSize);
          }
        }
      } catch (error) {
        // User not authenticated or other error
        console.log('Unable to load user preferences from Cognito', error);
      }
    };
    
    loadUserPreferences();
  }, []);
  
  // Define setters that will update both state and localStorage
  const setLanguage = (value: string) => {
    localStorage.setItem('userLanguage', value);
    setLanguageState(value);
    savePreferencesToCognito({ language: value });
  };
  
  const setTheme = (value: 'light' | 'dark' | 'system') => {
    localStorage.setItem('userTheme', value);
    setThemeState(value);
    savePreferencesToCognito({ theme: value });
  };
  
  const setAgePreference = (value: string) => {
    localStorage.setItem('agePreference', value);
    setAgePreferenceState(value);
    savePreferencesToCognito({ agePreference: value });
  };
  
  const setGenderPreference = (value: string) => {
    localStorage.setItem('genderPreference', value);
    setGenderPreferenceState(value);
    savePreferencesToCognito({ genderPreference: value });
  };
  
  const setVoicePreference = (value: string) => {
    localStorage.setItem('voicePreference', value);
    setVoicePreferenceState(value);
    savePreferencesToCognito({ voicePreference: value });
  };
  
  const setFontSize = (value: string) => {
    localStorage.setItem('fontSize', value);
    setFontSizeState(value);
    savePreferencesToCognito({ fontSize: value });
  };
  
  // Helper function to save individual preferences to Cognito
  const savePreferencesToCognito = async (
    updatedPreference: Partial<{
      language: string;
      theme: string;
      agePreference: string;
      genderPreference: string;
      voicePreference: string;
      fontSize: string;
    }>
  ) => {
    try {
      const user = await Auth.currentAuthenticatedUser();
      const userAttributes = await Auth.userAttributes(user);
      
      // Check if user has custom preferences attribute
      const customPreferences = userAttributes.find(
        attr => attr.Name === 'custom:preferences'
      );
      
      let currentPreferences = {};
      
      if (customPreferences && customPreferences.Value) {
        currentPreferences = JSON.parse(customPreferences.Value);
      }
      
      // Update preferences with new values
      const updatedPreferences = {
        ...currentPreferences,
        ...updatedPreference
      };
      
      // Save to Cognito
      await Auth.updateUserAttributes(user, {
        'custom:preferences': JSON.stringify(updatedPreferences)
      });
    } catch (error) {
      // User not authenticated or other error
      console.log('Unable to save preferences to Cognito', error);
    }
  };
  
  // Helper function to save all preferences to Cognito
  const savePreferences = async (): Promise<void> => {
    try {
      const user = await Auth.currentAuthenticatedUser();
      
      // Get current preferences
      const userAttributes = await Auth.userAttributes(user);
      const customPreferences = userAttributes.find(
        attr => attr.Name === 'custom:preferences'
      );
      
      let currentPreferences = {};
      if (customPreferences && customPreferences.Value) {
        currentPreferences = JSON.parse(customPreferences.Value);
      }
      
      // Create a complete preferences object
      const completePreferences = {
        ...currentPreferences,
        language,
        theme,
        agePreference,
        genderPreference,
        voicePreference,
        fontSize
      };
      
      // Save to Cognito
      await Auth.updateUserAttributes(user, {
        'custom:preferences': JSON.stringify(completePreferences)
      });
      
      console.log('All preferences saved successfully');
    } catch (error) {
      console.error('Error saving all preferences to Cognito', error);
      throw error;
    }
  };
  
  const contextValue: UserPreferencesContextType = {
    language,
    setLanguage,
    theme,
    setTheme,
    agePreference,
    setAgePreference,
    genderPreference,
    setGenderPreference,
    voicePreference,
    setVoicePreference,
    fontSize,
    setFontSize,
    savePreferences
  };
  
  return (
    <UserPreferencesContext.Provider value={contextValue}>
      {children}
    </UserPreferencesContext.Provider>
  );
};