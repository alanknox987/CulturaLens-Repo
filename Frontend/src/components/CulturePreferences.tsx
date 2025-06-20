import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface Voice {
  id: string;
  gender: string;
  age: string;
  accent: string;
  file: string;
}

interface VoicesData {
  [language: string]: {
    voices: Voice[];
  };
}

interface CulturalPreferences {
  age_preference: string;
  gender_preference: string;
  language_preference: string;
  voice_preference: string; // Added voice preference
}

interface CulturePreferencesProps {
  preferences: CulturalPreferences;
  setPreferences: React.Dispatch<React.SetStateAction<CulturalPreferences>>;
}

const CulturePreferences: React.FC<CulturePreferencesProps> = ({ preferences, setPreferences }) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setPreferences(prev => ({ ...prev, [name]: value }));
  };

  // Load available voices when language changes
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const response = await fetch('/assets/audio/voices.json');
        if (!response.ok) {
          throw new Error('Failed to load voices data');
        }
        
        const data: VoicesData = await response.json();
        
        // Get voices for current language, or fall back to English
        let languageVoices: Voice[] = [];
        if (data[preferences.language_preference] && data[preferences.language_preference].voices) {
          languageVoices = [...data[preferences.language_preference].voices];
        } else if (data.en && data.en.voices) {
          // Fallback to English if selected language not available
          languageVoices = [...data.en.voices];
        }
        
        // Add System option
        languageVoices.push({
          id: 'system',
          gender: '',
          age: '',
          accent: '',
          file: ''
        });
        
        setVoices(languageVoices);
        
        // If current preference doesn't exist in new language, switch to system
        if (
          preferences.voice_preference !== 'system' && 
          !languageVoices.some(voice => voice.id === preferences.voice_preference)
        ) {
          setPreferences(prev => ({ ...prev, voice_preference: 'system' }));
        }
      } catch (err) {
        console.error('Error loading voices:', err);
        // Fallback to just System option
        setVoices([{
          id: 'system',
          gender: '',
          age: '',
          accent: '',
          file: ''
        }]);
      }
    };

    loadVoices();
  }, [preferences.language_preference, setPreferences]);

  // Cleanup function for audio playback
  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  const stopAudio = () => {
    if (isPlaying) {
      window.speechSynthesis.cancel();
      
      if (audioElement) {
        audioElement.pause();
        audioElement.remove();
        setAudioElement(null);
      }
      
      setIsPlaying(false);
    }
  };

  const playPreview = () => {
    // Stop any current playback
    stopAudio();

    // Find the voice
    const voice = voices.find(v => v.id === preferences.voice_preference);
    if (!voice) return;

    // For system voice, use speech synthesis
    if (voice.id === 'system') {
      const utterance = new SpeechSynthesisUtterance(t('previewAudioText') || 'This is a preview of the system voice');
      
      utterance.onend = () => {
        setIsPlaying(false);
      };
      
      utterance.onerror = () => {
        setIsPlaying(false);
      };
      
      setIsPlaying(true);
      window.speechSynthesis.speak(utterance);
      return;
    }

    // For sample audio files
    const audioPath = `/assets/audio/${voice.file}`;
    const audio = new Audio(audioPath);
    
    audio.onended = () => {
      setIsPlaying(false);
      setAudioElement(null);
    };
    
    audio.onerror = () => {
      console.error(`Error playing audio: ${audioPath}`);
      setIsPlaying(false);
      setAudioElement(null);
    };
    
    setIsPlaying(true);
    setAudioElement(audio);
    audio.play().catch(err => {
      console.error('Error playing audio:', err);
      setIsPlaying(false);
      setAudioElement(null);
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="age_preference" className="block text-sm font-medium mb-1">
          {t('agePreference')}
        </label>
        <select
          id="age_preference"
          name="age_preference"
          value={preferences.age_preference}
          onChange={handleChange}
          className="w-full p-2 border rounded focus:ring focus:ring-blue-300"
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
        <label htmlFor="gender_preference" className="block text-sm font-medium mb-1">
          {t('genderPreference')}
        </label>
        <select
          id="gender_preference"
          name="gender_preference"
          value={preferences.gender_preference}
          onChange={handleChange}
          className="w-full p-2 border rounded focus:ring focus:ring-blue-300"
        >
          <option value="female">{t('genderFemale')}</option>
          <option value="male">{t('genderMale')}</option>
          <option value="none">{t('genderNone')}</option>
        </select>
      </div>
      
      <div>
        <label htmlFor="language_preference" className="block text-sm font-medium mb-1">
          {t('languagePreference')}
        </label>
        <select
          id="language_preference"
          name="language_preference"
          value={preferences.language_preference}
          onChange={handleChange}
          className="w-full p-2 border rounded focus:ring focus:ring-blue-300"
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
      
      {/* Voice Preference */}
      <div>
        <label htmlFor="voice_preference" className="block text-sm font-medium mb-1">
          {t('voicePreferenceLabel') || 'Voice Preference'}
        </label>
        <div className="flex items-center">
          <select
            id="voice_preference"
            name="voice_preference"
            value={preferences.voice_preference}
            onChange={handleChange}
            className="w-full p-2 border rounded focus:ring focus:ring-blue-300"
          >
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.id === 'system' 
                  ? t('systemVoice') || 'System Voice' 
                  : `${voice.id} (${voice.gender}, ${voice.age}${voice.accent ? `, ${voice.accent}` : ''})`}
              </option>
            ))}
          </select>
          
          <button
            type="button"
            className={`ml-2 p-2 rounded hover:bg-gray-200 ${
              isPlaying 
                ? 'text-red-500' 
                : 'text-gray-500'
            }`}
            onClick={isPlaying ? stopAudio : playPreview}
            aria-label={isPlaying ? t('stopPlaying') || 'Stop' : t('playPreview') || 'Preview'}
            title={isPlaying ? t('stopPlaying') || 'Stop' : t('playPreview') || 'Preview'}
          >
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CulturePreferences;