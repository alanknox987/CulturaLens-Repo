// src/App.tsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Auth, Hub } from 'aws-amplify';
import { useTranslation } from 'react-i18next';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import GalleryPage from './pages/GalleryPage';
import AuthPage from './pages/AuthPage';
import UserPreferencesModal from './components/UserPreferencesModal';
import LoadingScreen from './components/LoadingScreen';
import { UserPreferencesProvider } from './contexts/UserPreferencesContext';
import './i18n';
import { checkSessionValidity } from './security/cognito-auth';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showPreferences, setShowPreferences] = useState<boolean>(false);
  const { i18n } = useTranslation();

  // Check authentication status on load and set up event listeners
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await Auth.currentAuthenticatedUser();
        
        // Check credentials to see if they're being properly obtained
        const credentials = await Auth.currentCredentials();
        
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Authentication check failed:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };
    
    checkAuth();
    
    // Listen for auth events
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      const { event } = payload;
      
      if (event === 'signIn') {
        setIsAuthenticated(true);
      } else if (event === 'signOut') {
        setIsAuthenticated(false);
      } else if (event === 'tokenRefresh_failure') {
        // Handle refresh token failure - user may need to re-authenticate
        checkSessionValidity()
          .then((isValid: boolean) => {
            if (!isValid) {
              setIsAuthenticated(false);
            }
          });
      }
    });
    
    // Perform periodic session validity checks
    const sessionCheckInterval = setInterval(() => {
      checkSessionValidity()
        .then((isValid: boolean) => {
          if (!isValid) {
            setIsAuthenticated(false);
          }
        });
    }, 5 * 60 * 1000); // Check every 5 minutes
    
    return () => {
      unsubscribe();
      clearInterval(sessionCheckInterval);
    };
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <UserPreferencesProvider>
      <Router>
        <div className="min-h-screen flex flex-col">
          <Navbar 
            isAuthenticated={isAuthenticated} 
            setIsAuthenticated={setIsAuthenticated}
            openPreferences={() => setShowPreferences(true)}
          />
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={isAuthenticated ? <HomePage /> : <Navigate to="/auth" />} />
              <Route path="/gallery" element={isAuthenticated ? <GalleryPage /> : <Navigate to="/auth" />} />
              <Route path="/auth" element={!isAuthenticated ? <AuthPage setIsAuthenticated={setIsAuthenticated} /> : <Navigate to="/" />} />
            </Routes>
          </main>
          {showPreferences && (
            <UserPreferencesModal onClose={() => setShowPreferences(false)} />
          )}
        </div>
      </Router>
    </UserPreferencesProvider>
  );
};

export default App;