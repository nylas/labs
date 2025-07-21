import { useState, useEffect } from 'react';

export function useApiKey() {
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  // Load API key from localStorage on mount and listen for changes
  useEffect(() => {
    const checkApiKey = () => {
      const storedApiKey = localStorage.getItem('mcp_api_key');
      if (storedApiKey) {
        setApiKey(storedApiKey);
        setShowApiKeyInput(false);
      } else {
        setShowApiKeyInput(true);
      }
    };

    // Initial check
    checkApiKey();

    // Listen for storage changes (including manual dispatch)
    window.addEventListener('storage', checkApiKey);
    
    return () => {
      window.removeEventListener('storage', checkApiKey);
    };
  }, []);

  const saveApiKey = (key: string) => {
    localStorage.setItem('mcp_api_key', key);
    setApiKey(key);
    setShowApiKeyInput(false);
  };

  const clearApiKey = () => {
    localStorage.removeItem('mcp_api_key');
    setApiKey('');
    setShowApiKeyInput(true);
  };

  return {
    apiKey,
    showApiKeyInput,
    saveApiKey,
    clearApiKey,
  };
} 