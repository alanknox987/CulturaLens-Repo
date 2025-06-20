import { Storage } from 'aws-amplify';
import { getCloudFrontUrl, checkFileExists } from './cloudfront';

/**
 * Enhanced Storage utility that automatically uses CloudFront when available
 * Provides transparent fallback to S3 when CloudFront is unavailable or fails
 * Configured to use public storage level instead of private for broader access
 */
class EnhancedStorage {
  private useCloudFront: boolean;
  private debugMode: boolean;

  constructor() {
    // Determine CloudFront availability from environment configuration
    this.useCloudFront = !!process.env.REACT_APP_S3_URL;
    this.debugMode = false; // Set to false in production for security
    
  }

  /**
   * Retrieves a file from storage using CloudFront when available, with S3 fallback
   * 
   * @param key The S3 object key (path) to retrieve
   * @param options Storage options including download preference, expiry, etc.
   * @returns Promise resolving to URL string or object based on options
   */
  async get(key: string, options?: any): Promise<string | object> {
    // Parse the key to extract path components
    const parts = key.split('/');
        
    // For standard path structure: "userId/artifactId/filename"
    if (parts.length >= 3 && this.useCloudFront) {
      const userId = parts[0];
      const artifactId = parts[1];
      const filename = parts.slice(2).join('/'); // Handle nested paths correctly
            
      // Try CloudFront for non-download requests
      if (!options?.download) {
        let cloudFrontUrl;
        
        try {
          // Generate CloudFront URL with public storage structure
          cloudFrontUrl = getCloudFrontUrl(
            userId, 
            artifactId, 
            filename,
            undefined, // No identityId needed for public storage
            {
              expiry: Math.floor(Date.now() / 1000) + 3600 // 1 hour expiry
            }
          );
                    
          // Determine file type for appropriate handling
          const fileExtension = key.split('.').pop()?.toLowerCase();
          const isBinaryFile = fileExtension === 'mp3' || fileExtension === 'wav' || fileExtension === 'ogg';
          
          // Test CloudFront URL accessibility
          let testResponse;
          try {
            testResponse = await fetch(cloudFrontUrl, {
              method: 'HEAD',
              mode: 'cors',
              cache: 'no-store' // Prevent cached responses during testing
            });
            
            if (testResponse.ok) {              
              // Verify content type for binary files
              if (isBinaryFile) {
                const contentType = testResponse.headers.get('content-type');
                
                // Additional validation for audio files
                if (fileExtension === 'mp3' && contentType && 
                    (contentType.includes('audio') || contentType.includes('octet-stream'))) {
                  console.log(`Audio file content type validated`);
                }
              }
              
              return cloudFrontUrl;
            } else {
              console.warn(`CloudFront access failed with HTTP status ${testResponse.status}`);
              
              // Log diagnostic information in debug mode only
              if (this.debugMode) {
                try {
                  const cfUrlObj = new URL(cloudFrontUrl);
                } catch (e) {
                  console.error(`Failed to parse CloudFront URL structure`);
                }
              }
              
            }
          } catch (fetchError) {
            console.warn(`Error testing CloudFront accessibility: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
          }
        } catch (error) {
          console.warn(`Error preparing CloudFront access: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Fallback to direct S3 access when CloudFront fails
        try {          
          // Configure options for public storage level
          const s3Options = {
            ...options,
            level: 'public', // Use public storage level for broader access
          };
          
          // Remove identityId since it's not needed for public storage
          if (s3Options.identityId) {
            delete s3Options.identityId;
          }
          
          const result = await Storage.get(key, s3Options);
          
          if (typeof result === 'string') {            
            // Compare URLs in debug mode without exposing sensitive data
            if (this.debugMode && cloudFrontUrl) {
              this.compareUrlStructures(cloudFrontUrl, result as string);
            }
          } else {
            console.log(`File fallback successful - binary data retrieved`);
          }
          
          return result;
        } catch (s3Error) {
          console.error(`S3 fallback failed: ${s3Error instanceof Error ? s3Error.message : 'Unknown error'}`);
          throw s3Error;
        }
      } else if (options?.download) {
        // Handle file download requests through CloudFront
        try {
          const cloudFrontUrl = getCloudFrontUrl(
            userId, 
            artifactId, 
            filename,
            undefined, // No identityId needed for public storage
            {
              expiry: Math.floor(Date.now() / 1000) + 3600 // 1 hour expiry
            }
          );
                    
          try {
            const response = await fetch(cloudFrontUrl);
            
            if (response.ok) {
              // Return blob with structure compatible with Amplify Storage
              const blob = await response.blob();
              return { Body: blob };
            } else {
              console.warn(`CloudFront download failed with status ${response.status}, using S3 fallback`);
            }
          } catch (downloadError) {
            console.warn(`CloudFront download error: ${downloadError instanceof Error ? downloadError.message : 'Unknown error'}, using S3 fallback`);
          }
        } catch (error) {
          console.warn(`CloudFront download preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}, using S3 fallback`);
        }
      }
    }
        
    try {
      // Configure for public storage level
      const s3Options = {
        ...options,
        level: 'public', // Use public storage level
      };
      
      // Remove identityId since it's not needed for public storage
      if (s3Options.identityId) {
        delete s3Options.identityId;
      }
      
      const result = await Storage.get(key, s3Options);
      
      // Log basic result information in debug mode
      if (this.debugMode && typeof result === 'string') {
        console.log(`Generated file URL - length: ${result.length} characters`);
      }
      
      return result;
    } catch (s3Error) {
      console.error(`File access failed: ${s3Error instanceof Error ? s3Error.message : 'Unknown error'}`);
      throw s3Error;
    }
  }

  /**
   * Compares URL structures for debugging purposes without exposing sensitive data
   * Only logs structural information, not actual URLs or sensitive parameters
   * 
   * @param cloudFrontUrl The CloudFront URL to analyze
   * @param s3Url The S3 URL to compare against
   */
  private compareUrlStructures(cloudFrontUrl: string, s3Url: string): void {
    try {
      const cfUrl = new URL(cloudFrontUrl);
      const s3UrlObj = new URL(s3Url);
            
      // Analyze path structure without exposing actual paths
      const cfPathNormalized = cfUrl.pathname.replace(/^\/public\//, '/');
      const s3PathNormalized = s3UrlObj.pathname.replace(/^\/public\//, '/');
            
      // Analyze /public/ prefix handling
      const cfPublicPath = cfUrl.pathname.startsWith('/public/');
      const s3PublicPath = s3UrlObj.pathname.includes('/public/');
      
    } catch (e) {
      console.error("Error during URL structure comparison:", e instanceof Error ? e.message : 'Unknown error');
    }
  }
  
  /**
   * Lists files in storage directory
   * Configured for public storage level with proper option handling
   * 
   * @param path The directory path to list
   * @param options Additional listing options
   * @returns Promise resolving to list of files
   */
  async list(path: string, options?: any): Promise<any> {
    // Configure options for public storage level
    const listOptions = {
      ...options,
      level: 'public', // Use public storage level
    };
    
    // Remove identityId since it's not needed for public storage
    if (listOptions.identityId) {
      delete listOptions.identityId;
    }
        
    try {
      const result = await Storage.list(path, listOptions);
      return result;
    } catch (error) {
      console.error(`File listing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Uploads a file to storage
   * Configured for public storage level to ensure proper access permissions
   * 
   * @param key The S3 key (path) where the file will be stored
   * @param data The file data to upload
   * @param options Upload options including content type, metadata, etc.
   * @returns Promise resolving to upload result
   */
  async put(key: string, data: any, options?: any): Promise<any> {
    // Configure options for public storage level
    const putOptions = {
      ...options,
      level: 'public', // Use public storage level
    };
    
    // Remove identityId since it's not needed for public storage
    if (putOptions.identityId) {
      delete putOptions.identityId;
    }
        
    try {
      const result = await Storage.put(key, data, putOptions);
      return result;
    } catch (error) {
      console.error(`File upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Removes a file from storage
   * Configured for public storage level with proper error handling
   * 
   * @param key The S3 key (path) of the file to remove
   * @param options Removal options
   * @returns Promise resolving to removal result
   */
  async remove(key: string, options?: any): Promise<any> {
    // Configure options for public storage level
    const removeOptions = {
      ...options,
      level: 'public', // Use public storage level
    };
    
    // Remove identityId since it's not needed for public storage
    if (removeOptions.identityId) {
      delete removeOptions.identityId;
    }
        
    try {
      const result = await Storage.remove(key, removeOptions);
      return result;
    } catch (error) {
      console.error(`File removal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
}

// Export a singleton instance for consistent usage across the application
export const enhancedStorage = new EnhancedStorage();

// Default export for easier migration from standard AWS Amplify Storage
// Allows replacing imports of 'aws-amplify' Storage with this enhanced module
export default enhancedStorage;