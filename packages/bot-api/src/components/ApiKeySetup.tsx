import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, AlertCircle } from 'lucide-react';

interface ApiKeySetupProps {
  onApiKeySave: (apiKey: string) => void;
}

export function ApiKeySetup({ onApiKeySave }: ApiKeySetupProps) {
  const [inputValue, setInputValue] = useState('');

  const handleSave = () => {
    if (inputValue.trim()) {
      onApiKeySave(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border p-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-nylas rounded-lg flex items-center justify-center">
            <Key className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">API Key Required</h2>
            <p className="text-sm text-muted-foreground">
              Enter your API key to start chatting with your calendar
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-nylas-primary mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">Calendar API Key Required</h3>
            <p className="text-muted-foreground mb-6">
              To chat with your calendar, you need an API key. This key will be stored locally in your browser.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                API Key
              </label>
              <Input
                type="password"
                placeholder="Enter your API key..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full"
                autoFocus
              />
            </div>

            <Button
              onClick={handleSave}
              className="w-full bg-nylas-primary hover:bg-nylas-secondary"
              disabled={!inputValue.trim()}
            >
              Save API Key
            </Button>

            <div className="bg-muted p-4 rounded-lg">
              <h4 className="font-medium mb-2">How to get an API key:</h4>
              <ol className="text-sm text-muted-foreground space-y-1">
                <li>1. Click &quot;API Keys&quot; in the navigation above</li>
                <li>2. Create a new API key</li>
                <li>3. Copy the generated key</li>
                <li>4. Paste it here and click &quot;Save API Key&quot;</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 