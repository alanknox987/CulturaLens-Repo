import { enhancedStorage } from '../enhancedStorage';
import { API } from 'aws-amplify';

/**
 * Interface for Audio Chunk
 */
interface AudioChunk {
  index: number;
  text: string;
  audioBuffer?: AudioBuffer;
  status: 'pending' | 'processing' | 'complete' | 'error';
  error?: string;
}

/**
 * Interface for Audio Manager State
 */
interface AudioManagerState {
  isPlaying: boolean;
  currentChunkIndex: number;
  chunks: AudioChunk[];
  cachePath?: string;
  s3Path?: string;
  audioStatus: 'notcreated' | 'creating' | 'ready' | 'error';
  audioError?: string;
  // Track if system voice is being used
  useSystemVoice: boolean;
}

/**
 * Interface for Progress Event
 */
interface ProgressEvent {
  loaded: number;
  total: number;
}

/**
 * Configuration for AudioManager
 */
interface AudioManagerConfig {
  userId: string;
  artifactId: string;
  identityId: string;
  storyIndex: number;
  language: string;
  voiceId: string;
  apiName: string; // The name of your API Gateway API
  artifactDescription?: any;
  // Callback function for updating story audio reference
  updateStoryAudio?: (storyIndex: number, audioFilename: string) => void;
}

/**
 * AudioManager - A self-contained class to handle all audio operations
 */
class AudioManager {
  private audioContext: AudioContext;
  private currentSource: AudioBufferSourceNode | null = null;
  private state: AudioManagerState;
  private config: AudioManagerConfig;
  private stateListeners: ((state: AudioManagerState) => void)[] = [];
  private isDestroyed = false;
  private manualStop = false;
  private currentAudioElement: HTMLAudioElement | null = null;
  private needsUserInteraction: boolean = false;
  
  // Add SpeechSynthesis support
  private speechSynthesis: SpeechSynthesis | null = null;
  private speechUtterance: SpeechSynthesisUtterance | null = null;

  /**
   * Constructor
   */
  constructor(config: AudioManagerConfig) {
    this.config = config;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Initialize Speech Synthesis if available
    this.speechSynthesis = window.speechSynthesis || null;
    
    // Determine if we should use system voice
    const useSystemVoice = config.voiceId === 'system';
    
    this.state = {
      isPlaying: false,
      currentChunkIndex: 0,
      chunks: [],
      audioStatus: useSystemVoice ? 'ready' : 'notcreated',
      useSystemVoice: useSystemVoice
    };
    
    // Set up speech synthesis event handlers if using system voice
    if (useSystemVoice && this.speechSynthesis) {
      console.log('Using system voice for audio playback');
    }
  }

  /**
   * Initialize with text - now just checks for existing audio
   */
  public async initialize(text: string): Promise<void> {
    // Split text into paragraphs for later use when creating audio
    const paragraphs = this.splitTextIntoParagraphs(text);
    
    // Create chunks
    const chunks: AudioChunk[] = paragraphs.map((paragraph, index) => ({
      index,
      text: paragraph,
      status: 'pending'
    }));
    
    // Set initial state based on voiceId
    if (this.config.voiceId === 'system') {
      // For system voice, mark as ready immediately
      this.setState({
        ...this.state,
        chunks,
        currentChunkIndex: 0,
        audioStatus: 'ready',
        useSystemVoice: true
      });
      console.log('Initialized system voice with text');
      return;
    }
    
    // For custom voices, use the original flow
    this.setState({
      ...this.state,
      chunks,
      currentChunkIndex: 0,
      audioStatus: 'notcreated',
      useSystemVoice: false
    });
    
    // Check if audio exists in S3
    try {
      await this.checkExistingAudio();
      // If we reach here, the audio exists
      this.setState({
        ...this.state,
        audioStatus: 'ready'
      });
    } catch (error) {
      console.log('No existing audio found, audio needs to be created');
      this.setState({
        ...this.state,
        audioStatus: 'notcreated'
      });
    }
  }

  /**
   * Create audio - optimized for parallel processing and faster playback
   */
  public async createAudio(): Promise<void> {
    // If using system voice, nothing to create
    if (this.state.useSystemVoice) {
      console.log('Using system voice, no need to create audio file');
      this.setState({
        ...this.state,
        audioStatus: 'ready'
      });
      return;
    }
    
    // If audio is already being created or is ready, do nothing
    if (this.state.audioStatus === 'creating' || this.state.audioStatus === 'ready') {
      console.log(`Audio is already ${this.state.audioStatus}, ignoring create request`);
      return;
    }
    
    // Set status to creating
    this.setState({
      ...this.state,
      audioStatus: 'creating',
      audioError: undefined
    });
    
    try {
      // Combine all text and re-split into optimized chunks
      const fullText = this.state.chunks.map(chunk => chunk.text).join('\n\n');
      const optimizedTextChunks = this.createOptimizedChunks(fullText);
      
      // Create new chunks array with optimized text chunks
      const optimizedChunks: AudioChunk[] = optimizedTextChunks.map((text, index) => ({
        index,
        text,
        status: 'pending'
      }));
      
      // Replace the chunks in state
      this.setState({
        ...this.state,
        chunks: optimizedChunks
      });
      
      console.log(`Processing ${optimizedChunks.length} optimized chunks in parallel`);
      
      // Process all chunks in parallel with Promise.all
      const processingPromises = optimizedChunks.map(async (chunk) => {
        try {
          // Update chunk status to processing
          const updatedChunks = [...this.state.chunks];
          updatedChunks[chunk.index] = {
            ...updatedChunks[chunk.index],
            status: 'processing'
          };
          
          this.setState({
            ...this.state,
            chunks: updatedChunks
          });
          
          // Process the chunk
          const audioBuffer = await this.processChunk(chunk);
          
          // Update chunk with audio buffer on success
          const completedChunks = [...this.state.chunks];
          completedChunks[chunk.index] = {
            ...completedChunks[chunk.index],
            audioBuffer,
            status: 'complete'
          };
          
          this.setState({
            ...this.state,
            chunks: completedChunks
          });
          
          return {
            index: chunk.index,
            audioBuffer
          };
        } catch (error) {
          console.error(`Error processing chunk ${chunk.index}:`, error);
          
          // Update chunk status to error
          const errorChunks = [...this.state.chunks];
          errorChunks[chunk.index] = {
            ...errorChunks[chunk.index],
            status: 'error',
            error: String(error)
          };
          
          this.setState({
            ...this.state,
            chunks: errorChunks
          });
          
          // Re-throw to be caught by Promise.allSettled
          throw error;
        }
      });
      
      // Wait for all chunks to be processed (some may fail)
      const results = await Promise.allSettled(processingPromises);
      
      // Count successful chunks
      const successfulChunks = results.filter(
        result => result.status === 'fulfilled'
      ).length;
      
      // Check if any chunks completed successfully
      if (successfulChunks > 0) {
        // Immediately save and make available the audio for playback
        await this.saveAudioForPlayback();
        
        // Continue S3 upload in the background (non-blocking)
        this.saveAudioToS3InBackground().catch(uploadError => {
          console.error('Background upload failed:', uploadError);
          // Don't throw - this should not block playback
        });
      } else {
        throw new Error('No chunks were processed successfully');
      }
    } catch (error) {
      console.error('Error creating audio:', error);
      this.setState({
        ...this.state,
        audioStatus: 'error',
        audioError: String(error)
      });
    }
  }

  /**
   * Create optimized text chunks - 4 chunks max, respecting paragraph breaks
   */
  private createOptimizedChunks(text: string): string[] {
    // Split into paragraphs first
    const paragraphs = text.split('\n\n').filter(p => p.trim() !== '');
    const totalLength = text.length;
    
    // Target 4 chunks of roughly equal size
    const targetChunkCount = Math.min(4, paragraphs.length);
    const targetChunkSize = Math.ceil(totalLength / targetChunkCount);
    
    // Ensure we don't exceed polly's 3000 character limit
    const MAX_CHUNK_SIZE = 2900; // slightly under the 3000 limit to be safe
    const adjustedChunkSize = Math.min(targetChunkSize, MAX_CHUNK_SIZE);
    
    // Create the chunks
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      // If adding this paragraph would exceed the target size and we already have content
      if (currentChunk.length + paragraph.length + 2 > adjustedChunkSize && currentChunk.length > 0) {
        // Add current chunk to results
        chunks.push(currentChunk);
        // Start new chunk with this paragraph
        currentChunk = paragraph;
      } else {
        // Add to current chunk with appropriate separator
        if (currentChunk.length > 0) {
          currentChunk += '\n\n' + paragraph;
        } else {
          currentChunk = paragraph;
        }
      }
    }
    
    // Add the last chunk if not empty
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    // Log chunk info
    console.log(`Created ${chunks.length} optimized chunks with sizes:`, 
      chunks.map(chunk => chunk.length).join(', '));
    
    return chunks;
  }

  /**
   * Save audio for immediate playback (non-blocking)
   */
  private async saveAudioForPlayback(): Promise<void> {
    console.log("Preparing audio for immediate playback");
    
    // Get all complete chunks
    const completeChunks = this.state.chunks.filter(
      chunk => chunk.status === 'complete' && chunk.audioBuffer
    );
    
    if (completeChunks.length === 0) {
      console.warn('No complete chunks for playback');
      throw new Error('No complete audio chunks for playback');
    }
    
    try {
      // Sort chunks by index to ensure correct order
      completeChunks.sort((a, b) => a.index - b.index);
      
      // Calculate total length
      const totalLength = completeChunks.reduce(
        (total, chunk) => total + (chunk.audioBuffer?.length || 0),
        0
      );
            
      // Create an offline audio context for concatenation
      const offlineCtx = new OfflineAudioContext(
        1,
        totalLength,
        this.audioContext.sampleRate
      );
      
      // Add chunks in sequence
      let currentOffset = 0;
      
      for (const chunk of completeChunks) {
        if (!chunk.audioBuffer) continue;
        
        const source = offlineCtx.createBufferSource();
        source.buffer = chunk.audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(currentOffset / offlineCtx.sampleRate);
        currentOffset += chunk.audioBuffer.length;
      }
      
      // Render the audio
      const renderedBuffer = await offlineCtx.startRendering();
      
      // Convert to WAV
      const wavBlob = await this.audioBufferToWav(renderedBuffer);
      
      // Create a URL for the audio
      const audioUrl = URL.createObjectURL(wavBlob);
      
      // IMPORTANT: Make the audio immediately available for playback
      // by updating the state with the blob URL
      this.setState({
        ...this.state,
        cachePath: audioUrl,
        audioStatus: 'ready'  // Mark as ready for playback
      });
      
    } catch (error) {
      console.error('Error preparing audio for playback:', error);
      throw error;
    }
  }

  /**
   * Save audio to S3 in the background (non-blocking)
   */
  private async saveAudioToS3InBackground(): Promise<void> {
    // Generate filename
    const audioFilename = `story_audio_${this.config.storyIndex + 1}.mp3`;
    const audioPath = `${this.config.userId}/${this.config.artifactId}/${audioFilename}`;
        
    try {
      // Get blob from cache path
      if (!this.state.cachePath) {
        throw new Error('No cache path available for upload');
      }
      
      // Fetch the blob from the cache URL
      const response = await fetch(this.state.cachePath);
      const audioBlob = await response.blob();
      
      // Convert to array buffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Upload to S3
      const uploadResult = await enhancedStorage.put(
        audioPath,
        arrayBuffer,
        {
          contentType: 'audio/mpeg',
          progressCallback: (progress: ProgressEvent) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
          }
        }
      );
            
      // Update S3 path after successful upload
      this.setState({
        ...this.state,
        s3Path: audioPath
      });
      
      // Verify the upload
      setTimeout(async () => {
        try {
          const result = await enhancedStorage.get(audioPath, {
            download: false
          });
          
          if (result) {
            // Update story audio reference if callback provided
            if (this.config.updateStoryAudio && typeof this.config.updateStoryAudio === 'function') {
              this.config.updateStoryAudio(this.config.storyIndex, audioFilename);
            }
            
            // Update the artifact_stories.json file
            await this.updateArtifactStoriesJson(this.config.storyIndex, audioFilename);
          }
        } catch (verifyError) {
          console.error(`Failed to verify file: `, verifyError);
        }
      }, 2000); // 2 second delay for S3 consistency
    } catch (uploadError) {
      console.error(`File upload failed: `, uploadError);
      
      // Try alternative upload approach with direct blob
      try {
        if (!this.state.cachePath) {
          throw new Error('No cache path available for upload');
        }
        
        const response = await fetch(this.state.cachePath);
        const audioBlob = await response.blob();
        
        const altUploadResult = await enhancedStorage.put(
          audioPath,
          audioBlob,
          {
            contentType: 'audio/mpeg'
          }
        );
        
        // Update S3 path
        this.setState({
          ...this.state,
          s3Path: audioPath
        });
        
        // Update story audio reference if callback provided
        if (this.config.updateStoryAudio && typeof this.config.updateStoryAudio === 'function') {
          this.config.updateStoryAudio(this.config.storyIndex, audioFilename);
        }
        
        // Update the artifact_stories.json file
        await this.updateArtifactStoriesJson(this.config.storyIndex, audioFilename);
      } catch (altError) {
        console.error(`Alternative upload also failed: ${altError instanceof Error ? altError.message : String(altError)}`);
        // Don't rethrow - we still want to allow playback from cache
      }
    }
  }

  /**
   * Split text into paragraphs (original method for initial chunking)
   */
  private splitTextIntoParagraphs(text: string): string[] {
    // Split on double newlines
    const paragraphs = text.split('\n\n').filter(p => p.trim() !== '');
    
    // If we have very long paragraphs, split them further
    const result: string[] = [];
    const MAX_PARAGRAPH_LENGTH = 500; // characters
    
    paragraphs.forEach(paragraph => {
      if (paragraph.length <= MAX_PARAGRAPH_LENGTH) {
        result.push(paragraph);
      } else {
        // Split long paragraphs at sentences
        const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
        let currentChunk = '';
        
        sentences.forEach(sentence => {
          if (currentChunk.length + sentence.length <= MAX_PARAGRAPH_LENGTH) {
            currentChunk += sentence;
          } else {
            if (currentChunk) {
              result.push(currentChunk);
            }
            currentChunk = sentence;
          }
        });
        
        if (currentChunk) {
          result.push(currentChunk);
        }
      }
    });
    
    return result;
  }

  /**
   * Toggle playback - Play/Pause the audio
   */
  public async togglePlayback(options?: { forceUseFile?: boolean }): Promise<void> {
    
    // For system voice, make sure we check the actual speaking state
    if (this.state.useSystemVoice && !options?.forceUseFile) {
      const isSpeaking = this.isSpeechSynthesisSpeaking();
      
      // If there's a mismatch between UI state and actual speaking state, correct it
      if (isSpeaking !== this.state.isPlaying) {
        this.setState({
          ...this.state,
          isPlaying: isSpeaking
        });
      }
      
      // Now toggle based on the corrected state
      if (this.state.isPlaying) {
        this.stop();
      } else {
        await this.play(options);
      }
    } else {
      // For non-system voice, use the original logic
      if (this.state.isPlaying) {
        this.stop();
      } else {
        await this.play(options);
      }
    }
  }

  /**
   * Start or resume playback
   */
  public async play(options?: { forceUseFile?: boolean }): Promise<void> {
    // If we're already playing, do nothing
    if (this.state.isPlaying) {
      return;
    }
    
    // Set playing state immediately
    this.setState({
      ...this.state,
      isPlaying: true
    });
        
    try {
      // Priority:
      // 1. If forceUseFile is true and we have a file, use the file
      // 2. Otherwise, if voice is system and no file exists, use system voice
      // 3. If audio is not ready, show error
      
      // Check if we should prioritize using existing files
      const useExistingFile = options?.forceUseFile && (this.state.cachePath || this.state.s3Path);
      
      if (useExistingFile) {        
        // If we have cached audio
        if (this.state.cachePath) {
          await this.playFromCache(this.state.cachePath);
          return;
        }
        
        // If we have audio in S3
        if (this.state.s3Path) {
          await this.playFromS3(this.state.s3Path);
          return;
        }
      }
      
      // If system voice is selected and no file preference was specified
      if (this.state.useSystemVoice && !useExistingFile) {
        await this.playWithSystemVoice();
        return;
      }
      
      // If audio is not ready and not using system voice, show error
      if (this.state.audioStatus !== 'ready') {
        console.error('Cannot play audio that is not ready');
        this.setState({
          ...this.state,
          isPlaying: false
        });
        return;
      }
      
      // Check if we have cached audio
      if (this.state.cachePath) {
        await this.playFromCache(this.state.cachePath);
        return;
      }
      
      // Check if we have audio in S3
      if (this.state.s3Path) {
        await this.playFromS3(this.state.s3Path);
        return;
      }
      
      // If we don't have a path to play from, mark as error
      this.setState({
        ...this.state,
        isPlaying: false,
        audioStatus: 'error',
        audioError: 'No audio path available for playback'
      });
    } catch (error) {
      console.error('Error starting playback:', error);
      this.setState({
        ...this.state,
        isPlaying: false
      });
    }
  }

  /**
   * Play using the system's speech synthesis
   */
  private async playWithSystemVoice(): Promise<void> {
    if (!this.speechSynthesis) {
      console.error('Speech synthesis not available');
      this.setState({
        ...this.state,
        isPlaying: false,
        audioStatus: 'error',
        audioError: 'Speech synthesis not available'
      });
      return;
    }
    
    try {
      // First stop any already playing audio
      this.stopAnyExistingAudio();
      
      // Get current chunk text
      const fullText = this.state.chunks.map(chunk => chunk.text).join(' ');
      
      // Create a new utterance
      this.speechUtterance = new SpeechSynthesisUtterance(fullText);
      
      // Set language if available
      if (this.config.language) {
        this.speechUtterance.lang = this.config.language;
      }
      
      // Set up event listeners
      this.speechUtterance.onend = () => {
        // Only update if not manually stopped
        if (!this.manualStop) {
          // Ensure we update isPlaying state
          this.setState({
            ...this.state,
            isPlaying: false
          });
        }
        this.speechUtterance = null;
      };
      
      this.speechUtterance.onerror = (event) => {
        console.error('System voice error:', event);
        // Ensure we update isPlaying state
        this.setState({
          ...this.state,
          isPlaying: false,
          audioError: 'Error with system voice playback'
        });
        this.speechUtterance = null;
      };
      
      // IMPORTANT: Set isPlaying to true BEFORE starting speech synthesis
      this.setState({
        ...this.state,
        isPlaying: true
      });
      
      // Start speaking
      this.speechSynthesis.speak(this.speechUtterance);
      
      // Double-check speech synthesis state after a moment to ensure UI is in sync
      setTimeout(() => {
        if (this.speechSynthesis) {
          const isSpeaking = this.speechSynthesis.speaking || this.speechSynthesis.pending;
          
          // Synchronize UI state with actual speech state
          if (isSpeaking !== this.state.isPlaying) {
            this.setState({
              ...this.state,
              isPlaying: isSpeaking
            });
          }
        }
      }, 500);
    } catch (error) {
      console.error('Error with system voice playback:', error);
      this.setState({
        ...this.state,
        isPlaying: false,
        audioError: String(error)
      });
    }
  }

  /**
   * Play from a cached URL
   */
  private async playFromCache(cachePath: string): Promise<void> {
    // Clear any existing audio elements first to prevent multiple playbacks
    this.stopAnyExistingAudio();
    
    // Create a new audio element
    const audio = new Audio();
    
    // Store the audio element as a class property so we can access it from stop()
    this.currentAudioElement = audio;
    
    // Set up event listeners first before setting src
    audio.onended = () => {
      if (!this.manualStop) {
        this.setState({
          ...this.state,
          isPlaying: false
        });
      }
      // Clear the reference when playback ends naturally
      this.currentAudioElement = null;
    };
    
    audio.onerror = (e) => {
      console.error('Error playing cached audio:', e);
      // Log detailed error information
      if (audio.error) {
        console.error(`Audio error code: ${audio.error.code}, message: ${audio.error.message}`);
      }
      
      this.setState({
        ...this.state,
        isPlaying: false,
        cachePath: undefined
      });
      // Clear the reference on error
      this.currentAudioElement = null;
    };
    
    // Add more detailed logging
    audio.onloadstart = () => console.log('Audio loading started');
    audio.oncanplay = () => console.log('Audio can start playing');
    audio.onwaiting = () => console.log('Audio playback waiting');
    audio.onpause = () => {
      // Update isPlaying state when audio is paused
      this.setState({
        ...this.state,
        isPlaying: false
      });
    };
    
    // Set crossOrigin to anonymous for CORS support
    audio.crossOrigin = "anonymous";
    
    // Set preload to auto
    audio.preload = "auto";
    
    // Set the src attribute
    audio.src = cachePath;
    
    // Play the audio with better error handling for mobile
    try {      
      // Load the audio first (important for mobile)
      await audio.load();
      
      // Check if audio is actually loaded and has a duration
      if (isNaN(audio.duration)) {
        await new Promise((resolve) => {
          const canPlayHandler = () => {
            audio.removeEventListener('canplay', canPlayHandler);
            resolve(true);
          };
          audio.addEventListener('canplay', canPlayHandler);
          
          // Also set a timeout in case canplay never fires
          setTimeout(resolve, 5000);
        });
      }
      
      // Now try to play with user gesture handling for mobile
      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Ensure isPlaying is true when playback starts
            this.setState({
              ...this.state,
              isPlaying: true
            });
          })
          .catch(error => {
            console.error('Error during audio.play():', error);
            
            // Check if it's an autoplay error
            if (error.name === 'NotAllowedError') {
              console.warn('Audio playback was prevented by browser autoplay policy');
              
              // Set a flag to indicate we need user interaction
              this.needsUserInteraction = true;
              
              this.setState({
                ...this.state,
                isPlaying: false,
                cachePath: undefined
              });
            }
          });
      }
    } catch (error) {
      console.error('Error playing cached audio:', error);
      this.setState({
        ...this.state,
        isPlaying: false,
        cachePath: undefined
      });
      
      // Clear the reference on error
      this.currentAudioElement = null;
    }
  }

  /**
   * Stop playback
   */
  public stop(): void {
    // Set manual stop flag immediately to prevent auto-advancing
    this.manualStop = true;
    
    // Stop all audio playback
    this.stopAnyExistingAudio();
    
    // Set playing state immediately to false
    this.setState({
      ...this.state,
      isPlaying: false
    });
        
    // Reset manual stop flag after a delay
    setTimeout(() => {
      this.manualStop = false;
    }, 300);
  }

  /**
   * Private method to stop any playing audio
   */
  private stopAnyExistingAudio(): void {
    // Set isPlaying to false first to ensure UI updates quickly
    if (this.state.isPlaying) {
      this.setState({
        ...this.state,
        isPlaying: false
      });
    }
    
    // Stop any current source from AudioContext (for chunk-based playback)
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
        this.currentSource = null;
      } catch (e) {
        console.error("Error stopping audio source:", e);
      }
    }
    
    // Stop HTML Audio element if it exists (for cached/S3 playback)
    if (this.currentAudioElement) {
      try {
        // Pause, reset position, and mute to ensure it stops
        this.currentAudioElement.pause();
        this.currentAudioElement.currentTime = 0;
        this.currentAudioElement.muted = true; // Ensure any lingering sound is muted
        
        // Remove any event listeners to prevent callbacks
        this.currentAudioElement.onended = null;
        this.currentAudioElement.onerror = null;
        
        // Clear the reference
        this.currentAudioElement = null;
      } catch (e) {
        console.error("Error stopping audio element:", e);
      }
    }
    
    // Stop system voice if it's playing
    if (this.speechSynthesis) {
      if (this.speechSynthesis.speaking || this.speechSynthesis.pending) {
        try {
          // First pause to immediately stop audio
          this.speechSynthesis.pause();
          
          // Then cancel all speech
          this.speechSynthesis.cancel();
          
          // Clear utterance reference
          this.speechUtterance = null;
          
        } catch (e) {
          console.error("Error stopping speech synthesis:", e);
        }
      }
    }
  }

  /**
   * Process a single chunk of text into audio
   */
  private async processChunk(chunk: AudioChunk): Promise<AudioBuffer> {
    // Call the Lambda function
    try {      
      // Use AWS Amplify API
      const response = await API.post(this.config.apiName, '/create-audio', {
        body: {
          userId: this.config.userId,
          artifactId: this.config.artifactId,
          storyIndex: this.config.storyIndex,
          text: chunk.text,
          voiceId: this.config.voiceId,
          language: this.config.language,
          artifactDescription: this.config.artifactDescription,
          chunkMode: true,
          chunkIndex: chunk.index
        }
      });
      
      // Parse response
      let parsedResponse = response;
      if (typeof response === 'string') {
        try {
          parsedResponse = JSON.parse(response);
        } catch (e) {
          console.error('Error parsing response:', e);
        }
      }
      
      // Check if response is wrapped in a body property (API Gateway format)
      if (parsedResponse.body && typeof parsedResponse.body === 'string') {
        try {
          parsedResponse = JSON.parse(parsedResponse.body);
        } catch (e) {
          console.error('Error parsing response body:', e);
        }
      }
      
      // Get audio data
      const audioData = parsedResponse.audioData;
      if (!audioData) {
        throw new Error('No audio data in response');
      }
            
      // Convert to binary data
      const binaryData = atob(audioData);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }
      
      // Create blob
      const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
      
      // Decode audio
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
      return audioBuffer;
    } catch (error) {
      console.error(`Error processing chunk ${chunk.index}:`, error);
      throw error;
    }
  }

  /**
   * Check if audio file exists in S3
   */
  private async checkExistingAudio(): Promise<void> {
    const audioFilename = `story_audio_${this.config.storyIndex + 1}.mp3`;
    // Use the correct path structure without 'public/' prefix since EnhancedStorage handles that
    const audioPath = `${this.config.userId}/${this.config.artifactId}/${audioFilename}`;
    
    try {      
      // Try CloudFront first if available
      const useCloudFront = !!process.env.REACT_APP_S3_URL;
      
      if (useCloudFront) {
        const cloudFrontUrl = process.env.REACT_APP_S3_URL;
        if (cloudFrontUrl) {
          // Ensure we have the https:// protocol
          const baseUrl = cloudFrontUrl.startsWith('http') 
            ? cloudFrontUrl 
            : `https://${cloudFrontUrl}`;
          
          // Ensure baseUrl ends with a slash
          const formattedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
          
          // Build path WITHOUT the /public prefix
          let cfPath = `${this.config.userId}/${this.config.artifactId}/${audioFilename}`;
          
          const fullUrl = `${formattedBaseUrl}${cfPath}`;
          
          // Use HEAD request for reliable existence check
          try {
            const verifyResult = await fetch(fullUrl, { method: 'HEAD' });
            
            if (verifyResult.ok) {
              // Set S3 path and return
              this.setState({
                ...this.state,
                s3Path: audioPath
              });
              return;
            } 
          } catch (cfError) {
            console.log(`CloudFront check error: ${cfError}`);
          }
        }
      }
      
      // If CloudFront check failed, try S3 with verification
      try {
        const result = await enhancedStorage.get(audioPath, {
          download: false
        });
        
        if (result && typeof result === 'string') {
          // CRITICAL: Don't trust the URL - verify the file actually exists
          try {
            const verifyResponse = await fetch(result, { method: 'HEAD' });
            
            if (verifyResponse.ok) {              
              // Set S3 path
              this.setState({
                ...this.state,
                s3Path: audioPath
              });
              
              return;
            } else {
              throw new Error('File does not exist (verified with HEAD request)');
            }
          } catch (verifyError) {
            throw new Error('Failed to verify file existence');
          }
        } else {
          throw new Error('Invalid response from S3');
        }
      } catch (error) {
        console.error(`Error checking for audio file, `, error);
        throw error;
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Play from S3 path
   */
  private async playFromS3(s3Path: string): Promise<void> {
    try {      
      // First verify the file actually exists
      let s3Url;
      
      // Check if CloudFront is enabled
      const useCloudFront = !!process.env.REACT_APP_S3_URL;
      
      if (useCloudFront) {
        // Generate CloudFront URL directly
        const cloudFrontUrl = process.env.REACT_APP_S3_URL;
        if (cloudFrontUrl) {
          // Extract userId, artifactId and filename from s3Path
          const pathParts = s3Path.split('/');
          if (pathParts.length >= 3) {
            const userId = pathParts[0];
            const artifactId = pathParts[1];
            const filename = pathParts.slice(2).join('/');
            
            // Ensure we have the https:// protocol
            const baseUrl = cloudFrontUrl.startsWith('http') 
              ? cloudFrontUrl 
              : `https://${cloudFrontUrl}`;
            
            // Ensure baseUrl ends with a slash
            const formattedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
            
            // Build path WITHOUT the /public prefix
            s3Url = `${formattedBaseUrl}${userId}/${artifactId}/${filename}`;
                        
            // Check if the file exists via CloudFront
            try {
              const verifyResult = await fetch(s3Url, { method: 'HEAD' });
              
              if (!verifyResult.ok) {
                console.warn(`CloudFront file check failed with status: ${verifyResult.status}`);
                // Continue with S3 fallback
                s3Url = null;
              }
            } catch (cfError) {
              console.warn(`CloudFront check error: ${cfError}`);
              // Continue with S3 fallback
              s3Url = null;
            }
          }
        }
      }
      
      // If CloudFront failed or is disabled, try S3
      if (!s3Url) {
        try {
          s3Url = await enhancedStorage.get(s3Path, {
            download: false
          });
        } catch (s3Error) {
          console.error(`File does not exist`, s3Error);
          
          // Clear S3 path since it doesn't exist
          this.setState({
            ...this.state,
            s3Path: undefined,
            isPlaying: false,
            audioStatus: 'error',
            audioError: 'Audio file not found in storage'
          });
          return;
        }
      }
      
      if (!s3Url) {
        throw new Error('Failed to get a valid URL for the audio file');
      }
            
      // For mobile devices, we'll try to use the URL directly first
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      if (isMobile) {
        try {          
          // Cache the URL
          this.setState({
            ...this.state,
            cachePath: typeof s3Url === 'string' ? s3Url : String(s3Url)
          });
          
          // Play from the URL directly
          await this.playFromCache(typeof s3Url === 'string' ? s3Url : String(s3Url));
          return;
        } catch (directPlayError) {
          console.error('Error playing directly from URL:', directPlayError);
          // Continue to the download method below if direct playback fails
        }
      }
            
      try {
        // Use fetch API for more reliable downloads
        const response = await fetch(typeof s3Url === 'string' ? s3Url : String(s3Url));
        
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        // Cache the URL
        this.setState({
          ...this.state,
          cachePath: blobUrl
        });
        
        // Play from cache
        await this.playFromCache(blobUrl);
      } catch (downloadError) {
        console.error('Error downloading audio:', downloadError);
        
        // Set error state
        this.setState({
          ...this.state,
          s3Path: undefined,
          isPlaying: false,
          audioStatus: 'error',
          audioError: 'Failed to play audio from storage'
        });
      }
    } catch (error) {
      console.error('Error in playFromXX:', error);
      
      this.setState({
        ...this.state,
        s3Path: undefined,
        isPlaying: false,
        audioStatus: 'error',
        audioError: String(error)
      });
    }
  }

  /**
   * Reset audio state to notcreated
   */
  public resetAudioState(): void {    
    // Don't reset to notcreated if we're using system voice
    if (this.state.useSystemVoice) {
      this.setState({
        ...this.state,
        audioStatus: 'ready',
        audioError: undefined
      });
      return;
    }
    
    // Clear S3 path and cache path
    this.setState({
      ...this.state,
      s3Path: undefined,
      cachePath: undefined,
      audioStatus: 'notcreated',
      audioError: undefined
    });
  }

  /**
   * Convert AudioBuffer to WAV Blob
   */
  private async audioBufferToWav(buffer: AudioBuffer): Promise<Blob> {
    // Simple WAV file creation from AudioBuffer
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2;
    const sampleRate = buffer.sampleRate;
    
    // Create the WAV file buffer
    const buffer8 = new ArrayBuffer(44 + length);
    const view = new DataView(buffer8);
    
    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    
    // File length
    view.setUint32(4, 32 + length, true);
    
    // RIFF type
    this.writeString(view, 8, 'WAVE');
    
    // Format chunk identifier
    this.writeString(view, 12, 'fmt ');
    
    // Format chunk length
    view.setUint32(16, 16, true);
    
    // Sample format (raw)
    view.setUint16(20, 1, true);
    
    // Channels
    view.setUint16(22, numOfChan, true);
    
    // Sample rate
    view.setUint32(24, sampleRate, true);
    
    // Byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * 2 * numOfChan, true);
    
    // Block align (channel count * bytes per sample)
    view.setUint16(32, numOfChan * 2, true);
    
    // Bits per sample
    view.setUint16(34, 16, true);
    
    // Data chunk identifier
    this.writeString(view, 36, 'data');
    
    // Data chunk length
    view.setUint32(40, length, true);
    
    // Write the PCM samples
    const data = new Float32Array(buffer.getChannelData(0));
    let offset = 44;
    
    for (let i = 0; i < data.length; i++) {
      // Clamp the value to the 16-bit range
      const sample = Math.max(-1, Math.min(1, data[i]));
      
      // Convert to 16-bit signed integer
      const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      
      // Write the sample
      view.setInt16(offset, value, true);
      offset += 2;
    }
    
    return new Blob([buffer8], { type: 'audio/wav' });
  }

  /**
   * Helper method to write string to DataView
   */
  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Check if speech synthesis is speaking
   */
  public isSpeechSynthesisSpeaking(): boolean {
    if (this.speechSynthesis) {
      return this.speechSynthesis.speaking || this.speechSynthesis.pending;
    }
    return false;
  }

  /**
   * Update S3 path for externally loaded audio
   */
  public updateS3Path(path: string): void {    
    // Allow S3 path updates even when using system voice
    // This is important for cases where we want to override system voice with file playback
    this.setState({
      ...this.state,
      s3Path: path,
      audioStatus: 'ready'
    });
    
    // Just log that we're using system voice, but still update the path
    if (this.state.useSystemVoice) {
      console.log('Using system voice, but still updating S3 path for potential file override');
    }
  }
  
  /**
   * Update artifacts_stories.json file in S3
   */
  private async updateArtifactStoriesJson(storyIndex: number, audioFilename: string): Promise<void> {
    try {      
      // Path to the artifact_stories.json file
      const jsonPath = `${this.config.userId}/${this.config.artifactId}/artifact_stories.json`;
      
      try {
        // Fetch the current JSON file
        const existingJsonData = await enhancedStorage.get(jsonPath, {
          download: true
        });
        
        // Parse the JSON data - handle different response formats
        let jsonContent: string;
        let storiesArray: any[];
        
        try {          
          // Check if existingJsonData is an object with a Body property
          if (existingJsonData && typeof existingJsonData === 'object' && 'Body' in existingJsonData) {
            const body = (existingJsonData as any).Body;
            
            // Check the type of body and handle accordingly
            if (body instanceof Blob) {
              // Handle Blob (from CloudFront)
              jsonContent = await new Response(body).text();
            } else if (body instanceof ArrayBuffer) {
              // Handle ArrayBuffer (from S3 directly)
              jsonContent = new TextDecoder().decode(body);
            } else if (typeof body === 'string') {
              // Handle string
              jsonContent = body;
            } else {
              // Try to convert to string
              jsonContent = JSON.stringify(body);
            }
          } else if (typeof existingJsonData === 'string') {
            // Handle if the entire response is a string
            jsonContent = existingJsonData;
          } else {
            // Last resort - stringify the whole object
            jsonContent = JSON.stringify(existingJsonData);
          }
          
          // Parse the JSON string
          storiesArray = JSON.parse(jsonContent);
        } catch (parseError) {
          console.error('Error parsing JSON data:', parseError);
          throw new Error('Failed to parse JSON data');
        }
        
        // Update the story_audio field for the specified index
        if (Array.isArray(storiesArray) && storyIndex < storiesArray.length) {
          storiesArray[storyIndex].story_audio = audioFilename;
          
          // Convert back to JSON
          const updatedJsonContent = JSON.stringify(storiesArray, null, 2);
          
          // Save the updated JSON back to S3
          await enhancedStorage.put(
            jsonPath,
            new Blob([updatedJsonContent], { type: 'application/json' }),
            {
              contentType: 'application/json'
            }
          );
          
        } else {
          console.warn(`Story index ${storyIndex} is out of bounds or JSON structure is invalid`);
        }
      } catch (getError) {
        console.error(`Error retrieving artifact_stories.json:`, getError);
                
        try {
          // Try to use the stories from artifactDescription if available
          const artifactStories = this.config.artifactDescription?.stories;
          let newStoriesArray: any[] = [];
          
          if (artifactStories && Array.isArray(artifactStories)) {
            // Clone the stories array from artifactDescription
            newStoriesArray = JSON.parse(JSON.stringify(artifactStories));
          } else {
            // Create default empty stories
            newStoriesArray = [...Array(Math.max(storyIndex + 1, 3))].map((_, index) => {
              return {
                culture: `Story ${index + 1}`,
                view: "",
                culture_story: "",
                story_audio: ""
              };
            });
          }
          
          // Update the current story's audio filename
          if (storyIndex < newStoriesArray.length) {
            newStoriesArray[storyIndex].story_audio = audioFilename;
          }
          
          // Convert to JSON
          const newJsonContent = JSON.stringify(newStoriesArray, null, 2);
          
          // Save the new JSON to S3
          await enhancedStorage.put(
            jsonPath,
            new Blob([newJsonContent], { type: 'application/json' }),
            {
              contentType: 'application/json'
            }
          );
          
        } catch (createError) {
          console.error(`Failed to create new artifact_stories.json:`, createError);
        }
      }
    } catch (error) {
      console.error(`Error updating artifact_stories.json:`, error);
    }
  }

  /**
   * Resume browser audio context
   */
  public async resumeAudioContext(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('Error resuming audio context:', error);
        throw error;
      }
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.stop();
    
    if (this.audioContext) {
      this.audioContext.close();
    }
    
    // Clear listeners
    this.stateListeners = [];
  }

  /**
   * Subscribe to state changes
   */
  public subscribe(listener: (state: AudioManagerState) => void): () => void {
    this.stateListeners.push(listener);
    
    // Immediately notify with current state
    listener({ ...this.state });
    
    // Return unsubscribe function
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  /**
   * Get current state
   */
  public getState(): AudioManagerState {
    return { ...this.state };
  }

  /**
   * Set state and notify listeners
   */
  private setState(newState: AudioManagerState): void {
    // Create a new state object for immutability
    this.state = { ...this.state, ...newState };
    
    // Notify listeners
    if (!this.isDestroyed) {
      // Always send a copy of the state, never the original
      const stateCopy = { ...this.state };
      this.stateListeners.forEach(listener => listener(stateCopy));
    }
    
    // Debug log for isPlaying state changes
    if (newState.isPlaying !== undefined && this.state.isPlaying !== newState.isPlaying) {
      console.log(`AudioManager isPlaying state changed to: ${newState.isPlaying}`);
    }
  }

  /**
   * Download the audio file
   */
  public async downloadAudio(): Promise<void> {
    // Skip for system voice
    if (this.state.useSystemVoice) {
      return;
    }
    
    try {
      // Check if audio is available
      if (this.state.audioStatus !== 'ready') {
        throw new Error('Audio is not ready for download');
      }
      
      // Get the audio URL
      let audioUrl: string | null = null;
      
      // Try from cache first
      if (this.state.cachePath) {
        audioUrl = this.state.cachePath;
      } 
      // Then try from S3
      else if (this.state.s3Path) {
        const result = await enhancedStorage.get(this.state.s3Path, {
          download: false
        });
        
        if (typeof result === 'string') {
          audioUrl = result;
        }
      }
      
      if (!audioUrl) {
        throw new Error('No audio URL available for download');
      }
      
      // Check device type for different download approaches
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      
      // Fetch the audio data
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      
      // Create filename
      const filename = `story_audio_${this.config.storyIndex + 1}.mp3`;
      
      // iOS specific handling
      if (isIOS) {
        // Create a new URL for the blob
        const blobUrl = URL.createObjectURL(blob);
        
        // Open in new tab for user to save
        window.open(blobUrl);
        
        // Clean up
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        return;
      }
      
      // Try the File System Access API for newer browsers
      if ('showSaveFilePicker' in window && !isMobile) {
        try {
          const opts = {
            suggestedName: filename,
            types: [{
              description: 'Audio File',
              accept: {'audio/mpeg': ['.mp3']}
            }],
          };
          
          // Use any to avoid TypeScript errors with the experimental API
          const handle = await (window as any).showSaveFilePicker(opts);
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (err) {
          console.log('File System Access API not supported or cancelled:', err);
          // Fall through to alternative method
        }
      }
      
      // Android - try Web Share API
      if (isMobile && navigator.share) {
        try {
          const file = new File([blob], filename, { type: 'audio/mpeg' });
          await navigator.share({
            files: [file],
            title: 'Download Audio'
          });
          return;
        } catch (err) {
          console.log('Web Share API failed or cancelled:', err);
          // Fall through to fallback
        }
      }
      
      // Traditional download approach
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error('Error downloading audio:', error);
      throw error;
    }
  }
}

export default AudioManager;