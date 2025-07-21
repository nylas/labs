import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Message } from '@ai-sdk/react';

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  onExampleClick: (question: string) => void;
}

export function ChatMessages({ messages, isLoading, onExampleClick }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const toggleToolExpansion = (toolCallId: string) => {
    setExpandedTools(prev => {
      const newSet = new Set(prev);
      if (newSet.has(toolCallId)) {
        newSet.delete(toolCallId);
      } else {
        newSet.add(toolCallId);
      }
      return newSet;
    });
  };

  const exampleQuestions = [
    "What is my availability tomorrow?",
    "Schedule a meeting with john@example.com for next week",
    "Find mutual availability between me and sarah@company.com tomorrow afternoon",
    "Find a 30-minute slot for a team meeting this week"
  ];

  return (
    <ScrollArea className="flex-1 px-6 py-4">
      <div className="space-y-6 max-w-4xl mx-auto">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Bot className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-medium text-foreground mb-3 tracking-tight">
              Let&apos;s get started!
            </h3>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto leading-relaxed">
              I can help you manage your calendar, schedule meetings, and check availability. Try asking me one of these questions:
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
              {exampleQuestions.map((question, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="text-left justify-start h-auto p-4 whitespace-normal border-border/50 hover:border-border hover:bg-muted/30 transition-all duration-200"
                  onClick={() => onExampleClick(question)}
                >
                  <span className="text-sm leading-relaxed">{question}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start space-x-4 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role !== 'user' && (
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-nylas-primary text-white">
                    <Bot className="h-3.5 w-3.5" />
                  </AvatarFallback>
                </Avatar>
              )}
              
              <div
                className={`max-w-[75%] rounded-xl px-4 py-3 shadow-sm transition-all duration-200 ${
                  message.role === 'user'
                    ? 'bg-nylas-primary text-white shadow-nylas/10'
                    : 'bg-muted/50 text-foreground border border-border/20'
                }`}
              >
                {/* Tool invocations at the top */}
                {message.toolInvocations && message.toolInvocations.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {message.toolInvocations.map((toolInvocation) => (
                      <div key={toolInvocation.toolCallId} className="bg-background/10 rounded border border-border/20">
                        <button
                          onClick={() => toggleToolExpansion(toolInvocation.toolCallId)}
                          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-background/5 transition-colors"
                        >
                          <div className="flex items-center space-x-2">
                            <Settings className="h-3 w-3 text-foreground/60" />
                            <span className="text-xs font-medium text-foreground/80">
                              Using tool: {toolInvocation.toolName}
                            </span>
                          </div>
                          {expandedTools.has(toolInvocation.toolCallId) ? (
                            <ChevronDown className="h-3 w-3 text-foreground/60" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-foreground/60" />
                          )}
                        </button>
                        
                        {expandedTools.has(toolInvocation.toolCallId) && (
                          <div className="px-3 pb-3 space-y-2 border-t border-border/10">
                            {/* Request details */}
                            <div>
                              <div className="text-xs font-medium text-foreground/70 mb-1">Request:</div>
                              <div className="text-xs bg-background/20 rounded p-2 font-mono">
                                <pre className="whitespace-pre-wrap text-foreground/80">
                                  {JSON.stringify(toolInvocation.args, null, 2)}
                                </pre>
                              </div>
                            </div>
                            
                            {/* Response details */}
                            {toolInvocation.state === 'result' && (
                              <div>
                                <div className="text-xs font-medium text-foreground/70 mb-1">Response:</div>
                                <div className="text-xs bg-background/20 rounded p-2 font-mono">
                                  <pre className="whitespace-pre-wrap text-foreground/80">
                                    {typeof toolInvocation.result === 'string' 
                                      ? toolInvocation.result 
                                      : JSON.stringify(toolInvocation.result, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}
                            
                            {toolInvocation.state === 'call' && (
                              <div className="text-xs text-foreground/60 italic">
                                Calling calendar tool...
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Message content */}
                <div className="text-sm">
                  {message.role === 'user' ? (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  ) : (
                    <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-ul:text-foreground prose-li:text-foreground">
                      <ReactMarkdown 
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 last:mb-0 space-y-1">{children}</ul>,
                          li: ({ children }) => <li className="text-foreground">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>

              {message.role === 'user' && (
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-muted/50 text-foreground text-xs">
                    U
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))
        )}
        
        {isLoading && (
          <div className="flex items-start space-x-4">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="bg-nylas-primary text-white">
                <Bot className="h-3.5 w-3.5" />
              </AvatarFallback>
            </Avatar>
            <div className="bg-muted/50 rounded-xl px-4 py-3 border border-border/20">
              <div className="flex items-center space-x-1">
                <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce delay-150"></div>
                <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce delay-300"></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
} 