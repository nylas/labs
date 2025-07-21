import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { MessageSquare, Key, User, LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

interface NavigationProps {
  activeTab: 'chat' | 'api-keys' | 'profile';
  onTabChange: (tab: 'chat' | 'api-keys' | 'profile') => void;
}

export function Navigation({ activeTab, onTabChange }: NavigationProps) {
  const { user, isAuthenticated, logout } = useAuth();

  const handleLogin = () => {
    window.location.href = '/api/auth/connect/redirect';
  };

  return (
    <nav className="bg-background/80 backdrop-blur-md border-b border-border/50 px-6 py-4 flex items-center justify-between transition-colors duration-200" role="navigation" aria-label="Main navigation">
      <div className="flex items-center space-x-3">
        <div className="w-7 h-7 bg-gradient-nylas rounded-md flex items-center justify-center shadow-sm" aria-hidden="true">
          <span className="text-white text-xs font-bold">🔑</span>
        </div>
        <h1 className="font-medium text-foreground tracking-tight">Nylas MCP</h1>
      </div>

      <div className="flex items-center space-x-2" role="tablist" aria-label="Main sections">
        <Button
          variant={activeTab === 'chat' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onTabChange('chat')}
          className="flex items-center space-x-2 h-8 px-3"
          role="tab"
          aria-selected={activeTab === 'chat'}
          aria-controls="chat-panel"
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-sm">Chat</span>
        </Button>

        {isAuthenticated && (
          <>
            <Button
              variant={activeTab === 'api-keys' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onTabChange('api-keys')}
              className="flex items-center space-x-2 h-8 px-3"
              role="tab"
              aria-selected={activeTab === 'api-keys'}
              aria-controls="api-keys-panel"
            >
              <Key className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-sm">API Keys</span>
            </Button>

            <Button
              variant={activeTab === 'profile' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onTabChange('profile')}
              className="flex items-center space-x-2 h-8 px-3"
              role="tab"
              aria-selected={activeTab === 'profile'}
              aria-controls="profile-panel"
            >
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-sm">Profile</span>
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center space-x-3">
        <ThemeToggle />
        
        {isAuthenticated && user ? (
          <div className="flex items-center space-x-3" role="region" aria-label="User account">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-foreground">{user.email}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.provider}</p>
            </div>
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs" aria-label={`Avatar for ${user.email}`}>
                {user.email.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="text-muted-foreground hover:text-foreground h-8 px-2"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Sign out</span>
            </Button>
          </div>
        ) : (
          <Button 
            onClick={handleLogin}
            className="bg-primary hover:bg-primary/90 h-8 px-4 text-sm"
            aria-label="Connect your calendar to get started"
          >
            Connect Calendar
          </Button>
        )}
      </div>
    </nav>
  );
} 