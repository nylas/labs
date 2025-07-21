import { useChat } from '@ai-sdk/react';
import { useAuth } from '@/hooks/useAuth';
import { useApiKey } from '@/hooks/useApiKey';
import { ApiKeySetup } from './ApiKeySetup';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';

export function ChatInterface() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { apiKey, showApiKeyInput, saveApiKey, clearApiKey } = useApiKey();

  const { 
    messages, 
    input, 
    handleInputChange, 
    handleSubmit, 
    isLoading,
    status,
    error,
    stop,
    setInput
  } = useChat({
    api: '/api/chat',
    body: {
      apiKey: apiKey
    },
    onError: (error) => {
      console.error('Chat error:', error);
      // If it's an API key error, clear the key to prompt re-entry
      if (error.message.includes('API key') || error.message.includes('Unauthorized')) {
        clearApiKey();
      }
      // If it's an authentication error, refresh the auth state
      if (error.message.includes('authentication') || error.message.includes('Access token')) {
        // Force a refresh of the auth state
        window.location.reload();
      }
    },
    // Only start chat if we have an API key
    keepLastMessageOnError: true,
  });

  const handleExampleClick = (question: string) => {
    setInput(question);
    // Auto-focus the input
    const inputElement = document.querySelector('input[name="message"]') as HTMLInputElement;
    if (inputElement) {
      inputElement.focus();
    }
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAuthenticated) {
      return; // Don't submit if not authenticated
    }
    if (!apiKey) {
      clearApiKey(); // This will show the API key setup
      return;
    }
    handleSubmit(e);
  };

  // Show loading state while authentication is being checked
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" aria-hidden="true"></div>
          <p className="text-muted-foreground">Loading chat...</p>
        </div>
      </div>
    );
  }

  // Show authentication required message if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg className="h-12 w-12 text-muted-foreground mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 1.732a8 8 0 1 1 12 0M12 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">
            You need to be signed in with your Google account to use the chat feature.
          </p>
          <a 
            href="/api/auth/connect/redirect"
            className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  // Show API key setup if no key is available
  if (showApiKeyInput || !apiKey) {
    return <ApiKeySetup onApiKeySave={saveApiKey} />;
  }

  return (
    <div className="flex flex-col h-full bg-background transition-colors duration-200" id="chat-panel" role="tabpanel" aria-labelledby="chat-tab">
      <ChatHeader 
        isAuthenticated={isAuthenticated}
        onClearApiKey={clearApiKey}
      />

      <ChatMessages 
        messages={messages}
        isLoading={isLoading}
        onExampleClick={handleExampleClick}
      />

      {error && (
        <div className="px-6 py-3 bg-destructive/5 border-t border-destructive/10" role="alert" aria-live="polite">
          <div className="text-sm text-destructive/90 flex items-center space-x-2">
            <svg className="h-4 w-4 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span>An error occurred. Please try again or check your API key.</span>
          </div>
        </div>
      )}

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={handleInputChange}
        onSubmit={handleFormSubmit}
        onStop={stop}
        status={status}
      />
    </div>
  );
} 