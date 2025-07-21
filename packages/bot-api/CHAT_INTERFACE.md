# Refactored Chat Interface with AI SDK

This document describes the refactored chat interface that now uses `@ai-sdk/react` for improved streaming chat functionality with the Calendar MCP Server.

## Overview

The chat interface has been completely refactored to:

1. **Use AI SDK**: Leverages `@ai-sdk/react`'s `useChat` hook for better state management and streaming
2. **Split into Components**: Broken down into smaller, reusable components
3. **Dynamic Tool Loading**: Automatically discovers and uses available MCP tools
4. **Better Error Handling**: Improved error states and recovery
5. **Streaming Support**: Real-time message streaming with tool invocation visibility

## Architecture

### Components

#### `ChatInterface` (Main Component)
- Orchestrates the entire chat experience
- Manages API key state using `useApiKey` hook
- Uses `useChat` from AI SDK for chat functionality
- Handles routing between API key setup and chat

#### `ApiKeySetup`
- Dedicated component for API key input and validation
- Provides user guidance on how to get an API key
- Handles local storage persistence

#### `ChatHeader`
- Displays chat title and status
- Provides API key management controls
- Shows authentication state

#### `ChatMessages`
- Renders chat message history
- Shows tool invocations and results
- Provides example questions for new users
- Auto-scrolls to latest messages

#### `ChatInput`
- Input field with send/stop functionality
- Handles form submission
- Shows loading and streaming states

### Hooks

#### `useApiKey`
- Manages API key state and localStorage persistence
- Provides methods to save/clear API keys
- Handles API key validation states

### API Route

#### `/api/chat`
- Streams responses using AI SDK's `streamText`
- Dynamically discovers MCP tools via `tools/list`
- Converts MCP tools to AI SDK tool format
- Handles MCP server communication with proper authentication

## Features

### Dynamic Tool Discovery
The chat interface automatically discovers available tools from the MCP server:

```typescript
// Get available tools from MCP server
const availableTools = await mcpClient.getAvailableTools();

// Convert to AI SDK format
const tools = availableTools.reduce((acc, tool) => {
  acc[tool.name] = {
    description: tool.description,
    parameters: tool.inputSchema || {},
    execute: async (args: any) => {
      return await mcpClient.callTool(tool.name, args);
    }
  };
  return acc;
}, {});
```

### Streaming with Tool Invocations
Messages show real-time tool usage:

```typescript
{message.toolInvocations && message.toolInvocations.map((toolInvocation) => (
  <div key={toolInvocation.toolCallId}>
    <div>Using tool: {toolInvocation.toolName}</div>
    {toolInvocation.state === 'result' && (
      <div>{toolInvocation.result}</div>
    )}
    {toolInvocation.state === 'call' && (
      <div>Calling calendar tool...</div>
    )}
  </div>
))}
```

### Error Handling
- API key validation and re-prompting
- Network error recovery
- Tool execution error handling
- Graceful fallbacks

## Environment Variables

Add to your `.env.local`:

```bash
# Required for AI SDK
OPENAI_API_KEY=your_openai_api_key_here

# MCP Server URL (already configured)
NEXT_PUBLIC_CALENDAR_MCP_SERVER_URL=http://localhost:3002
```

## Usage

1. **Set up Environment**: Add OpenAI API key to environment variables
2. **Start Services**: Ensure MCP server is running on port 3002
3. **Get API Key**: Use the API Keys interface to generate a calendar API key
4. **Start Chatting**: Enter the API key and start asking calendar questions

## Example Interactions

The interface provides example questions:
- "What's my availability tomorrow?"
- "Schedule a meeting with john@example.com for next week"
- "Find mutual availability between me and sarah@company.com tomorrow afternoon"
- "Find a 30-minute slot for a team meeting this week"

## Benefits

1. **Better Performance**: Streaming responses provide immediate feedback
2. **Tool Visibility**: Users can see which calendar tools are being used
3. **Error Recovery**: Better handling of API key and network issues
4. **Extensibility**: Easy to add new MCP servers and tools
5. **Maintainability**: Cleaner, more modular code structure

## Development

To extend the chat interface:

1. **Add New Components**: Create new components in `/components`
2. **Extend Hooks**: Add functionality to existing hooks or create new ones
3. **Tool Integration**: New MCP tools are automatically discovered
4. **Styling**: Components use existing Tailwind classes and design system

The refactored interface is more maintainable, performant, and provides a better user experience while maintaining all existing functionality. 