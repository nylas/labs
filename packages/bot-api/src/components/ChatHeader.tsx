import { Button } from '@/components/ui/button';
import { Calendar, Key } from 'lucide-react';

interface ChatHeaderProps {
  isAuthenticated: boolean;
  onClearApiKey: () => void;
}

export function ChatHeader({ isAuthenticated, onClearApiKey }: ChatHeaderProps) {
  return (
    <div className="border-b border-border/50 px-6 py-5 bg-background/80 backdrop-blur-sm transition-colors duration-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-9 h-9 bg-gradient-nylas rounded-lg flex items-center justify-center shadow-sm">
            <Calendar className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-foreground tracking-tight">Calendar Assistant</h2>
            <p className="text-sm text-muted-foreground">
              {isAuthenticated 
                ? "Ask me about your calendar, schedule meetings, or check availability"
                : "Connect your calendar to start chatting"
              }
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearApiKey}
          title="Change API Key"
          className="h-8 w-8 p-0 hover:bg-muted/50"
        >
          <Key className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
} 