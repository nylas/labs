'use client';

import { useState } from 'react';
import { SWRConfig } from 'swr';
import { Navigation } from '@/components/Navigation';
import { ChatInterface } from '@/components/ChatInterface';
import { ApiKeysModal } from '@/components/ApiKeysModal';
import { ProfileView } from '@/components/ProfileView';
import { useAuth } from '@/hooks/useAuth';

// SWR global configuration
const swrConfig = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 30000,
};

function AppContent() {
  const [activeTab, setActiveTab] = useState<'chat' | 'api-keys' | 'profile'>('chat');
  const [showApiKeysModal, setShowApiKeysModal] = useState(false);
  const { isLoading } = useAuth();

  // Handle tab changes - open modal for API keys
  const handleTabChange = (tab: 'chat' | 'api-keys' | 'profile') => {
    if (tab === 'api-keys') {
      setShowApiKeysModal(true);
    } else {
      setActiveTab(tab);
    }
  };

  // Handle when an API key is set for chat - switch to chat tab
  const handleApiKeySetForChat = () => {
    setActiveTab('chat');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Loading application">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" aria-hidden="true"></div>
          <p className="text-muted-foreground">Loading application...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background transition-colors duration-200">
      <a 
        href="#main-content" 
        className="skip-link"
        onFocus={(e) => e.target.scrollIntoView()}
      >
        Skip to main content
      </a>
      
      <Navigation activeTab={activeTab} onTabChange={handleTabChange} />
      
      <main 
        id="main-content" 
        className="flex-1 overflow-hidden" 
        role="main" 
        aria-label="Main content area"
        tabIndex={-1}
      >
        {activeTab === 'chat' && (
          <section aria-label="Chat interface" id="chat-panel" role="tabpanel">
            <ChatInterface />
          </section>
        )}
        {activeTab === 'profile' && (
          <section aria-label="User profile" id="profile-panel" role="tabpanel">
            <ProfileView />
          </section>
        )}
      </main>

      <ApiKeysModal 
        open={showApiKeysModal} 
        onClose={() => setShowApiKeysModal(false)}
        onApiKeySetForChat={handleApiKeySetForChat}
      />
    </div>
  );
}

export default function Home() {
  return (
    <SWRConfig value={swrConfig}>
      <AppContent />
    </SWRConfig>
  );
}
