'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface CallbackData {
  grant_id: string;
  api_key: string;
  org_id: string;
  provider: string;
}

interface CallbackResponse {
  success: boolean;
  data?: CallbackData;
  error?: {
    code: string;
    message: string;
  };
}

function AuthCallbackContent() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');

      if (!code || !state) {
        setError('Missing authorization parameters');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/auth/callback?code=${code}&state=${state}`);
        const result: CallbackResponse = await response.json();

        if (result.success && result.data) {
          // Successful authentication - redirect to main app
          window.location.href = '/';
        } else {
          setError(result.error?.message || 'Authentication failed');
        }
      } catch {
        setError('Failed to complete authentication');
      } finally {
        setLoading(false);
      }
    };

    handleCallback();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-6" role="status" aria-live="polite">
        <div className="bg-card rounded-xl shadow-lg border border-border p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" aria-hidden="true"></div>
          <p className="text-muted-foreground">Connecting your calendar...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-destructive/10 to-destructive/20 flex items-center justify-center p-5" role="alert" aria-live="assertive">
        <div className="bg-card rounded-2xl shadow-xl p-12 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-destructive rounded-full flex items-center justify-center mx-auto mb-6" aria-hidden="true">
            <svg className="w-10 h-10 text-destructive-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-4">Connection Failed</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <button 
            onClick={() => window.location.href = '/'}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground px-6 py-3 rounded-lg font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2"
            aria-label="Return to main application"
          >
            Return to App
          </button>
        </div>
      </div>
    );
  }

  // Success state - redirect happening
  return (
    <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-6" role="status" aria-live="polite">
      <div className="bg-card rounded-xl shadow-lg border border-border p-8 text-center">
        <div className="w-16 h-16 bg-green-600 rounded-xl flex items-center justify-center mx-auto mb-6 shadow-sm" aria-hidden="true">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-3">Calendar Connected!</h1>
        <p className="text-muted-foreground mb-4">
          Redirecting you back to the app...
        </p>
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto" aria-hidden="true"></div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-nylas flex items-center justify-center p-5" role="status" aria-live="polite">
        <div className="bg-card rounded-2xl shadow-xl p-12 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4" aria-hidden="true"></div>
          <p className="text-muted-foreground">Loading authentication...</p>
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
} 