// src/utils/cognito-auth.ts
import { Auth } from 'aws-amplify';

/**
 * Enhanced authentication functions with additional security features
 */

// Check session validity and refresh if needed
export const checkSessionValidity = async (): Promise<boolean> => {
  try {
    const session = await Auth.currentSession();
    // Check if token is close to expiration (within 10 minutes)
    const expirationTime = session.getAccessToken().getExpiration() * 1000;
    const currentTime = Date.now();
    const timeToExpiration = expirationTime - currentTime;
    
    // If less than 10 minutes to expiration, refresh token
    if (timeToExpiration < 600000) {
      await Auth.currentAuthenticatedUser();
    }
    
    return true;
  } catch (error) {
    return false;
  }
};

// Password strength validator
export const validatePasswordStrength = (password: string): boolean => {
  // At least 8 characters, with uppercase, lowercase, number, and special character
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return strongPasswordRegex.test(password);
};

// Complete force change password challenge
export const completeNewPasswordChallenge = async (user: any, newPassword: string, requiredAttributes = {}): Promise<any> => {
  try {
    const result = await Auth.completeNewPassword(
      user,
      newPassword,
      requiredAttributes
    );
    return result;
  } catch (error) {
    throw error;
  }
};