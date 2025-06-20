import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import AudioManager from '../utils/AudioManager';
import { enhancedStorage } from '../enhancedStorage';

interface Story {
  culture: string;
  view: string;
  culture_story: string;
  story_audio?: string;
}

interface StoryViewProps {
  stories: Story[];
  userId: string;
  artifactId: string;
  identityId: string;
  artifactDescription?: any;
  culturalPreferences: {
    age_preference: string;
    gender_preference: string;
    language_preference: string;
    voice_preference: string;
  };
}

const StoryView: React.FC<StoryViewProps> = ({
  stories,
  userId,
  artifactId,
  identityId,
  artifactDescription,
  culturalPreferences
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<number>(0);
  
  // Audio management state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isCreatingAudio, setIsCreatingAudio] = useState<boolean>(false);
  const [isDownloadingAudio, setIsDownloadingAudio] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<'notcreated' | 'creating' | 'ready' | 'error'>('notcreated');
  
  // Track if we're using system voice
  const [useSystemVoice, setUseSystemVoice] = useState<boolean>(
    culturalPreferences.voice_preference === 'system'
  );
  
  // Track if we have an actual audio file (separate from voice preference)
  const [hasAudioFile, setHasAudioFile] = useState<boolean>(false);
  
  // Refs to store AudioManager instances
  const audioManagersRef = useRef<(AudioManager | null)[]>([]);
  
  // Initialize audio managers for each story
  useEffect(() => {
    // Create or resize the array to match stories length
    audioManagersRef.current = Array(stories.length).fill(null);
    
    // Clean up function to destroy audio managers on unmount
    return () => {
      audioManagersRef.current.forEach(manager => {
        if (manager) {
          manager.destroy();
        }
      });
    };
  }, [stories.length]);

  // Update useSystemVoice when cultural preferences change
  useEffect(() => {
    const isSystemVoice = culturalPreferences.voice_preference === 'system';
    setUseSystemVoice(isSystemVoice);
    
    // If voice preference changes, we need to re-initialize active tab
    if (audioManagersRef.current[activeTab]) {
      // Clean up the current manager
      audioManagersRef.current[activeTab]?.destroy();
      audioManagersRef.current[activeTab] = null;
      
      // Set isPlaying to false when changing voice preferences
      setIsPlaying(false);
      
      // Re-initialize with the updated preferences
      initializeAudioManager(activeTab);
    }
  }, [culturalPreferences.voice_preference]);

  useEffect(() => {
    if (stories.length > 0 && activeTab < stories.length) {
      const initializeActiveTab = async () => {
        // Check if the AudioManager needs initialization
        if (!audioManagersRef.current[activeTab]) {
          await initializeAudioManager(activeTab);
        } else {
          
          // Check for audio file existence regardless of voice preference
          const audioExists = await checkAudioExistence(activeTab);
          setHasAudioFile(audioExists);
          
          if (audioExists) {
            // Update UI status
            setAudioStatus('ready');
            
            // Update manager state
            if (stories[activeTab]?.story_audio) {
              const audioFilename = stories[activeTab].story_audio;
              const audioPath = `${userId}/${artifactId}/${audioFilename}`;
              audioManagersRef.current[activeTab]?.updateS3Path(audioPath);
            }
          } else {
            // If using system voice, still set status to ready
            if (useSystemVoice) {
              setAudioStatus('ready');
            } else {
              // Update UI status
              setAudioStatus('notcreated');
              
              // Reset manager state
              audioManagersRef.current[activeTab]?.resetAudioState();
            }
          }
        }
      };
      
      initializeActiveTab();
    }
  }, [activeTab, stories, userId, artifactId, useSystemVoice]);
  
  const isDestroyed = useRef(false);
  useEffect(() => {
    // Set up the flag for component mounted state
    isDestroyed.current = false;
    
    // Cleanup function when component unmounts
    return () => {
      isDestroyed.current = true;
    };
  }, []);

  const initializeAudioManager = async (index: number) => {
    if (!stories[index]) return;
    
    try {
      // If already initialized, just update UI state but don't recreate
      if (audioManagersRef.current[index]) {
        
        // Reset audio error when switching tabs
        setAudioError(null);
        
        // Get current state from the manager
        const state = audioManagersRef.current[index]?.getState();
        if (state) {
          setAudioStatus(state.audioStatus);
          setIsPlaying(state.isPlaying);
          
          // Don't update useSystemVoice from the manager here
          // We want to maintain the user's preference
        }
        
        return;
      }
      
      // Start with a clean state
      setAudioError(null);
      setIsPlaying(false);
      
      // Create audio manager instance first
      const manager = new AudioManager({
        userId,
        artifactId,
        identityId,
        storyIndex: index,
        language: culturalPreferences.language_preference,
        voiceId: culturalPreferences.voice_preference,
        apiName: 'culturalensApi',
        artifactDescription,
        updateStoryAudio: (storyIndex, audioFilename) => {
          // Update local stories array with the audio filename
          if (stories[storyIndex]) {
            stories[storyIndex].story_audio = audioFilename;
          }
        }
      });
      
      // Store in ref immediately
      audioManagersRef.current[index] = manager;
      
      // First check if audio file exists, regardless of voice preference
      const audioExists = await checkAudioExistence(index);
      setHasAudioFile(audioExists);
      
      // Subscribe to manager's state changes
      const unsubscribe = manager.subscribe((state) => {
        
        // Only update state if component is still mounted
        if (!isDestroyed.current) {
          // Ensure we update isPlaying state from the manager
          if (state.isPlaying !== isPlaying) {
            setIsPlaying(state.isPlaying);
          }
          
          if (state.audioStatus !== audioStatus) {
            setAudioStatus(state.audioStatus);
          }
          
          if (state.audioError && state.audioError !== audioError) {
            setAudioError(state.audioError);
          }
          
          // For system voice, do an extra check to make sure UI state matches actual speaking state
          if (useSystemVoice && !hasAudioFile) {
            const isSpeaking = manager.isSpeechSynthesisSpeaking?.() || false;
            if (isSpeaking !== state.isPlaying) {
              setIsPlaying(isSpeaking);
            }
          }
        }
      });

      // Set initial state based on audio existence and voice preference
      if (audioExists && stories[index]?.story_audio) {
        const audioFilename = stories[index].story_audio;
        const audioPath = `${userId}/${artifactId}/${audioFilename}`;
        
        // Set audio status to ready
        setAudioStatus('ready');
        
        // Update manager with S3 path
        manager.updateS3Path(audioPath);
        
      } else {        
        // Set initial status based on voice preference
        if (useSystemVoice) {
          setAudioStatus('ready');
        } else {
          setAudioStatus('notcreated');
        }
        
        // Then initialize the manager
        await manager.initialize(stories[index].culture_story);
        
      }
      
      // Cleanup subscription on component unmount
      return () => {
        unsubscribe();
        if (manager) {
          manager.destroy();
        }
      };
    } catch (error) {
      console.error(`Error initializing audio manager for story ${index}:`, error);
      setAudioError(error instanceof Error ? error.message : String(error));
      setAudioStatus('error');
    }
  };

  // Handle tab change
  const handleTabChange = async (index: number) => {
    // Stop any currently playing audio
    const currentManager = audioManagersRef.current[activeTab];
    if (currentManager && isPlaying) {
      currentManager.stop();
      setIsPlaying(false);
    }
    
    // Set the active tab immediately
    setActiveTab(index);
    
    // Reset audio error when changing tabs
    setAudioError(null);
    
    // Check if this story tab has been initialized before
    if (audioManagersRef.current[index]) {
      // Get the current audio manager state
      const state = audioManagersRef.current[index]?.getState();
      
      // Check for audio file existence
      const audioExists = await checkAudioExistence(index);
      setHasAudioFile(audioExists);
      
      if (audioExists) {
        // Audio exists, make sure manager is updated
        if (stories[index]?.story_audio) {
          const audioFilename = stories[index].story_audio;
          const audioPath = `${userId}/${artifactId}/${audioFilename}`;
          audioManagersRef.current[index]?.updateS3Path(audioPath);
        }
        
        // Update UI immediately
        setAudioStatus('ready');
      } else {
        // Audio doesn't exist, reset manager state
        if (audioManagersRef.current[index]) {
          audioManagersRef.current[index]?.resetAudioState();
        }
        
        // Update UI based on system voice preference
        if (useSystemVoice) {
          setAudioStatus('ready');
        } else {
          setAudioStatus('notcreated');
        }
      }
    } else {
      // Initialize the audio manager for this tab
      try {
        // Don't change audio status here - let initializeAudioManager set it
        await initializeAudioManager(index);
      } catch (error) {
        console.error(`Error initializing audio manager for tab ${index}:`, error);
        setAudioStatus('error');
        setAudioError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const checkAudioExistence = async (index: number): Promise<boolean> => {
    // Always check if the file exists regardless of system voice preference
    if (!stories[index]?.story_audio) {
      return false;
    }
    
    const audioFilename = stories[index].story_audio;
    const audioPath = `${userId}/${artifactId}/${audioFilename}`;
        
    try {
      // First try to use HEAD request to CloudFront if available
      if (process.env.REACT_APP_S3_URL) {
        const cloudFrontUrl = process.env.REACT_APP_S3_URL;
        const baseUrl = cloudFrontUrl.startsWith('http') 
          ? cloudFrontUrl 
          : `https://${cloudFrontUrl}`;
        const formattedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        const fullUrl = `${formattedBaseUrl}${audioPath}`;
                
        try {
          const response = await fetch(fullUrl, { method: 'HEAD' });
          if (response.ok) {
            return true;
          } 
        } catch (error) {
          console.log(`CloudFront HEAD check failed: ${error}`);
        }
      }
      
      // If CloudFront failed, try S3 directly with a validation step
      try {
        const result = await enhancedStorage.get(audioPath, {
          download: false
        });
        
        if (result && typeof result === 'string') {
          // CRITICAL: Don't trust that the file exists just because we got a URL
          // We need to verify the file actually exists with a HEAD request
          try {
            const verifyResponse = await fetch(result, { method: 'HEAD' });
            
            if (verifyResponse.ok) {
              return true;
            } else {
              return false;
            }
          } catch (verifyError) {
            return false;
          }
        }
        
        return false;
      } catch (s3Error) {
        return false;
      }
    } catch (error) {
      console.error(`Error checking audio existence: ${error}`);
      return false;
    }
  };

  // Handle play/pause
  const handleTogglePlayback = async () => {
    
    try {
      const manager = audioManagersRef.current[activeTab];
      if (!manager) {
        console.error('No audio manager available');
        return;
      }
      
      // Make sure browser audio context is resumed (important for mobile)
      await manager.resumeAudioContext();
      
      // CRITICAL: Always force using the file if it exists, regardless of voice preference
      const options = {
        forceUseFile: hasAudioFile // If we have a file, use it regardless of voice preference
      };
      
      // Toggle playback with options
      await manager.togglePlayback(options);
      
      // Get the current state immediately after toggling
      const currentState = manager.getState();
      
      // Update our local state to match the manager's state
      setIsPlaying(currentState.isPlaying);
      
      // Add an extra check for system voice to ensure UI stays in sync
      // Only do this for system voice when NO audio file exists
      if (useSystemVoice && !hasAudioFile) {
        // Poll the speech synthesis state a few times to make sure UI stays in sync
        const checkSpeechState = () => {
          if (!manager) return;
          
          const currentState = manager.getState();
          const isSpeaking = manager.isSpeechSynthesisSpeaking?.() || false;
                    
          // If there's a mismatch, update the UI
          if ((isPlaying !== currentState.isPlaying) || (currentState.isPlaying !== isSpeaking)) {
            setIsPlaying(isSpeaking);
          }
        };
        
        // Check a few times after toggling
        setTimeout(checkSpeechState, 200);
        setTimeout(checkSpeechState, 500);
        setTimeout(checkSpeechState, 1000);
      }
    } catch (error) {
      console.error('Error toggling playback:', error);
      setAudioError(error instanceof Error ? error.message : String(error));
      // Ensure playing state is reset on error
      setIsPlaying(false);
    }
  };

  // Handle audio creation
  const handleCreateAudio = async () => {
    // If using system voice, we don't need to create audio
    if (useSystemVoice && !hasAudioFile) {
      setAudioStatus('ready');
      return;
    }
    
    try {
      setIsCreatingAudio(true);
      setAudioError(null);
      
      const manager = audioManagersRef.current[activeTab];
      if (!manager) {
        throw new Error('No audio manager available');
      }
      
      // Check the current status
      const currentState = manager.getState();
      
      // If the status is 'ready' but we're trying to create audio, there might be a mismatch
      // Let's force reset the state and try again
      if (currentState.audioStatus === 'ready') {
        manager.resetAudioState();
        
        // A small delay to ensure state updates
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Make sure browser audio context is resumed (important for mobile)
      await manager.resumeAudioContext();
      
      // Subscribe to audio manager state to update UI immediately when audio becomes available
      const unsubscribe = manager.subscribe((state) => {
        if (state.audioStatus === 'ready' && (state.cachePath || state.s3Path)) {
          // If audio is ready and we have a path, we can enable playback immediately
          // even while upload to S3 is still in progress
          setHasAudioFile(true);
          setIsCreatingAudio(false);
          setAudioStatus('ready');
        } else if (state.audioStatus === 'error') {
          // Handle error state
          setAudioError(state.audioError || 'Unknown error creating audio');
          setIsCreatingAudio(false);
          setAudioStatus('error');
        }
      });
      
      // Create audio - this will now process chunks in parallel and make audio
      // available for playback as soon as it's rendered, before S3 upload completes
      await manager.createAudio();
      
      // After successful creation, update hasAudioFile
      setHasAudioFile(true);
      
      setIsCreatingAudio(false);
      
      // Clean up subscription
      unsubscribe();
    } catch (error) {
      console.error('Error creating audio:', error);
      setAudioError(error instanceof Error ? error.message : String(error));
      setIsCreatingAudio(false);
    }
  };
    
  // Handle audio download
  const handleDownloadAudio = async () => {
    // If no audio file exists, can't download
    if (!hasAudioFile) {
      setAudioError('No audio file is available to download.');
      return;
    }
    
    try {
      setIsDownloadingAudio(true);
      setAudioError(null);
      
      const manager = audioManagersRef.current[activeTab];
      if (!manager) {
        throw new Error('No audio manager available');
      }
      
      // Download audio
      await manager.downloadAudio();
      
      setIsDownloadingAudio(false);
    } catch (error) {
      console.error('Error downloading audio:', error);
      setAudioError(error instanceof Error ? error.message : String(error));
      setIsDownloadingAudio(false);
    }
  };
  
  if (stories.length === 0) {
    return (
      <div className="text-center py-6">
        <p>{t('noStoriesAvailable')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden">
      {/* Tabs Navigation */}
      <div className="flex border-b">
        {stories.map((story, index) => (
          <button
            key={index}
            className={`px-4 py-2 font-semibold ${
              activeTab === index
                ? 'bg-blue-600 text-white border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-blue-500'
            }`}
            onClick={() => handleTabChange(index)}
          >
            {story.culture}
          </button>
        ))}
      </div>

      {/* Current Tab Content */}
      <div className="p-4">
        {/* Header with audio controls */}
        <div className="mb-4">
          {/* Audio Controls - at top */}
          <div className="mb-4 flex items-center justify-end space-x-4">
            {/* 
              Audio Status and Controls:
              
              1. Audio file doesn't exist + NOT using system voice: Show Create Audio button
              2. Audio file doesn't exist + IS using system voice: Show Play button only
              3. Audio file exists (regardless of voice preference): Show Play and Download buttons
            */}
            
            {/* Create Audio button - show only when no audio file exists and not using system voice */}
            {!hasAudioFile && audioStatus === 'notcreated' && !useSystemVoice && (
              <button
                onClick={handleCreateAudio}
                disabled={isCreatingAudio}
                className={`flex items-center px-4 py-2 rounded ${
                  isCreatingAudio
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
                title={t('createAudio') || 'Create Audio'}
              >
                {isCreatingAudio ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('creatingAudio')}
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    {t('createAudio')}
                  </>
                )}
              </button>
            )}
            
            {/* Creating status - show when audio is being created */}
            {audioStatus === 'creating' && (
              <div className="flex items-center text-yellow-600">
                <svg className="animate-spin -ml-1 mr-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{t('generatingAudio')}</span>
              </div>
            )}
            
            {/* 
              Play/Pause button - show when:
              1. Audio file exists (hasAudioFile)
              OR
              2. Using system voice (useSystemVoice) and no audio file exists
            */}
            {((hasAudioFile && audioStatus === 'ready') || (!hasAudioFile && useSystemVoice && audioStatus === 'ready')) && (
              <button
                onClick={handleTogglePlayback}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center"
                title={isPlaying ? (t('pauseAudio') || 'Pause Audio') : (t('playAudio') || 'Play Audio')}
              >
                {isPlaying ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t('pauseAudio')}
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t('playAudio')}
                  </>
                )}
              </button>
            )}
            
            {/* Download button - only show if audio file exists */}
            {hasAudioFile && audioStatus === 'ready' && (
              <button
                onClick={handleDownloadAudio}
                disabled={isDownloadingAudio}
                className={`flex items-center px-4 py-2 rounded ${
                  isDownloadingAudio
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gray-600 hover:bg-gray-700 text-white'
                }`}
                title={t('downloadAudio') || 'Download Audio'}
              >
                {isDownloadingAudio ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('downloading')}
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {t('downloadAudio')}
                  </>
                )}
              </button>
            )}
                        
            {/* Error state */}
            {audioStatus === 'error' && (
              <div className="flex flex-col space-y-2 w-full">
                <div className="text-red-500 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{audioError || t('errorWithAudio')}</span>
                </div>

                <button
                  onClick={handleCreateAudio}
                  disabled={isCreatingAudio || (useSystemVoice && !hasAudioFile)}
                  className={`flex items-center px-4 py-2 rounded ${
                    isCreatingAudio || (useSystemVoice && !hasAudioFile)
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-yellow-500 hover:bg-yellow-600 text-white'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {t('tryAgain')}
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Story Content */}
        <div className="prose max-w-none whitespace-pre-line">
          {stories[activeTab].culture_story}
        </div>
      </div>
    </div>
  );
};

export default StoryView;