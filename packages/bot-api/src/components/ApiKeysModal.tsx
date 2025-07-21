import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { useApiKeys } from '@/hooks/useApiKeys';
import { useApiKey } from '@/hooks/useApiKey';
import { useToast } from '@/hooks/useToast';
import { Trash2, Plus, Copy, Key, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';

interface ApiKeysModalProps {
  open: boolean;
  onClose: () => void;
  onApiKeySetForChat?: () => void;
}

export function ApiKeysModal({ open, onClose, onApiKeySetForChat }: ApiKeysModalProps) {
  const { keys, isLoading, createKey, deleteKey } = useApiKeys();
  const { saveApiKey } = useApiKey();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const [showConfiguration, setShowConfiguration] = useState(false);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      toast({
        variant: 'warning',
        title: 'Key name required',
        description: 'Please enter a name for your API key.',
      });
      return;
    }
    
    setIsCreating(true);
    try {
      const result = await createKey({
        name: newKeyName,
        ttl_days: 90
      });
      setCreatedKey(result.api_key);
      setNewKeyName('');
      
      toast({
        variant: 'success',
        title: 'API Key Created',
        description: `Successfully created API key "${newKeyName}". Make sure to copy it now!`,
      });
    } catch (error) {
      console.error('Failed to create API key:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to create API key',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteKey = async (kid: string, keyName?: string) => {
    // Add to deleting set for loading state
    setDeletingKeys(prev => new Set(prev).add(kid));
    
    try {
      await deleteKey(kid);
      toast({
        variant: 'success',
        title: 'API Key Deleted',
        description: `Successfully deleted API key ${keyName ? `"${keyName}"` : kid}.`,
      });
    } catch (error) {
      console.error('Failed to delete API key:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to delete API key',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
      });
    } finally {
      // Remove from deleting set
      setDeletingKeys(prev => {
        const newSet = new Set(prev);
        newSet.delete(kid);
        return newSet;
      });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        variant: 'success',
        title: 'Copied to clipboard',
        description: 'API key has been copied to your clipboard.',
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Unable to copy to clipboard. Please copy manually.',
      });
    }
  };

  const parseExpiryDate = (dateString?: string): Date | null => {
    if (!dateString) return null;
    
    // Try parsing as number (Unix timestamp)
    const timestamp = Number(dateString);
    if (!isNaN(timestamp)) {
      // If timestamp is less than year 2000 in seconds, it's likely in seconds, not milliseconds
      if (timestamp < 946684800000) {
        return new Date(timestamp * 1000);
      }
      return new Date(timestamp);
    }
    
    // Try parsing as ISO string or other date format
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    
    const expiryDate = parseExpiryDate(dateString);
    if (!expiryDate) return 'Invalid date';
    
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
    
    if (diffDays < 0) {
      const daysPast = Math.abs(diffDays);
      if (daysPast === 1) return 'Yesterday';
      if (daysPast < 7) return `${daysPast} days ago`;
      if (daysPast < 30) return `${Math.floor(daysPast / 7)} weeks ago`;
      return expiryDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    }
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 7) return `in ${diffDays} days`;
    if (diffDays < 30) return `in ${Math.floor(diffDays / 7)} weeks`;
    if (diffDays < 365) return `in ${Math.floor(diffDays / 30)} months`;
    
    return expiryDate.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const isKeyExpiringSoon = (dateString?: string) => {
    if (!dateString) return false;
    const expiryDate = parseExpiryDate(dateString);
    if (!expiryDate) return false;
    
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 3600 * 24));
    return daysUntilExpiry <= 7 && daysUntilExpiry > 0;
  };

  const isKeyExpired = (dateString?: string) => {
    if (!dateString) return false;
    const expiryDate = parseExpiryDate(dateString);
    if (!expiryDate) return false;
    
    const now = new Date();
    return expiryDate < now;
  };

  const getExpiryIcon = (dateString?: string) => {
    if (isKeyExpired(dateString)) {
      return <AlertCircle className="h-4 w-4 text-destructive" aria-label="Expired" />;
    }
    if (isKeyExpiringSoon(dateString)) {
      return <Clock className="h-4 w-4 text-yellow-700 dark:text-yellow-400" aria-label="Expiring soon" />;
    }
    return <CheckCircle className="h-4 w-4 text-green-700 dark:text-green-400" aria-label="Active" />;
  };

  const handleSetAsChatKey = () => {
    if (createdKey) {
      // Save the API key first
      saveApiKey(createdKey);
      
      toast({
        variant: 'success',
        title: 'Chat API Key Set',
        description: 'This key is now being used for chat functionality. You can start chatting!',
      });
      
      // Clear the created key state
      setCreatedKey(null);
      
      // Force a re-render by dispatching a storage event
      window.dispatchEvent(new Event('storage'));
      
      // Use a longer delay to ensure state updates propagate
      setTimeout(() => {
        // Notify parent component to switch to chat tab
        onApiKeySetForChat?.();
        // Close the modal after tab switch
        setTimeout(() => {
          onClose();
        }, 50);
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl" aria-describedby="api-keys-description">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Key className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>API Keys Management</span>
          </DialogTitle>
          <DialogDescription id="api-keys-description">
            Create and manage API keys for MCP client integrations. Keys are valid for 90 days and provide secure access to your calendar data.
          </DialogDescription>
        </DialogHeader>

        {createdKey && (
          <div 
            className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4"
            role="alert"
            aria-live="polite"
          >
            <h3 className="font-semibold text-green-900 dark:text-green-200 mb-2 flex items-center">
              <CheckCircle className="h-4 w-4 mr-2" aria-hidden="true" />
              New API Key Created!
            </h3>
            <div className="flex items-center space-x-2 mb-3">
              <Input
                value={createdKey}
                readOnly
                className="font-mono text-sm bg-background border-green-300 dark:border-green-700"
                aria-label="Generated API key"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(createdKey)}
                className="shrink-0 border-green-300 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900"
                aria-label="Copy API key to clipboard"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex items-center space-x-2 mb-3">
              <Button
                size="sm"
                onClick={handleSetAsChatKey}
                className="bg-green-600 hover:bg-green-700 text-white border-0"
                aria-label="Set this key as your chat API key"
              >
                <MessageSquare className="h-4 w-4 mr-2" aria-hidden="true" />
                Use for Chat
              </Button>
              <span className="text-sm text-green-800 dark:text-green-300">
                Set this key as your chat API key to start chatting immediately
              </span>
            </div>

            <p className="text-sm text-green-900 dark:text-green-300 mb-3">
              ⚠️ Make sure to copy this key now. You won&apos;t be able to see it again!
            </p>
            
            <div className="border-t border-green-200 dark:border-green-800 pt-3 mt-3">
              <button
                onClick={() => setShowConfiguration(!showConfiguration)}
                className="flex items-center justify-between w-full text-left hover:bg-green-100 dark:hover:bg-green-900/30 p-2 -m-2 rounded transition-colors"
                aria-expanded={showConfiguration}
                aria-controls="mcp-configuration-content"
              >
                <div>
                  <h4 className="font-medium text-green-900 dark:text-green-200 mb-1">
                    📋 MCP Client Configuration
                  </h4>
                  <p className="text-sm text-green-800 dark:text-green-300">
                    {showConfiguration 
                      ? 'Use this configuration in your MCP clients to connect to the calendar server'
                      : 'Click to show configuration examples for Claude Desktop and Cursor'
                    }
                  </p>
                </div>
                {showConfiguration ? (
                  <ChevronUp className="h-4 w-4 text-green-700 dark:text-green-400 shrink-0 ml-2" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-green-700 dark:text-green-400 shrink-0 ml-2" aria-hidden="true" />
                )}
              </button>
              
              {showConfiguration && (
                <div id="mcp-configuration-content" className="mt-3">
              
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-medium text-green-900 dark:text-green-200">
                      Claude Desktop
                    </h5>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(`{
  "mcpServers": {
    "calendar": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3002/mcp",
        "--header",
        "Authorization: Bearer \${CALENDAR_JWT_TOKEN}"
      ],
      "env": {
        "CALENDAR_JWT_TOKEN": "${createdKey}"
      }
    }
  }
}`)}
                      className="h-7 px-2 text-xs border-green-300 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900"
                      aria-label="Copy Claude Desktop configuration"
                    >
                      <Copy className="h-3 w-3 mr-1" aria-hidden="true" />
                      Copy
                    </Button>
                  </div>
                  <div className="bg-green-100 dark:bg-green-900/50 rounded border border-green-300 dark:border-green-700 p-3">
                    <div className="space-y-2 text-xs font-mono text-green-900 dark:text-green-100">
                      <div>{'{'}</div>
                      <div className="ml-2">&quot;mcpServers&quot;: {'{'}</div>
                      <div className="ml-4">&quot;calendar&quot;: {'{'}</div>
                      <div className="ml-6">&quot;command&quot;: &quot;npx&quot;,</div>
                      <div className="ml-6">&quot;args&quot;: [</div>
                      <div className="ml-8">&quot;mcp-remote&quot;,</div>
                      <div className="ml-8">&quot;http://localhost:3002/mcp&quot;,</div>
                      <div className="ml-8">&quot;--header&quot;,</div>
                      <div className="ml-8 break-all">&quot;Authorization: Bearer ${'${CALENDAR_JWT_TOKEN}'}&quot;</div>
                      <div className="ml-6">],</div>
                      <div className="ml-6">&quot;env&quot;: {'{'}</div>
                      <div className="ml-8 break-all">&quot;CALENDAR_JWT_TOKEN&quot;: &quot;<span className="bg-green-200 dark:bg-green-800 px-1 rounded">{createdKey}</span>&quot;</div>
                      <div className="ml-6">{'}'}</div>
                      <div className="ml-4">{'}'}</div>
                      <div className="ml-2">{'}'}</div>
                      <div>{'}'}</div>
                    </div>
                  </div>
                  <p className="text-xs text-green-800 dark:text-green-300 mt-2">
                    💡 First install: <code className="bg-green-200 dark:bg-green-800 px-1 rounded">npm install -g mcp-remote</code>
                  </p>
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-medium text-green-900 dark:text-green-200">
                      Cursor
                    </h5>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(`{
  "mcpServers": {
    "calendar": {
      "url": "http://localhost:3002/mcp",
      "headers": {
        "Authorization": "Bearer ${createdKey}"
      }
    }
  }
}`)}
                      className="h-7 px-2 text-xs border-green-300 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900"
                      aria-label="Copy Cursor configuration"
                    >
                      <Copy className="h-3 w-3 mr-1" aria-hidden="true" />
                      Copy
                    </Button>
                  </div>
                  <div className="bg-green-100 dark:bg-green-900/50 rounded border border-green-300 dark:border-green-700 p-3">
                    <div className="space-y-2 text-xs font-mono text-green-900 dark:text-green-100">
                      <div>{'{'}</div>
                      <div className="ml-2">&quot;mcpServers&quot;: {'{'}</div>
                      <div className="ml-4">&quot;calendar&quot;: {'{'}</div>
                      <div className="ml-6">&quot;url&quot;: &quot;http://localhost:3002/mcp&quot;,</div>
                      <div className="ml-6">&quot;headers&quot;: {'{'}</div>
                      <div className="ml-8 break-all">&quot;Authorization&quot;: &quot;Bearer <span className="bg-green-200 dark:bg-green-800 px-1 rounded">{createdKey}</span>&quot;</div>
                      <div className="ml-6">{'}'}</div>
                      <div className="ml-4">{'}'}</div>
                      <div className="ml-2">{'}'}</div>
                      <div>{'}'}</div>
                    </div>
                  </div>
                </div>
              </div>
                </div>
              )}
            </div>
            
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreatedKey(null)}
              className="mt-3 border-green-600 dark:border-green-700 text-green-900 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900"
            >
              Dismiss
            </Button>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Input
              placeholder="Enter key name (e.g., 'Claude Desktop')"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isCreating && handleCreateKey()}
              className="focus:ring-2 focus:ring-primary focus:border-primary"
              aria-label="API key name"
              disabled={isCreating}
            />
            <Button
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || isCreating}
              className="flex items-center space-x-2 shrink-0"
              aria-label={isCreating ? 'Creating API key...' : 'Create new API key'}
            >
              <Plus className={`h-4 w-4 ${isCreating ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isCreating ? 'Creating...' : 'Create Key'}</span>
            </Button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto" role="region" aria-label="API keys list">
            {isLoading ? (
              <SkeletonList 
                items={3} 
                className="space-y-3"
                aria-label="Loading API keys..." 
              />
            ) : keys.length === 0 ? (
              <div className="text-center py-8" role="status">
                <Key className="h-12 w-12 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="text-muted-foreground">No API keys created yet</p>
                <p className="text-sm text-muted-foreground">Create your first key to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {keys.map((key) => {
                  const isDeleting = deletingKeys.has(key.kid);
                  const expired = isKeyExpired(key.expires_at);
                  const expiringSoon = isKeyExpiringSoon(key.expires_at);
                  
                  return (
                    <div 
                      key={key.kid} 
                      className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                        expired 
                          ? 'border-destructive/50 bg-destructive/5' 
                          : expiringSoon 
                          ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30'
                          : 'border-border hover:border-primary/50 hover:bg-accent/50'
                      } ${isDeleting ? 'opacity-50' : ''}`}
                      role="listitem"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <p className="font-medium truncate">{key.name || 'Unnamed Key'}</p>
                          {getExpiryIcon(key.expires_at)}
                        </div>
                        <p className={`text-sm ${expired ? 'text-destructive' : expiringSoon ? 'text-yellow-800 dark:text-yellow-300' : 'text-muted-foreground'}`}>
                          {expired ? 'Expired' : 'Expires'}: {formatDate(key.expires_at)}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          ID: {key.kid}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteKey(key.kid, key.name)}
                        disabled={isDeleting}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-2 shrink-0"
                        aria-label={`Delete API key ${key.name || key.kid}`}
                      >
                        {isDeleting ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-destructive border-t-transparent" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 