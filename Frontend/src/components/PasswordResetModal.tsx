import React, { useEffect, useState } from 'react';
import { Auth } from 'aws-amplify';
import { useTranslation } from 'react-i18next';
import { validatePasswordStrength } from '../security/cognito-auth';

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPasswordChanged: () => void;
  username: string;
}

const PasswordResetModal: React.FC<PasswordResetModalProps> = ({
  isOpen,
  onClose,
  onPasswordChanged,
  username
}) => {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setPasswordError(null);
    }
  }, [isOpen]);

  const validatePassword = () => {
    // Check if passwords match
    if (newPassword !== confirmPassword) {
      setPasswordError(t('passwordsMustMatch') || 'Passwords must match');
      return false;
    }

    // Check password strength
    if (!validatePasswordStrength(newPassword)) {
      setPasswordError(t('passwordSecurityRequirements') || 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.');
      return false;
    }

    setPasswordError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validatePassword()) {
      return;
    }

    setIsLoading(true);

    try {
      // First sign in with current credentials
      const user = await Auth.signIn(username, currentPassword);

      // Check if we get a successful sign-in
      if (user) {
        // Change password
        await Auth.changePassword(user, currentPassword, newPassword);
        setIsLoading(false);
        onPasswordChanged();
      }
    } catch (error) {
      console.error('Error changing password:', error);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(t('passwordChangeError') || 'Error changing password');
      }
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-semibold mb-4 text-center">
          {t('changePassword') || 'Change Password'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="current-password" className="block text-sm font-medium mb-1">
              {t('currentPassword') || 'Current Password'}
            </label>
            <input
              type="password"
              id="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              required
            />
          </div>

          <div className="mb-4">
            <label htmlFor="new-password" className="block text-sm font-medium mb-1">
              {t('newPassword') || 'New Password'}
            </label>
            <input
              type="password"
              id="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              required
            />
          </div>

          <div className="mb-4">
            <label htmlFor="confirm-password" className="block text-sm font-medium mb-1">
              {t('confirmNewPassword') || 'Confirm New Password'}
            </label>
            <input
              type="password"
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-2 border rounded focus:ring focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              required
            />
          </div>

          {passwordError && (
            <div className="mb-4 text-red-500 text-sm">{passwordError}</div>
          )}

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
};

export default PasswordResetModal;