import React, { useState, useEffect } from 'react';
import { Storage, Auth, API } from 'aws-amplify';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { enhancedStorage } from '../enhancedStorage';

// Interface definitions for artifact data structure
interface ArtifactDescription {
  object: string;
  userid: string;
  artifactid: string;
  filename: string;
  title: string;
  processed_timestamp: number;
  file_type: string;
  description: string;
  historical_description: string;
  cultural_description: string;
  cultural_views: { culture: string; view: string }[];
  identityid?: string;
  identityId?: string;
}

interface Story {
  culture: string;
  view: string;
  culture_story: string;
}

const GalleryPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  // State management for artifacts and UI states
  const [artifacts, setArtifacts] = useState<ArtifactDescription[]>([]);
  const [artifactImageUrls, setArtifactImageUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [identityId, setIdentityId] = useState<string | undefined>(undefined);
  const [rawS3Files, setRawS3Files] = useState<any[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  // CloudFront configuration state
  const [useCloudFront, setUseCloudFront] = useState<boolean>(!!process.env.REACT_APP_S3_URL);
  
  // Log CloudFront configuration on component mount (non-sensitive info)
  useEffect(() => {
  }, [useCloudFront]);

  // Effect to fetch and set the user's identity ID
  useEffect(() => {
    const fetchIdentityId = async () => {
      try {
        const credentials = await Auth.currentCredentials();
        setIdentityId(credentials.identityId);
      } catch (error) {
        console.error('Error fetching identity ID');
        setError(t('errorFetchingIdentity') || 'Error fetching identity information');
      }
    };
    
    fetchIdentityId();
  }, [t]);

  // Effect to fetch artifacts once identity ID is available
  useEffect(() => {
    if (identityId) {
      fetchArtifacts();
    }
  }, [identityId]);

  /**
   * Helper function to find image filename for a given artifact ID
   * Searches through S3 files to locate the image file associated with the artifact
   */
  const getImageFilename = (artifactId: string): string | undefined => {
    if (!rawS3Files || rawS3Files.length === 0) return undefined;
    
    // Filter files that belong to this artifact and are image files (not JSON or cache files)
    const artifactFiles = rawS3Files.filter(file => {
      const key = file.key || '';
      const parts = key.split('/');
      return (parts.length >= 3 && 
        parts[1] === artifactId && 
        !key.endsWith('.json') &&
        !key.includes('/cache/') &&
        (key.endsWith('.jpg') || key.endsWith('.jpeg') || key.endsWith('.png') || key.endsWith('.gif')));
    });
    
    if (artifactFiles.length > 0) {
      // Extract just the filename from the full S3 path
      const fullPath = artifactFiles[0].key;
      const parts = fullPath.split('/');
      return parts[parts.length - 1];
    }
    
    return undefined;
  };

  /**
   * Retrieves artifact description JSON file directly from S3 storage
   * Attempts multiple path structures for backward compatibility
   */
  const getArtifactDescriptionFromS3 = async (
    userId: string,
    artifactId: string,
    identityIdToUse?: string
  ): Promise<ArtifactDescription | undefined> => {
    try {
      // Use provided identity ID or fall back to component state
      const idToUse = identityIdToUse || identityId;
      if (!idToUse) return undefined;
      
      const descriptionPath = `${userId}/${artifactId}/artifact_description.json`;
      
      try {
        // Attempt to get the artifact description from primary path
        const descriptionUrl = await enhancedStorage.get(
          descriptionPath,
          { 
            level: 'public',
            download: false,
            expires: 3600,
            identityId: idToUse
          }
        );
        
        if (typeof descriptionUrl === 'string') {
          const response = await fetch(descriptionUrl);
          if (!response.ok) {
            console.error(`Fetch failed with status ${response.status} for artifact ${artifactId}`);
            throw new Error(`Fetch failed with status ${response.status}`);
          }
          
          const data = await response.json();
          
          // Process and normalize the artifact data structure
          let processedData: ArtifactDescription;
          
          if (Array.isArray(data) && data.length > 0) {
            processedData = data[0];
          } else {
            processedData = data;
          }
          
          // Ensure required fields are populated
          if (!processedData.artifactid) {
            processedData.artifactid = artifactId;
          }
          
          if (!processedData.userid) {
            processedData.userid = userId;
          }
          
          // Store identity ID for future reference
          if (!processedData.identityid && !processedData.identityId) {
            processedData.identityid = idToUse;
          }
          
          return processedData;
        }
      } catch (error) {
        console.error(`Error fetching artifact ${artifactId} from primary path`);
        
        // Fallback: Try alternative path structure for backward compatibility
        try {
          
          const alternativePath = `${artifactId}/artifact_description.json`;
          
          const altDescriptionUrl = await enhancedStorage.get(
            alternativePath,
            { 
              level: 'public',
              download: false,
              expires: 3600,
              identityId: idToUse
            }
          );
          
          if (typeof altDescriptionUrl === 'string') {
            const response = await fetch(altDescriptionUrl);
            if (!response.ok) {
              console.error(`Alternative fetch failed with status ${response.status}`);
              return undefined;
            }
            
            const data = await response.json();
            
            // Process the artifact data with same logic as primary path
            let processedData: ArtifactDescription;
            
            if (Array.isArray(data) && data.length > 0) {
              processedData = data[0];
            } else {
              processedData = data;
            }
            
            // Ensure required fields are populated
            if (!processedData.artifactid) {
              processedData.artifactid = artifactId;
            }
            
            if (!processedData.userid) {
              processedData.userid = userId;
            }
            
            // Store identity ID for future reference
            if (!processedData.identityid && !processedData.identityId) {
              processedData.identityid = idToUse;
            }
            
            return processedData;
          }
        } catch (altError) {
          console.error(`Error fetching artifact from alternative path ${artifactId}`);
        }
      }
      
      return undefined;
    } catch (error) {
      console.error(`Error in getArtifactDescriptionFromS3 for artifact ${artifactId}`);
      return undefined;
    }
  };
  
  // Effect to fetch and cache image URLs when artifacts or dependencies change
  useEffect(() => {
    const fetchImageUrls = async () => {
      if (artifacts.length === 0 || !identityId || !rawS3Files || rawS3Files.length === 0) return;
            
      // Create promises to fetch image URLs for all artifacts
      const urlPromises = artifacts.map(async (artifact) => {
        try {
          const artifactId = artifact.artifactid;
          if (!artifactId) {
            console.error("Missing artifactId in artifact");
            return { id: "unknown", url: undefined };
          }
          
          const userId = artifact.userid;
          if (!userId) {
            console.error("Missing userId in artifact");
            return { id: artifactId, url: undefined };
          }
          
          // Determine filename from artifact data or S3 file listing
          let artifactFilename = artifact.filename;
          if (!artifactFilename) {
            const foundFilename = getImageFilename(artifactId);
            if (foundFilename) {
              artifactFilename = foundFilename;
            } else {
              console.error("Could not determine filename for artifact:", artifactId);
              return { id: artifactId, url: undefined };
            }
          }
                    
          // Generate signed URL for the image
          try {
            const imageUrl = await enhancedStorage.get(
              `${userId}/${artifactId}/${artifactFilename}`,
              { 
                level: 'public',
                download: false,
                expires: 3600,
                identityId: identityId
              }
            );
            return { id: artifactId, url: imageUrl };
          } catch (s3Error) {
            console.error(`Error generating URL for artifact ${artifactId}`);
            return { id: artifactId, url: undefined };
          }
        } catch (error) {
          console.error(`Error processing artifact for image URL`);
          const artifactId = artifact?.artifactid || "unknown";
          return { id: artifactId, url: undefined };
        }
      });
      
      // Wait for all URL promises to resolve and create URL mapping
      const results = await Promise.all(urlPromises);
      const urlMap: Record<string, string> = {};
      results.forEach(result => {
        if (result.url && result.id) {
          urlMap[result.id] = result.url as string;
        }
      });
      
      setArtifactImageUrls(urlMap);
    };
    
    fetchImageUrls();
  }, [artifacts, identityId, rawS3Files, useCloudFront]);

  /**
   * Fallback method to manually discover artifacts by scanning S3 structure
   * Used when normal artifact listing methods fail
   */
  const listKnownArtifacts = async (userId: string) => {
    
    try {
      // Perform broad S3 listing to discover artifact structure
      const result = await Storage.list('', { 
        level: 'public',
        pageSize: 900
      });
            
      if (result && result.results && result.results.length > 0) {
        const artifactIdsMap: Record<string, boolean> = {};
        
        // Scan through S3 objects to identify artifacts belonging to this user
        result.results.forEach(item => {
          const key = item.key || '';
          
          // Look for keys that contain the user ID
          if (key.includes(`/${userId}/`) || key.startsWith(`${userId}/`)) {
            const parts = key.split('/');
            const userIdIndex = parts.findIndex(part => part === userId);
            
            if (userIdIndex >= 0 && userIdIndex + 1 < parts.length) {
              // Extract artifact ID from path structure
              const artifactId = parts[userIdIndex + 1];
              
              if (artifactId && !artifactIdsMap[artifactId]) {
                artifactIdsMap[artifactId] = true;
              }
            }
          }
        });
        
        // Fetch descriptions for discovered artifacts
        const artifactIds = Object.keys(artifactIdsMap);
        
        if (artifactIds.length > 0) {
          const artifactPromises = artifactIds.map(artifactId => 
            getArtifactDescriptionFromS3(userId, artifactId)
          );
          
          const artifactDescriptions = await Promise.all(artifactPromises);
          return artifactDescriptions.filter(Boolean) as ArtifactDescription[];
        }
      }
      
      return [];
    } catch (error) {
      console.error("Error during S3 scan");
      return [];
    }
  };

  /**
   * Main function to fetch all artifacts for the current user
   * Tries multiple strategies to ensure artifact discovery
   */
  const fetchArtifacts = async () => {
    if (!identityId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const userInfo = await Auth.currentAuthenticatedUser();
      const userId = userInfo.username;
            
      // Primary method: List artifacts using standard S3 path structure
      const pathToTry = `${userId}/`;
            
      try {
        const result = await Storage.list(pathToTry, { 
          level: 'public',
          pageSize: 900
        });
                
        if (result && result.results && result.results.length > 0) {
          setRawS3Files(result.results);
          
          const artifactIdsMap: Record<string, boolean> = {};
          
          // Primary strategy: Look for artifact_description.json files
          for (const item of result.results) {
            const key = item.key || '';
            
            if (key.endsWith('/artifact_description.json')) {
              // Extract artifact ID from description file path
              const parts = key.split('/');
              
              if (parts.length >= 3) {
                const artifactId = parts[parts.length - 2];
                
                if (artifactId && !artifactIdsMap[artifactId]) {
                  artifactIdsMap[artifactId] = true;
                }
              }
            }
          }
          
          // Fallback strategy: Analyze path structure if no description files found
          if (Object.keys(artifactIdsMap).length === 0) {
            
            for (const item of result.results) {
              const key = item.key || '';
              const parts = key.split('/');
              
              // Look for userId/artifactId/file pattern
              if (parts.length >= 3) {
                const artifactId = parts[1];
                
                if (artifactId && !artifactIdsMap[artifactId]) {
                  artifactIdsMap[artifactId] = true;
                }
              }
            }
          }
          
          const artifactIds = Object.keys(artifactIdsMap);
          
          if (artifactIds.length > 0) {
            // Fetch detailed information for each discovered artifact
            const artifactPromises = artifactIds.map(artifactId => 
              getArtifactDescriptionFromS3(userId, artifactId)
            );
            
            const artifactDescriptions = await Promise.all(artifactPromises);
            const artifacts = artifactDescriptions.filter(Boolean) as ArtifactDescription[];
            
            setArtifacts(artifacts);
            return;
          }
        }
      } catch (error) {
        console.error(`Error listing with standard path`);
      }
      
      // Last resort: Manual S3 scanning
      const manualArtifacts = await listKnownArtifacts(userId);
      setArtifacts(manualArtifacts);
      
    } catch (error) {
      console.error('Error fetching artifacts');
      setError(t('errorFetchingGallery') || 'Error fetching gallery');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles clicking on an artifact card
   * Loads artifact details and stories, then navigates to main view
   */
  const handleArtifactClick = async (artifact: ArtifactDescription) => {
    if (!identityId) return;
    
    try {
      // Use artifact's stored identity ID or fall back to current session
      const artifactIdentityId = artifact.identityid || artifact.identityId || identityId;
            
      // Fetch associated stories for the artifact
      let stories: Story[] = [];
      
      try {
        const storiesPath = `${artifact.userid}/${artifact.artifactid}/artifact_stories.json`;
        
        const storiesUrl = await enhancedStorage.get(
          storiesPath,
          { 
            level: 'public',
            download: false,
            expires: 3600,
            identityId: artifactIdentityId
          }
        );
        
        if (typeof storiesUrl === 'string') {
          const response = await fetch(storiesUrl);
          if (response.ok) {
            stories = await response.json();
          } else {
            console.error(`Error fetching stories: HTTP ${response.status}`);
          }
        }
      } catch (error) {
        console.error(`Error fetching stories for artifact`);
      }
      
      // Store artifact and story data in session storage for navigation
      const artifactToStore = {
        ...artifact,
        identityid: artifactIdentityId,
        identityId: artifactIdentityId
      };
      
      sessionStorage.setItem('selectedArtifact', JSON.stringify(artifactToStore));
      sessionStorage.setItem('selectedStories', JSON.stringify(stories));
      sessionStorage.setItem('identityId', artifactIdentityId);
      
      // Navigate to main artifact view
      navigate('/');
    } catch (error) {
      console.error('Error loading artifact details');
    }
  };

  // Render the gallery page
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">{t('gallery') || 'Gallery'}</h1>
      
      {artifacts.length === 0 ? (
        // Empty state: Show loading, error, or no artifacts message
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow text-center">
          {isLoading ? (
            // Loading spinner
            <div className="flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 mr-3 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>{t('loading') || 'Loading...'}</span>
            </div>
          ) : error ? (
            // Error state with retry button
            <div>
              <p className="text-red-500 mb-4">{error}</p>
              <button 
                onClick={() => fetchArtifacts()}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center mx-auto"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('tryAgain') || 'Try Again'}
              </button>
            </div>
          ) : (
            // No artifacts found state
            <div>
              <p>{t('noArtifactsFound') || 'No artifacts found. Upload your first artifact to begin.'}</p>
              <button 
                onClick={() => navigate('/')}
                className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center mx-auto"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('uploadNewArtifact') || 'Upload New Artifact'}
              </button>
            </div>
          )}
        </div>
      ) : (
        // Grid layout for artifact cards
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {artifacts.map((artifact, index) => (
            <div 
              key={index} 
              className="bg-white dark:bg-gray-800 p-4 rounded shadow cursor-pointer hover:shadow-lg transition-shadow relative"
              onClick={() => handleArtifactClick(artifact)}
            >
              {/* Artifact image section */}
              <div className="aspect-w-16 aspect-h-9 mb-4">
                {artifactImageUrls[artifact.artifactid] ? (
                  <img 
                    src={artifactImageUrls[artifact.artifactid]}
                    alt={artifact.title || 'Artifact image'}
                    className="object-cover rounded w-full h-48"
                  />
                ) : (
                  // Placeholder for missing images
                  <div className="flex items-center justify-center h-48 bg-gray-200 dark:bg-gray-700 rounded">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="ml-2 text-gray-500">
                      {artifact.filename ? 'Loading image...' : 'No image available'}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Artifact metadata */}
              <h3 className="font-semibold text-lg mb-1">{artifact.title || 'Untitled Artifact'}</h3>
              {artifact.processed_timestamp && (
                <div className="text-xs text-gray-500 mb-2">
                  {new Date(artifact.processed_timestamp * 1000).toLocaleString()}
                </div>
              )}
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">
                {artifact.description || 'No description available'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GalleryPage;