/**
 * Utility functions for CloudFront URL generation using public storage
 * Modified to use /public/userId/artifactId/ path structure
 */

/**
 * Converts an S3 path to a CloudFront URL using public storage level
 * 
 * @param userId User ID
 * @param artifactId Artifact ID
 * @param filename Filename
 * @param identityId Optional identity ID (not used in public path structure)
 * @param options Additional options
 * @returns CloudFront URL for the file
 */
export const getCloudFrontUrl = (
  userId: string,
  artifactId: string,
  filename: string,
  identityId?: string,
  options?: { expiry?: number }
): string => {
  const cloudFrontUrl = process.env.REACT_APP_S3_URL;
  
  if (!cloudFrontUrl) {
    console.error('REACT_APP_S3_URL is not defined in environment variables');
    return '';
  }
  
  // Ensure we have the https:// protocol
  const baseUrl = cloudFrontUrl.startsWith('http') 
    ? cloudFrontUrl 
    : `https://${cloudFrontUrl}`;
  
  // Ensure baseUrl ends with a slash
  const formattedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  
  // Build path WITHOUT the /public prefix since Origin Path is set to /public
  let cfPath = `${userId}/${artifactId}/${filename}`;
  
  // Add expiry to URL for cache control
  if (options?.expiry) {
    const expiry = options.expiry;
    cfPath += `?Expires=${expiry}`;
  }
  
  const fullUrl = `${formattedBaseUrl}${cfPath}`;
  
  return fullUrl;
};

/**
 * Check if a file exists in S3 via CloudFront
 * This is a simple HEAD request to check if a file exists
 * 
 * @param cloudFrontUrl The full CloudFront URL to check
 * @returns Promise resolving to true if file exists, false otherwise
 */
export const checkFileExists = async (cloudFrontUrl: string): Promise<boolean> => {
  
  try {
    // Use a HEAD request with mode 'cors' to properly handle CORS
    const response = await fetch(cloudFrontUrl, {
      method: 'HEAD',
      cache: 'no-cache',
      mode: 'cors'
    });
    
    if (response.ok) {
      return true;
    } else {
      console.warn(`File does not exist or cannot be accessed, Status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('Error checking file existence:', error);
    return false;
  }
};