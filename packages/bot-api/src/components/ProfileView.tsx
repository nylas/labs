import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { User, Calendar, Globe, LogOut } from 'lucide-react';

export function ProfileView() {
  const { user, logout } = useAuth();

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <User className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No user data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center space-x-4 mb-6">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-nylas-primary text-white text-xl">
              {user.email.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-2xl font-semibold text-foreground">{user.email}</h2>
            <p className="text-muted-foreground capitalize">{user.provider} Account</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <User className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Email</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Provider</p>
                  <p className="text-sm text-muted-foreground capitalize">{user.provider}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Globe className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Timezone</p>
                  <p className="text-sm text-muted-foreground">
                    {user.timezone || 'Not available'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <div className="w-5 h-5 bg-muted rounded-full flex items-center justify-center">
                  <span className="text-xs font-mono">#</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Grant ID</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {user.grant_id}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4 mt-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={logout}
                className="flex items-center space-x-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-muted border border-border rounded-lg p-4">
        <h3 className="font-medium text-foreground mb-2">About Calendar Integration</h3>
        <p className="text-sm text-muted-foreground">
          Your calendar is connected and ready to use with MCP clients. You can create API keys 
          to integrate with Claude Desktop, Cursor, or other MCP-compatible applications.
        </p>
      </div>
    </div>
  );
} 