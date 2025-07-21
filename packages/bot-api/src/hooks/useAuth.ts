import useSWR from 'swr';
import { useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api-client';

interface AuthUser {
  grant_id: string;
  email: string;
  provider: string;
  org_id: string;
  timezone?: string;
}

interface AuthError {
  error: string;
}

interface TokenInfo {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  iat: number;
  exp: number;
  org_id?: string;
}

interface TokenInfoResponse {
  request_id: string;
  data: TokenInfo;
}

const fetcher = async (url: string): Promise<AuthUser> => {
  const res = await apiFetch(url);
  if (!res.ok) {
    const error = await res.json() as AuthError;
    throw new Error(error.error || 'Failed to fetch user data');
  }
  return res.json();
};

// Helper function to get token info
const getTokenInfo = async (): Promise<TokenInfo | null> => {
  try {
    const res = await apiFetch('/api/auth/tokeninfo');
    if (!res.ok) {
      return null;
    }
    const tokenInfoResponse = await res.json() as TokenInfoResponse;
    return tokenInfoResponse.data;
  } catch {
    return null;
  }
};

// Helper function to refresh tokens
const refreshTokens = async (): Promise<boolean> => {
  try {
    const res = await apiFetch('/api/auth/refresh', {
      method: 'POST',
    });
    return res.ok;
  } catch {
    return false;
  }
};

// Check if token is expired or nearing expiry (within 5 minutes)
const shouldRefreshToken = (tokenInfo: TokenInfo | null): boolean => {
  if (!tokenInfo) return false;
  
  const now = Math.floor(Date.now() / 1000);
  const expiryBuffer = 5 * 60; // 5 minutes buffer
  
  return tokenInfo.exp <= (now + expiryBuffer);
};

export function useAuth() {
  const refreshInProgress = useRef(false);
  const lastRefreshTime = useRef(0);
  
  const { data: user, error, isLoading, mutate } = useSWR<AuthUser>(
    '/api/auth/me',
    fetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      refreshInterval: 30000, // Check every 30 seconds
    }
  );

  const isAuthenticated = !error && !!user;

  // Function to check and refresh token if needed
  const checkAndRefreshToken = useCallback(async () => {
    // Prevent multiple simultaneous refresh attempts
    if (refreshInProgress.current) {
      return;
    }

    // Don't refresh too frequently (min 30 seconds between attempts)
    const now = Date.now();
    if (now - lastRefreshTime.current < 30000) {
      return;
    }

    try {
      const tokenInfo = await getTokenInfo();
      
      if (shouldRefreshToken(tokenInfo)) {
        refreshInProgress.current = true;
        lastRefreshTime.current = now;
        
        console.log('Token expired or expiring soon, refreshing...');
        
        const refreshSuccess = await refreshTokens();
        
        if (refreshSuccess) {
          console.log('Token refresh successful');
          // Re-validate the user data after successful refresh
          mutate();
        } else {
          console.error('Token refresh failed');
          // Don't immediately logout, let the next API call handle the error
        }
      }
    } catch (error) {
      console.error('Error checking token expiry:', error);
    } finally {
      refreshInProgress.current = false;
    }
  }, [mutate]);

  // Check token expiry when user data changes or on mount
  useEffect(() => {
    if (isAuthenticated) {
      checkAndRefreshToken();
    }
  }, [isAuthenticated, checkAndRefreshToken]);

  // Set up periodic token checks
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const intervalId = setInterval(() => {
      checkAndRefreshToken();
    }, 60000); // Check every minute

    return () => clearInterval(intervalId);
  }, [isAuthenticated, checkAndRefreshToken]);

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { 
        method: 'POST' 
      });
      mutate(undefined, false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    logout,
    mutate,
    checkAndRefreshToken, // Expose for manual refresh if needed
  };
} 