// src/components/Navbar.tsx
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Auth } from 'aws-amplify';
import { useTranslation } from 'react-i18next';
import { useUserPreferences } from '../contexts/UserPreferencesContext';

interface NavbarProps {
  isAuthenticated: boolean;
  setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
  openPreferences: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ isAuthenticated, setIsAuthenticated, openPreferences }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme } = useUserPreferences();

  const handleLogout = async () => {
    try {
      await Auth.signOut();
      setIsAuthenticated(false);
      navigate('/auth');
    } catch (error) {
      console.error('Error signing out: ', error);
    }
  };

  return (
    <nav className="bg-blue-600 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <Link to="/" className="flex items-center">
          {/* Icon + Logo for desktop */}
          <div className="hidden md:flex items-center">
            <img 
              src="/assets/CulturaLens-icon.png" 
              alt="" 
              className="h-10 w-10 mr-2" 
            />
            <img 
              src="/assets/CulturaLens-logo.png" 
              alt="CulturaLens" 
              className="h-8" 
            />
          </div>
          {/* Icon only for mobile */}
          <img 
            src="/assets/CulturaLens-icon.png" 
            alt="CulturaLens" 
            className="block md:hidden h-8 w-8" 
          />
        </Link>        
        <div className="flex space-x-4 md:space-x-6">
          {isAuthenticated ? (
            <>
              <Link to="/" className="hover:text-gray-200 flex flex-col items-center" title={t('home') || ''}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span className="hidden md:block text-xs mt-1">{t('home') || ''}</span>
              </Link>
              <Link to="/gallery" className="hover:text-gray-200 flex flex-col items-center" title={t('gallery') || ''}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="hidden md:block text-xs mt-1">{t('gallery') || ''}</span>
              </Link>
              <button 
                onClick={openPreferences}
                className="hover:text-gray-200 flex flex-col items-center bg-transparent border-0"
                title={t('preferences') || ''}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden md:block text-xs mt-1">{t('preferences') || ''}</span>
              </button>
              <button 
                onClick={handleLogout}
                className="hover:text-gray-200 flex flex-col items-center bg-transparent border-0"
                title={t('logout') || ''}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden md:block text-xs mt-1">{t('logout') || ''}</span>
              </button>
            </>
          ) : (
            <Link to="/auth" className="hover:text-gray-200 flex flex-col items-center" title={t('login') || ''}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              <span className="hidden md:block text-xs mt-1">{t('login') || ''}</span>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;