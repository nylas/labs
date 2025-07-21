import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send } from 'lucide-react';

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  status?: 'ready' | 'submitted' | 'streaming' | 'error';
}

export function ChatInput({ 
  input, 
  isLoading, 
  onInputChange, 
  onSubmit, 
  onStop,
  status = 'ready'
}: ChatInputProps) {
  const isDisabled = isLoading || status !== 'ready';
  const showStopButton = status === 'streaming' || status === 'submitted';

  return (
    <div className="border-t border-border/50 px-6 py-4 bg-background/80 backdrop-blur-sm transition-colors duration-200">
      <form onSubmit={onSubmit} className="flex space-x-3 max-w-4xl mx-auto">
        <Input
          name="message"
          value={input}
          onChange={onInputChange}
          placeholder="Ask me about your calendar..."
          className="flex-1 h-11 border-border/50 focus:border-border bg-background/60 rounded-xl px-4 transition-all duration-200"
          disabled={isDisabled}
        />
        {showStopButton && onStop ? (
          <Button 
            type="button"
            variant="outline"
            onClick={onStop}
            className="h-11 px-4 rounded-xl border-border/50 hover:bg-muted/50 transition-all duration-200"
          >
            Stop
          </Button>
        ) : (
          <Button 
            type="submit" 
            disabled={isDisabled || !input.trim()}
            className="h-11 px-4 bg-nylas-primary hover:bg-nylas-secondary rounded-xl shadow-sm hover:shadow-md disabled:opacity-50 transition-all duration-200"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </div>
  );
} 