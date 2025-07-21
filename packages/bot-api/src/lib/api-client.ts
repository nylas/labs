/**
 * Enhanced API client with automatic token refresh
 */

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

// Queue for requests waiting for token refresh
const requestQueue: Array<{
  resolve: (value: Response) => void;
  reject: (error: unknown) => void;
  request: () => Promise<Response>;
}> = [];

// Process the queue of requests after token refresh
const processQueue = async (success: boolean) => {
  const queue = [...requestQueue];
  requestQueue.length = 0; // Clear the queue
  
  for (const { resolve, reject, request } of queue) {
    if (success) {
      try {
        const response = await request();
        resolve(response);
      } catch (error) {
        reject(error);
      }
    } else {
      reject(new Error('Token refresh failed'));
    }
  }
};

// Refresh tokens
const refreshTokens = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
    });
    return response.ok;
  } catch {
    return false;
  }
};

// Enhanced fetch function with automatic token refresh
export const apiFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const makeRequest = () => fetch(input, init);
  
  // Try the original request
  const response = await makeRequest();
  
  // If the request is successful or not a 401, return as-is
  if (response.ok || response.status !== 401) {
    return response;
  }
  
  // If we're already refreshing, queue this request
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      requestQueue.push({
        resolve,
        reject,
        request: makeRequest,
      });
    });
  }
  
  // Start the refresh process
  isRefreshing = true;
  
  try {
    // If there's already a refresh in progress, wait for it
    if (!refreshPromise) {
      refreshPromise = refreshTokens();
    }
    
    const refreshSuccess = await refreshPromise;
    
    // Process the queue
    await processQueue(refreshSuccess);
    
    if (refreshSuccess) {
      // Retry the original request
      return makeRequest();
    } else {
      // If refresh failed, let the app handle the unauthenticated state
      throw new Error('Authentication failed');
    }
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
};

// Helper function for JSON API calls
export const apiCall = async <T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> => {
  const response = await apiFetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
};

// Helper functions for common HTTP methods
export const apiGet = <T = unknown>(url: string): Promise<T> => 
  apiCall<T>(url, { method: 'GET' });

export const apiPost = <T = unknown>(url: string, data?: unknown): Promise<T> => 
  apiCall<T>(url, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });

export const apiPut = <T = unknown>(url: string, data?: unknown): Promise<T> => 
  apiCall<T>(url, {
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  });

export const apiDelete = <T = unknown>(url: string): Promise<T> => 
  apiCall<T>(url, { method: 'DELETE' }); 