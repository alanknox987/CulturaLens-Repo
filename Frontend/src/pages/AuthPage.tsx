import React, { useState } from 'react';
import { Auth } from 'aws-amplify';
import { useTranslation } from 'react-i18next';

interface AuthPageProps {
  setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
}

const AuthPage: React.FC<AuthPageProps> = ({ setIsAuthenticated }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showConfirmation, setShowConfirmation] = useState<boolean>(false);
  
  // New state for force change password challenge
  const [showForceChangePassword, setShowForceChangePassword] = useState<boolean>(false);
  const [cognitoUser, setCognitoUser] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    
    try {
      // Login logic
      const user = await Auth.signIn(email, password);
      
      // Check if user is being forced to change password
      if (user.challengeName === 'NEW_PASSWORD_REQUIRED') {
        setCognitoUser(user);
        setShowForceChangePassword(true);
      } else {
        // Normal login success
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Auth error:', error);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(t('authError') || 'Authentication error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // New handler for force change password
  const handleForceChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      setError(t('passwordsMustMatch') || 'Passwords must match');
      return;
    }
    
    setError(null);
    setIsLoading(true);
    
    try {
      // Call the completeNewPassword function from Cognito
      await Auth.completeNewPassword(
        cognitoUser,
        password
      );
      
      // After successful password change, set as authenticated
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Force change password error:', error);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(t('passwordChangeError') || 'Error changing password');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError(t('enterEmailForReset') || 'Please enter your email to reset password');
      return;
    }
    
    setIsLoading(true);
    try {
      await Auth.forgotPassword(email);
      setShowConfirmation(true);
      setError(t('resetCodeSent') || 'Reset code has been sent to your email');
    } catch (error) {
      console.error('Forgot password error:', error);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(t('forgotPasswordError') || 'Error requesting password reset');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError(t('passwordsMustMatch') || 'Passwords must match');
      return;
    }
    
    setIsLoading(true);
    try {
      await Auth.forgotPasswordSubmit(email, code, password);
      setError(t('passwordResetSuccess') || 'Password reset successful. Please login.');
      setShowConfirmation(false);
    } catch (error) {
      console.error('Reset password error:', error);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(t('resetPasswordError') || 'Error resetting password');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Show force change password form
  if (showForceChangePassword) {
    return (
      <div className="container mx-auto p-4 flex justify-center items-center min-h-[80vh]">
        <div className="bg-white dark:bg-gray-800 p-6 rounded shadow-md w-full max-w-md">
          <h1 className="text-2xl font-bold mb-6 text-center">
            {t('changeRequiredPassword') || 'Change Required Password'}
          </h1>
          
          <form onSubmit={handleForceChangePassword}>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                {t('email') || 'Email'}
              </label>
              <input
                type="email"
                id="email"
                value={email}
                className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-gray-100"
                disabled
                readOnly
              />
            </div>
            
            <div className="mb-4">
              <label htmlFor="newPassword" className="block text-sm font-medium mb-1">
                {t('newPassword') || 'New Password'}
              </label>
              <input
                type="password"
                id="newPassword"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                required
              />
            </div>
            
            <div className="mb-4">
              <label htmlFor="confirmNewPassword" className="block text-sm font-medium mb-1">
                {t('confirmNewPassword') || 'Confirm New Password'}
              </label>
              <input
                type="password"
                id="confirmNewPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                required
              />
            </div>
            
            {error && (
              <div className="mb-4 text-red-500 text-sm">{error}</div>
            )}
            
            <button
              type="submit"
              className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 mb-4 flex items-center justify-center"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('processing') || 'Processing...'}
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  {t('changePassword') || 'Change Password'}
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 flex justify-center items-center min-h-[80vh]">
      <div className="bg-white dark:bg-gray-800 p-6 rounded shadow-md w-full max-w-md">
        {!showConfirmation ? (
          <>
            <h1 className="text-2xl font-bold mb-6 text-center">
              {t('login') || 'Login'}
            </h1>
            
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="email" className="block text-sm font-medium mb-1">
                  {t('email') || 'Email'}
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label htmlFor="password" className="block text-sm font-medium mb-1">
                  {t('password') || 'Password'}
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  required
                />
              </div>
              
              {error && (
                <div className="mb-4 text-red-500 text-sm">{error}</div>
              )}
              
              <button
                type="submit"
                className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 mb-4 flex items-center justify-center"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('processing') || 'Processing...'}
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                    {t('login') || 'Login'}
                  </>
                )}
              </button>
              
              <div className="text-center mb-4">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-blue-500 hover:underline text-sm flex items-center justify-center mx-auto"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                  {t('forgotPassword') || 'Forgot Password?'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-6 text-center">
              {t('resetPassword') || 'Reset Password'}
            </h1>
            
            <form onSubmit={handleResetPassword}>
              <div className="mb-4">
                <label htmlFor="code" className="block text-sm font-medium mb-1">
                  {t('resetCode') || 'Reset Code'}
                </label>
                <input
                  type="text"
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label htmlFor="newPassword" className="block text-sm font-medium mb-1">
                  {t('newPassword') || 'New Password'}
                </label>
                <input
                  type="password"
                  id="newPassword"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label htmlFor="confirmNewPassword" className="block text-sm font-medium mb-1">
                  {t('confirmNewPassword') || 'Confirm New Password'}
                </label>
                <input
                  type="password"
                  id="confirmNewPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  required
                />
              </div>
              
              {error && (
                <div className="mb-4 text-red-500 text-sm">{error}</div>
              )}
              
              <button
                type="submit"
                className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 mb-4 flex items-center justify-center"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('processing') || 'Processing...'}
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {t('resetPassword') || 'Reset Password'}
                  </>
                )}
              </button>
              
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmation(false);
                    setError(null);
                  }}
                  className="text-blue-500 hover:underline flex items-center justify-center mx-auto"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  {t('goBack') || 'Go Back'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthPage;