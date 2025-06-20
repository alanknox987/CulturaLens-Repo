import React, { useState, useRef, useEffect } from 'react';
import { API, Storage, Auth } from 'aws-amplify';
import axios from 'axios'; // Import axios for type checking
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';
import CulturePreferences from '../components/CulturePreferences';
import StoryView from '../components/StoryView';
import { useUserPreferences } from '../contexts/UserPreferencesContext';
import { getCloudFrontUrl, checkFileExists } from '../cloudfront';

// Interface definitions for type safety
interface ArtifactDescription {
  object: string;
  userid: string;
  artifactid: string;
  identityid?: string; // AWS Cognito identity ID
  identityId?: string; // Alternative capitalized version
  filename: string;
  title: string;
  processed_timestamp: number;
  file_type: string;
  description: string;
  historical_description: string;
  cultural_description: string;
  cultural_views?: { culture: string; view: string }[]; // Cultural perspectives array
}

interface CulturalPreferences {
  age_preference: string;
  gender_preference: string;
  language_preference: string;
  voice_preference: string; // Audio narration voice preference
}

interface Story {
  culture: string;
  view: string;
  culture_story: string;
}

const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const userPreferences = useUserPreferences();
  
  // Image handling state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [modifiedImageFile, setModifiedImageFile] = useState<File | null>(null);
  
  // Artifact and story state
  const [artifactDescription, setArtifactDescription] = useState<ArtifactDescription | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  
  // Cultural preferences state with initialization
  const [culturalPreferences, setCulturalPreferences] = useState<CulturalPreferences>(() => {
    const initialPrefs = {
      age_preference: userPreferences.agePreference || '8-10',
      gender_preference: userPreferences.genderPreference || 'female',
      language_preference: userPreferences.language || 'en',
      voice_preference: userPreferences.voicePreference || 'system',
    };
    console.log('Cultural preferences initialized');
    return initialPrefs;
  });
  
  // UI state management
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingStories, setIsGeneratingStories] = useState<boolean>(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState<boolean>(true);
  const [showStories, setShowStories] = useState<boolean>(true);
  
  // User and artifact identifiers
  const [userId, setUserId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  
  // Refs for file inputs and scrolling
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const storyViewRef = useRef<HTMLDivElement>(null);
  
  // CloudFront configuration
  const [useCloudFront, setUseCloudFront] = useState<boolean>(!!process.env.REACT_APP_S3_URL);

  /**
   * File validation and sanitization utilities
   */
  
  // Validate file type - only allow PNG, JPG, JPEG
  const validateFileType = (file: File): boolean => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    const allowedExtensions = ['.png', '.jpg', '.jpeg'];
    
    // Check MIME type
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      return false;
    }
    
    // Check file extension as additional validation
    const fileName = file.name.toLowerCase();
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
    
    return hasValidExtension;
  };

  // Sanitize filename for S3 compatibility
  const sanitizeFilename = (filename: string): string => {
    // Get file extension
    const lastDotIndex = filename.lastIndexOf('.');
    const name = lastDotIndex !== -1 ? filename.substring(0, lastDotIndex) : filename;
    const extension = lastDotIndex !== -1 ? filename.substring(lastDotIndex) : '';
    
    // Sanitize the name part
    let sanitizedName = name
      // Remove or replace invalid characters
      .replace(/[^a-zA-Z0-9\-_]/g, '_') // Replace special chars with underscore
      .replace(/\s+/g, '_') // Replace spaces with underscore
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .toLowerCase(); // Convert to lowercase for consistency
    
    // Ensure filename isn't empty after sanitization
    if (!sanitizedName) {
      sanitizedName = 'image';
    }
    
    // Limit filename length (S3 key limit is 1024, but keeping reasonable)
    if (sanitizedName.length > 100) {
      sanitizedName = sanitizedName.substring(0, 100);
    }
    
    // Add timestamp to ensure uniqueness
    const timestamp = Date.now();
    sanitizedName = `${sanitizedName}_${timestamp}`;
    
    return `${sanitizedName}${extension.toLowerCase()}`;
  };

  /**
   * UI interaction handlers
   */
  
  // Toggle artifact description section visibility
  const toggleDescription = () => {
    setIsDescriptionExpanded(!isDescriptionExpanded);
  };

  // Collapse description section (used when stories are generated)
  const collapseDescription = () => {
    setIsDescriptionExpanded(false);
  };

  // Smooth scroll to story view section
  const scrollToStoryView = () => {
    if (storyViewRef.current) {
      storyViewRef.current.scrollIntoView({ 
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  /**
   * Effect hooks for initialization and state management
   */

  // Initialize user ID on component mount
  useEffect(() => {
    const fetchUserId = async () => {
      try {
        const userInfo = await Auth.currentUserInfo();
        setUserId(userInfo.username);
      } catch (error) {
        console.error('Error fetching user information');
      }
    };
    fetchUserId();
  }, []);

  // Update cultural preferences when user context changes
  useEffect(() => {
    // Only update from user preferences if we haven't loaded artifact-specific preferences
    if (!artifactDescription) {
      console.log('Updating preferences from user context');
      
      setCulturalPreferences({
        age_preference: userPreferences.agePreference || '8-10',
        gender_preference: userPreferences.genderPreference || 'female',
        language_preference: userPreferences.language || 'en',
        voice_preference: userPreferences.voicePreference || 'system',
      });
    }
  }, [userPreferences.agePreference, userPreferences.genderPreference, userPreferences.language, userPreferences.voicePreference, artifactDescription]);

  // Load artifact from gallery selection (session storage)
  useEffect(() => {
    const loadSelectedArtifact = async () => {
      const selectedArtifact = sessionStorage.getItem('selectedArtifact');
      const selectedStories = sessionStorage.getItem('selectedStories');
      const storedIdentityId = sessionStorage.getItem('identityId');
      
      if (selectedArtifact) {
        console.log('Loading artifact from gallery selection');
        
        const parsedArtifact = JSON.parse(selectedArtifact);
        setArtifactDescription(parsedArtifact);
        setArtifactId(parsedArtifact.artifactid);
        
        // Load associated stories if available
        if (selectedStories) {
          console.log('Loading associated stories');
          const parsedStories = JSON.parse(selectedStories);
          setStories(parsedStories);
          setShowStories(true);
        } else {
          setStories([]);
          setShowStories(true);
        }
        
        // Load artifact image from storage
        try {
          const identityId = parsedArtifact.identityid || parsedArtifact.identityId || storedIdentityId;
          
          let imageUrl;
          
          if (useCloudFront) {
            // Attempt to use CloudFront for faster delivery
            imageUrl = getCloudFrontUrl(
              parsedArtifact.userid,
              parsedArtifact.artifactid,
              parsedArtifact.filename,
              identityId
            );
            
            // Verify CloudFront URL accessibility
            const exists = await checkFileExists(imageUrl);
            if (!exists) {
              console.warn('CloudFront URL not accessible, falling back to S3');
              // Fallback to direct S3 access
              imageUrl = await Storage.get(
                `${parsedArtifact.userid}/${parsedArtifact.artifactid}/${parsedArtifact.filename}`,
                { 
                  level: 'public',
                  identityId: identityId,
                  download: false,
                  expires: 3600
                }
              );
            }
          } else {
            // Use S3 directly
            imageUrl = await Storage.get(
              `${parsedArtifact.userid}/${parsedArtifact.artifactid}/${parsedArtifact.filename}`,
              { 
                level: 'public',
                identityId: identityId,
                download: false,
                expires: 3600
              }
            );
          }
          
          setImagePreview(imageUrl as string);
          
          // Load artifact-specific cultural preferences
          try {
            console.log(`Loading cultural preferences for artifact`);
            
            let prefsUrl;
            
            if (useCloudFront) {
              // Try CloudFront first
              prefsUrl = getCloudFrontUrl(
                parsedArtifact.userid,
                parsedArtifact.artifactid,
                'cultural_preferences.json',
                identityId
              );
              
              const exists = await checkFileExists(prefsUrl);
              if (!exists) {
                console.warn('Preferences not found via CloudFront, falling back to S3');
                // Fallback to S3
                prefsUrl = await Storage.get(
                  `${parsedArtifact.userid}/${parsedArtifact.artifactid}/cultural_preferences.json`,
                  { 
                    level: 'public',
                    identityId: identityId,
                    download: false,
                    expires: 3600
                  }
                );
              }
            } else {
              // Use S3 directly
              prefsUrl = await Storage.get(
                `${parsedArtifact.userid}/${parsedArtifact.artifactid}/cultural_preferences.json`,
                { 
                  level: 'public',
                  identityId: identityId,
                  download: false,
                  expires: 3600
                }
              );
            }
            
            if (typeof prefsUrl === 'string') {
              const response = await fetch(prefsUrl);
              if (response.ok) {
                const prefsData = await response.json();
                console.log('Successfully loaded artifact preferences');
                
                // Handle both direct object and array formats from storage
                const preferences = Array.isArray(prefsData) ? prefsData[0] : prefsData;
                
                if (preferences) {
                  setCulturalPreferences({
                    age_preference: preferences.age_preference || culturalPreferences.age_preference,
                    gender_preference: preferences.gender_preference || culturalPreferences.gender_preference,
                    language_preference: preferences.language_preference || culturalPreferences.language_preference,
                    voice_preference: preferences.voice_preference || 'system',
                  });
                }
              }
            }
          } catch (error) {
            console.warn('No cultural preferences found for this artifact, using defaults');
          }
        } catch (error) {
          console.error('Error loading artifact image');
        }
        
        // Clean up session storage after loading
        sessionStorage.removeItem('selectedArtifact');
        sessionStorage.removeItem('selectedStories');
      }
    };
    
    loadSelectedArtifact();
  }, [useCloudFront, culturalPreferences]);

  // Auto-scroll to stories when they're loaded and visible
  useEffect(() => {
    if (stories.length > 0 && showStories) {
      // Delay scroll to ensure DOM updates are complete
      setTimeout(() => {
        scrollToStoryView();
      }, 300);
    }
  }, [stories, showStories]);

  /**
   * File handling and image manipulation functions
   */

  // Handle file selection from input or camera
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!validateFileType(file)) {
        setError(t('invalidFileType') || 'Please select a PNG, JPG, or JPEG image file.');
        // Clear the input
        if (event.target) {
          event.target.value = '';
        }
        return;
      }

      // Clear any previous errors
      setError(null);
      
      setImageFile(file);
      setModifiedImageFile(null); // Reset any rotation modifications
      
      // Create preview URL for the selected image
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      
      // Reset artifact state when new image is selected
      setArtifactDescription(null);
      setStories([]);
      setShowStories(true);
    }
  };

  // Trigger camera capture
  const handleCameraCapture = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    }
  };

  // Trigger file upload dialog
  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  /**
   * Image rotation functionality using HTML5 Canvas
   * Rotates the image 90 degrees left or right
   */
  const rotateImage = (direction: 'left' | 'right') => {
    if (!imagePreview) return;
    
    // Create temporary image element to load current image
    const img = new Image();
    img.crossOrigin = "Anonymous"; // Handle CORS for external image sources
    
    img.onload = () => {
      // Create canvas for image manipulation
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        console.error('Canvas context unavailable');
        return;
      }
      
      // Swap dimensions for 90-degree rotation
      let newWidth = img.height;
      let newHeight = img.width;
      
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      // Apply rotation transformation
      ctx.save();
      
      if (direction === 'right') {
        // 90 degrees clockwise
        ctx.translate(newWidth, 0);
        ctx.rotate(Math.PI / 2);
      } else {
        // 90 degrees counter-clockwise
        ctx.translate(0, newHeight);
        ctx.rotate(-Math.PI / 2);
      }
      
      // Draw the rotated image
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      
      // Convert canvas to data URL and update preview
      const rotatedImageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setImagePreview(rotatedImageDataUrl);
      
      // Create File object from canvas for upload
      canvas.toBlob((blob) => {
        if (blob) {
          const fileName = imageFile?.name || 'rotated-image.jpg';
          const rotatedImageFile = new File([blob], fileName, { 
            type: 'image/jpeg',
            lastModified: new Date().getTime()
          });
          
          setModifiedImageFile(rotatedImageFile);
        }
      }, 'image/jpeg', 0.9);
    };
    
    // Handle image loading errors (especially for remote URLs)
    img.onerror = (e) => {
      console.error('Error loading image for rotation');
      setError(t('errorRotatingImage') || 'Error rotating image');
      
      // For remote images (S3/CloudFront), fetch as blob first
      if (imagePreview.startsWith('http')) {
        console.log('Fetching remote image for rotation');
        
        fetch(imagePreview)
          .then(response => {
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.blob();
          })
          .then(blob => {
            const localUrl = URL.createObjectURL(blob);
            
            // Retry rotation with local blob URL
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              
              if (!ctx) {
                console.error('Canvas context unavailable');
                return;
              }
              
              let newWidth = img.height;
              let newHeight = img.width;
              
              canvas.width = newWidth;
              canvas.height = newHeight;
              
              ctx.save();
              
              if (direction === 'right') {
                ctx.translate(newWidth, 0);
                ctx.rotate(Math.PI / 2);
              } else {
                ctx.translate(0, newHeight);
                ctx.rotate(-Math.PI / 2);
              }
              
              ctx.drawImage(img, 0, 0);
              ctx.restore();
              
              const rotatedImageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
              setImagePreview(rotatedImageDataUrl);
              
              canvas.toBlob((blob) => {
                if (blob) {
                  const fileName = 'rotated-image.jpg';
                  const rotatedImageFile = new File([blob], fileName, { 
                    type: 'image/jpeg',
                    lastModified: new Date().getTime()
                  });
                  
                  setModifiedImageFile(rotatedImageFile);
                }
              }, 'image/jpeg', 0.9);
              
              // Clean up temporary object URL
              URL.revokeObjectURL(localUrl);
            };
            
            img.onerror = () => {
              console.error('Failed to load image even after fetching');
              setError(t('errorRotatingImage') || 'Error rotating image');
            };
            
            img.src = localUrl;
          })
          .catch(error => {
            console.error('Error fetching image for rotation');
            setError(t('errorRotatingImage') || 'Error rotating image');
          });
      }
    };
    
    img.src = imagePreview;
  };

  // Rotation button click handlers
  const handleRotateImage = (direction: 'left' | 'right') => {
    rotateImage(direction);
  };

  /**
   * Cross-platform image download functionality
   * Handles different devices and browsers appropriately
   */
  const handleDownloadImage = async () => {
    if (!imagePreview) return;
    
    // Detect device type for appropriate download method
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    try {
      // Convert image to blob for download
      let imageBlob;
      const filename = imageFile?.name || 'culturalens-image.jpg';
      
      if (imagePreview.startsWith('data:')) {
        // Handle canvas-generated data URLs
        const response = await fetch(imagePreview);
        imageBlob = await response.blob();
      } else {
        // Handle external URLs (S3/CloudFront)
        const response = await fetch(imagePreview);
        imageBlob = await response.blob();
      }
      
      // Try modern File System Access API for desktop browsers
      if ('showSaveFilePicker' in window && !isMobile) {
        try {
          const opts = {
            suggestedName: filename,
            types: [{
              description: 'Image',
              accept: {'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png']}
            }],
          };
          
          const handle = await (window as any).showSaveFilePicker(opts);
          const writable = await handle.createWritable();
          await writable.write(imageBlob);
          await writable.close();
          return; // Success, exit function
        } catch (fsErr) {
          console.log('File System Access API not supported or cancelled');
          // Continue to fallback methods
        }
      }
      
      // iOS-specific handling
      if (isIOS) {
        // Open image in new tab for iOS Safari save functionality
        const blobUrl = URL.createObjectURL(imageBlob);
        window.open(blobUrl);
        
        // Clean up URL after delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        return;
      }
      
      // Try Web Share API for mobile devices
      if (isMobile && navigator.share) {
        try {
          const file = new File([imageBlob], filename, { type: imageBlob.type });
          
          await navigator.share({
            files: [file],
            title: 'Save Image',
          });
          return; // Success, exit function
        } catch (shareErr) {
          console.log('Web Share API not available or cancelled');
          // Continue to fallback method
        }
      }
      
      // Fallback: Traditional download link method
      const blobUrl = URL.createObjectURL(imageBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up URL after download
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      
    } catch (error) {
      console.error('Error downloading image');
      setError(t('errorDownloadingImage') || 'Error downloading image');
    }
  };

  /**
   * AWS S3 storage operations
   */

  // Upload image file to S3 storage
  const uploadImageToS3 = async (file: File, userId: string, artifactId: string) => {
    try {
      const result = await Storage.put(
        `${userId}/${artifactId}/${file.name}`,
        file,
        {
          contentType: file.type,
          level: 'public'
        }
      );
      
      return result.key; // Return the S3 key for the uploaded file
    } catch (error) {
      console.error('Error uploading file to S3');
      throw error;
    }
  };
  
  // Get AWS Cognito identity pool ID for current user
  const getIdentityPoolId = async () => {
    try {
      const credentials = await Auth.currentCredentials();
      return credentials.identityId;
    } catch (error) {
      console.error('Error getting identity pool ID');
      throw error;
    }
  };
  
  // Save cultural preferences to S3 as JSON
  const saveCulturalPreferences = async (
    userId: string, 
    artifactId: string, 
    identityId: string, 
    preferences: CulturalPreferences
  ) => {
    try {
      const s3Config = {
        contentType: 'application/json',
        level: 'public' as const
      };

      await Storage.put(
        `${userId}/${artifactId}/cultural_preferences.json`,
        JSON.stringify(preferences),
        s3Config
      );
      console.log('Cultural preferences saved successfully');
    } catch (error) {
      console.error('Error saving cultural preferences');
      // Non-critical error, don't throw to avoid breaking the flow
    }
  };

  /**
   * Main processing functions for artifacts and stories
   */
    
  // Process uploaded image to generate artifact description
  const processImage = async () => {
    if (!userId) return;
    
    // Use modified image if available (rotated), otherwise use original
    const fileToProcess = modifiedImageFile || imageFile;
    
    if (!fileToProcess) return;

    // Validate file type before processing
    if (!validateFileType(fileToProcess)) {
      setError(t('invalidFileType') || 'Please select a PNG, JPG, or JPEG image file.');
      return;
    }
  
    setIsLoading(true);
    setError(null);
    
    try {
      // Generate unique artifact ID
      const newArtifactId = uuidv4();
      setArtifactId(newArtifactId);
      
      // Get AWS identity ID for proper S3 access
      const identityId = await getIdentityPoolId();
      
      // Sanitize filename for S3 compatibility
      const sanitizedFileName = sanitizeFilename(fileToProcess.name);
      
      // Create file with sanitized name
      const fileWithSanitizedName = new File(
        [fileToProcess], 
        sanitizedFileName, 
        { type: fileToProcess.type }
      );
      
      // Upload image to S3
      await uploadImageToS3(fileWithSanitizedName, userId, newArtifactId);
      
      // Call Lambda function to analyze the artifact
      const response = await API.post('culturalensApi', '/artifact-description', {
        body: {
          s3Path: `${userId}/${newArtifactId}/${sanitizedFileName}`,
          userId,
          artifactId: newArtifactId,
          identityId,
        }
      });
            
      console.log('Artifact analysis completed successfully');
      
      // Process API response to handle different response formats
      let processedResponse;
      
      if (response.data && response.data.metadata) {
        // Handle nested metadata structure
        processedResponse = response.data.metadata;
      } else if (Array.isArray(response)) {
        // Handle array response format
        processedResponse = response[0];
      } else {
        // Use response directly
        processedResponse = response;
      }
      
      console.log('Artifact description processed successfully');
      
      // Validate that cultural views are present
      if (!processedResponse.cultural_views) {
        console.warn('Warning: cultural_views missing from artifact description');
      } else {
        console.log('Cultural views successfully extracted');
      }
      
      setArtifactDescription(processedResponse);
      
      // Expand description section for new artifacts
      setIsDescriptionExpanded(true);
      
      // Save current cultural preferences with the artifact
      await saveCulturalPreferences(userId, newArtifactId, identityId, culturalPreferences);
      
    } catch (error) {
      console.error('Error processing image');
      setError(t('errorProcessingImage'));
    } finally {
      setIsLoading(false);
    }
  };

  // Generate cultural stories based on artifact and preferences
  const createStories = async () => {
    if (!artifactDescription || !userId || !artifactId) return;

    setIsLoading(true);
    setIsGeneratingStories(true);
    setError(null);
    
    // Hide existing stories during regeneration
    if (stories.length > 0) {
      setShowStories(false);
    }
    
    // Collapse description to make room for stories
    collapseDescription();
    
    try {
      // Get identity ID from artifact or current session
      const credentials = await Auth.currentCredentials();
      const identityId = artifactDescription.identityid || artifactDescription.identityId || credentials.identityId;
      
      // Update artifact description with identity ID for consistency
      const updatedArtifactDescription = {
        ...artifactDescription,
        identityid: identityId,
        identityId: identityId
      };
      
      // Validate that cultural views exist before processing
      if (!updatedArtifactDescription.cultural_views || !Array.isArray(updatedArtifactDescription.cultural_views)) {
        console.error('Missing or invalid cultural_views in artifact description');
        setError(t('errorMissingCulturalViews'));
        setIsLoading(false);
        setIsGeneratingStories(false);
        return;
      }
      
      console.log('Generating cultural stories for artifact');
      
      // Save current preferences before generating stories
      await saveCulturalPreferences(userId, artifactId, identityId, culturalPreferences);
      
      // Call Lambda function to generate cultural stories
      const response = await API.post('culturalensApi', '/artifact-stories', {
        body: {
          artifactDescription: updatedArtifactDescription,
          culturalPreferences,
          userId,
          artifactId,
          identityId
        }
      });
      
      setStories(response);
      setShowStories(true);
      
      console.log('Cultural stories generated successfully');
      
    } catch (err) {
      console.error('Error creating stories');
      
      // Handle different error types appropriately
      if (axios.isAxiosError(err)) {
        if (err.response?.data) {
          setError(`${t('errorCreatingStories')}: ${err.response.data}`);
        } else {
          setError(t('errorCreatingStories'));
        }
      } else {
        setError(t('errorCreatingStories'));
      }
      
      // Show existing stories if available after error
      if (stories.length > 0) {
        setShowStories(true);
      }
    } finally {
      setIsLoading(false);
      setIsGeneratingStories(false);
    }
  };

  /**
   * Main component render
   */
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">{t('exploreArtifacts')}</h1>
      
      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column: Image upload and preview */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          <h2 className="text-xl font-semibold mb-4">{t('welcomeMessage')}</h2>
          
          {/* Hidden file input elements */}
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/png,image/jpeg,image/jpg"
            onChange={handleFileChange} 
          />
          <input 
            type="file" 
            ref={cameraInputRef} 
            className="hidden" 
            accept="image/png,image/jpeg,image/jpg"
            capture="environment" 
            onChange={handleFileChange} 
          />
          
          {/* Action buttons: Upload, Camera, Download */}
          <div className="flex space-x-4 mb-4">
            <button 
              onClick={handleUploadClick}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center"
              aria-label={t('uploadImage') || 'Upload Image'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" />
              </svg>
              <span className="ml-2 hidden md:inline">{t('uploadImage') || ''}</span>
            </button>
            <button 
              onClick={handleCameraCapture}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 flex items-center"
              aria-label={t('takePicture') || 'Take Picture'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="ml-2 hidden md:inline">{t('takePicture') || ''}</span>
            </button>
            {/* Download button - visible only when image is present */}
            {imagePreview && (
              <button 
                onClick={handleDownloadImage}
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600 flex items-center"
                title={t('downloadImage') || 'Download Image'}
                aria-label={t('downloadImage') || 'Download Image'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="ml-2 hidden md:inline">{t('downloadImage') || 'Download'}</span>
              </button>
            )}
          </div>
          
          {/* Image preview section with rotation controls */}
          {imagePreview && (
            <div className="mb-4 relative">
              {/* Image container with overlay controls */}
              <div className="relative overflow-hidden">
                <img 
                  src={imagePreview} 
                  alt="Preview" 
                  className="max-w-full h-auto rounded"
                />
                
                {/* Rotation controls - only show for unprocessed images */}
                {!artifactDescription && (
                  <div className="absolute top-2 left-2 flex space-x-2">
                    {/* Rotate left button */}
                    <button 
                      onClick={() => handleRotateImage('left')}
                      className="bg-gray-800 bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-opacity"
                      title={t('rotateLeft') || 'Rotate Left'}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9,10 C10.1045695,8.8954305 11.8954305,8.8954305 13,10 C14.1045695,11.1045695 14.1045695,12.8954305 13,14 C11.8954305,15.1045695 10.1045695,15.1045695 9,14 C7.8954305,12.8954305 7.8954305,11.1045695 9,10 Z" strokeWidth="0" fill="currentColor"/>
                        <path d="M4,12 C4,7.581722 7.581722,4 12,4 L12,4 L12,1 L16,5 L12,9 L12,6 C8.6862915,6 6,8.6862915 6,12 C6,15.3137085 8.6862915,18 12,18 C15.3137085,18 18,15.3137085 18,12 L18,12 L20,12 C20,16.418278 16.418278,20 12,20 C7.581722,20 4,16.418278 4,12 Z" fill="currentColor"/>
                      </svg>
                    </button>
                    
                    {/* Rotate right button */}
                    <button 
                      onClick={() => handleRotateImage('right')}
                      className="bg-gray-800 bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-opacity"
                      title={t('rotateRight') || 'Rotate Right'}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}>
                        <path d="M9,10 C10.1045695,8.8954305 11.8954305,8.8954305 13,10 C14.1045695,11.1045695 14.1045695,12.8954305 13,14 C11.8954305,15.1045695 10.1045695,15.1045695 9,14 C7.8954305,12.8954305 7.8954305,11.1045695 9,10 Z" strokeWidth="0" fill="currentColor"/>
                        <path d="M4,12 C4,7.581722 7.581722,4 12,4 L12,4 L12,1 L16,5 L12,9 L12,6 C8.6862915,6 6,8.6862915 6,12 C6,15.3137085 8.6862915,18 12,18 C15.3137085,18 18,15.3137085 18,12 L18,12 L20,12 C20,16.418278 16.418278,20 12,20 C7.581722,20 4,16.418278 4,12 Z" fill="currentColor"/>
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              
              {/* Process button - only show for unprocessed images */}
              {!artifactDescription && (
                <div className="mt-2">
                  <button 
                    onClick={processImage}
                    className="w-full bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 flex items-center justify-center"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {t('processing') || ''}
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {t('processImage') || ''}
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
          
          {/* Error message display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded relative mt-2">
              <div className="flex items-center">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            </div>
          )}
        </div>
        
        {/* Right column: Artifact description and cultural preferences */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          {artifactDescription ? (
            <div>
              {/* Collapsible artifact description header */}
              <div 
                className="flex justify-between items-center mb-4 cursor-pointer" 
                onClick={toggleDescription}
              >
                <h2 className="text-xl font-semibold">{artifactDescription.title}</h2>
                <button 
                  className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  aria-label={isDescriptionExpanded ? t('collapseDescription') || 'Collapse Description' : t('expandDescription') || 'Expand Description'}
                >
                  {isDescriptionExpanded ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
              </div>
              
              {/* Collapsible artifact description content */}
              {isDescriptionExpanded && (
                <>
                  <div className="mb-4">
                    <h3 className="font-bold">{t('description')}</h3>
                    <p>{artifactDescription.description}</p>
                  </div>
                  
                  <div className="mb-4">
                    <h3 className="font-bold">{t('historicalDescription')}</h3>
                    <p>{artifactDescription.historical_description}</p>
                  </div>
                  
                  <div className="mb-4">
                    <h3 className="font-bold">{t('culturalDescription')}</h3>
                    <p>{artifactDescription.cultural_description}</p>
                  </div>
                  
                  {/* Cultural views section - only show if data exists */}
                  {artifactDescription.cultural_views && artifactDescription.cultural_views.length > 0 && (
                    <div className="mb-4">
                      <h3 className="font-bold">{t('culturalViews')}</h3>
                      <ul className="list-disc pl-5">
                        {artifactDescription.cultural_views.map((view, index) => (
                          <li key={index}>
                            <strong>{view.culture}:</strong> {view.view}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              
              {/* Cultural preferences and story generation section */}
              <div className="mt-6 border-t pt-4">
                <h3 className="font-bold mb-2">{t('culturalPreferences')}</h3>
                <CulturePreferences 
                  preferences={culturalPreferences} 
                  setPreferences={setCulturalPreferences} 
                />
                <button 
                  onClick={createStories}
                  className="mt-4 bg-indigo-500 text-white px-4 py-2 rounded hover:bg-indigo-600 w-full flex items-center justify-center"
                  disabled={isLoading}
                >
                  {isGeneratingStories ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {t('creating') || ''}
                    </>
                  ) : stories.length > 0 ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {t('regenerateStories') || 'Regenerate Stories'}
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      {t('createStories') || 'Create Stories'}
                    </>
                  )}
                </button>                  
              </div>
            </div>
          ) : (
            // Placeholder when no artifact is loaded
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500">{t('uploadImagePrompt')}</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Stories display section - only visible when stories exist and showStories is true */}
      {stories.length > 0 && showStories && userId && artifactId && (
        <div 
          ref={storyViewRef} 
          className="mt-6 bg-white dark:bg-gray-800 p-4 rounded shadow" 
          id="story-view-section"
        >
          <h2 className="text-xl font-semibold mb-4">{t('culturalStories')}</h2>
          <StoryView 
            stories={stories} 
            userId={userId} 
            artifactId={artifactId} 
            identityId={artifactDescription?.identityid || artifactDescription?.identityId || ''}
            artifactDescription={artifactDescription}
            culturalPreferences={culturalPreferences}
          />
        </div>
      )}          
    </div>
  );
};

export default HomePage;