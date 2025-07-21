import useSWR from 'swr';
import { useAuth } from './useAuth';

interface ApiKey {
  kid: string;
  name?: string;
  expires_at?: string;
}

interface ApiKeysResponse {
  keys: ApiKey[];
}

interface CreateKeyRequest {
  name?: string;
  ttl_days?: number;
  forever?: boolean;
}

interface CreateKeyResponse {
  api_key: string;
  kid: string;
  expires_at?: string;
}

const fetcher = async (url: string): Promise<ApiKeysResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch API keys');
  }
  return res.json();
};

export function useApiKeys() {
  const { user, isAuthenticated } = useAuth();
  
  const { data, error, isLoading, mutate } = useSWR<ApiKeysResponse>(
    isAuthenticated && user ? `/api/grants/keys` : null,
    fetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    }
  );

  const createKey = async (request: CreateKeyRequest): Promise<CreateKeyResponse> => {
    if (!user) throw new Error('User not authenticated');

    const res = await fetch(`/api/grants/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to create API key');
    }

    const result = await res.json();
    mutate(); // Refresh the keys list
    return result;
  };

  const deleteKey = async (kid: string): Promise<void> => {
    const res = await fetch(`/api/grants/keys/${kid}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to delete API key');
    }

    mutate(); // Refresh the keys list
  };

  return {
    keys: data?.keys || [],
    isLoading,
    error,
    createKey,
    deleteKey,
    mutate
  };
} 