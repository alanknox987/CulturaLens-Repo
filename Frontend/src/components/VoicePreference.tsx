// src/components/VoicePreference.tsx
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

interface VoicePreferenceProps {
  language: string;
  voicePreference: string;
  setVoicePreference: (voice: string) => void;
}

const VoicePreference: React.FC<VoicePreferenceProps> = ({
  language,
  voicePreference,
  setVoicePreference,
}) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Load voices.json file
    const loadVoices = async () => {
      try {
        setLoading(true);
        const response = await fetch('/assets/audio/voices.json');
        if (!response.ok) {
          throw new Error('Failed to load voices data');
        }
        
        const data: VoicesData = await response.json();
        
        // Get voices for current language, or fall back to English
        let languageVoices: Voice[] = [];
        if (data[language] && data[language].voices) {
          languageVoices = [...data[language].voices];
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
          voicePreference !== 'system' && 
          !languageVoices.some(voice => voice.id === voicePreference)
        ) {
          setVoicePreference('system');
        }
        
        setError(null);
      } catch (err) {
        console.error('Error loading voices:', err);
        setError(t('errorLoadingVoices') || 'Error loading voices');
        // Fallback to just System option
        setVoices([{
          id: 'system',
          gender: '',
          age: '',
          accent: '',
          file: ''
        }]);
      } finally {
        setLoading(false);
      }
    };

    loadVoices();
  }, [language, setVoicePreference, t, voicePreference]);

  // Cleanup audio when component unmounts
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
      
      setIsPlaying(null);
    }
  };

  const playPreview = (voiceId: string) => {
    // Stop any current playback
    stopAudio();

    // If we clicked the same voice that's playing, just stop it
    if (isPlaying === voiceId) {
      return;
    }

    // Find the voice
    const voice = voices.find(v => v.id === voiceId);
    if (!voice) return;

    // For system voice, use speech synthesis
    if (voice.id === 'system') {
      const utterance = new SpeechSynthesisUtterance(t('previewAudioText') || 'This is a preview of the system voice');
      
      utterance.onend = () => {
        setIsPlaying(null);
      };
      
      utterance.onerror = () => {
        setIsPlaying(null);
      };
      
      setIsPlaying(voice.id);
      window.speechSynthesis.speak(utterance);
      return;
    }

    // For sample audio files
    const audioPath = `/assets/audio/${voice.file}`;
    const audio = new Audio(audioPath);
    
    audio.onended = () => {
      setIsPlaying(null);
      setAudioElement(null);
    };
    
    audio.onerror = () => {
      console.error(`Error playing audio: ${audioPath}`);
      setIsPlaying(null);
      setAudioElement(null);
    };
    
    setIsPlaying(voice.id);
    setAudioElement(audio);
    audio.play().catch(err => {
      console.error('Error playing audio:', err);
      setIsPlaying(null);
      setAudioElement(null);
    });
  };

  return (
    <div>
      <label htmlFor="voicePreference" className="block text-sm font-medium mb-1">
        {t('voicePreferenceLabel') || 'Voice Preference'}
      </label>
      
      {loading ? (
        <div className="flex items-center justify-center p-2 border rounded">
          <svg className="animate-spin h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : error ? (
        <div className="text-red-500 p-2 border rounded">{error}</div>
      ) : (
        <div className="flex items-center">
          <select
            id="voicePreference"
            value={voicePreference}
            onChange={(e) => setVoicePreference(e.target.value)}
            className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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
            className={`ml-2 p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              isPlaying 
                ? 'text-red-500 dark:text-red-400' 
                : 'text-gray-500 dark:text-gray-400'
            }`}
            onClick={() => isPlaying ? stopAudio() : playPreview(voicePreference)}
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
      )}
    </div>
  );
};

export default VoicePreference;