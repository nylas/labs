import { streamText, tool, jsonSchema, type Tool } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  addRequestIdToHeaders,
  createUnauthorizedError,
  getOrGenerateRequestId,
  handleGenericError,
} from "@/lib/errors";
import { ErrorCodes } from "@/shared-types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getRequestLogger, Logger } from "@/lib/logger";
import { checkChatRateLimit } from "@/lib/rate-limiter";
import { validateAccessByAccessTokenOrAPIKey } from "@/lib/auth";

export const runtime = "edge";
export const maxDuration = 30;

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolResult {
  content?: Array<{
    type: string;
    text: string;
  }>;
}

class CalendarMcpClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private mcpServerUrl: string;

  constructor(apiKey: string) {
    this.mcpServerUrl =
      process.env.NEXT_PUBLIC_CALENDAR_MCP_SERVER_URL ||
      "http://localhost:3002";

    // Create the MCP client
    this.client = new Client({
      name: "bot-api-calendar-client",
      version: "1.0.0",
    });

    // Create StreamableHTTP transport - headers may need to be set separately
    // due to known issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/495
    this.transport = new StreamableHTTPClientTransport(
      new URL(`${this.mcpServerUrl}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      }
    );
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect(this.transport);
    } catch (error) {
      console.error("Error connecting to MCP server:", error);
      throw error;
    }
  }

  async getAvailableTools(logger: Logger): Promise<McpTool[]> {
    try {
      const toolsResult = await this.client.listTools();
      return toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || {},
      }));
    } catch (error) {
      logger.error("Error getting MCP tools:", error);
      return [];
    }
  }

  async callTool(
    toolName: string,
    toolArguments: Record<string, unknown>
  ): Promise<string> {
    try {
      const result = (await this.client.callTool({
        name: toolName,
        arguments: toolArguments,
      })) as McpToolResult;

      // Extract text content from the result
      if (result.content && Array.isArray(result.content)) {
        const textContent = result.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");

        if (textContent) {
          return textContent;
        }
      }

      return "I received an unexpected response from the calendar server.";
    } catch (error) {
      console.error("Error calling MCP tool:", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch (error) {
      // Ignore AbortError as it means the connection was already closed
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error("Error closing MCP client:", error);
    }
  }
}

export async function POST(req: Request) {
  const requestId = getOrGenerateRequestId(req);
  const logger = getRequestLogger(req);
  let mcpClient: CalendarMcpClient | null = null;

  try {
    // First validate authentication
    const [grantInfo, authError] = await validateAccessByAccessTokenOrAPIKey(req, requestId);
    if (authError) return authError;

    const { messages, apiKey } = await req.json();

    if (!apiKey) {
      return createUnauthorizedError("API key is required", requestId);
    }

    if (!messages || !Array.isArray(messages)) {
      logger.error("Chat API - Invalid messages format", undefined, {
        requestId,
      });
      return new Response("Messages array is required", {
        status: 400,
        headers: addRequestIdToHeaders({}, requestId),
      });
    }

    // Rate limiting check - use grant_id as identifier for authenticated users
    const rateLimitResult = await checkChatRateLimit(grantInfo.grant_id, messages);
    if (!rateLimitResult.allowed) {
      logger.warn("Chat API - Rate limit exceeded", {
        requestId,
        reason: rateLimitResult.reason,
        retryAfter: rateLimitResult.retryAfter,
      });
      
      const headers = addRequestIdToHeaders({
        'X-RateLimit-Limit': rateLimitResult.details.requests.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.details.requests.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.details.requests.reset.toString(),
        'Retry-After': rateLimitResult.retryAfter?.toString() || '60',
      }, requestId);

      return new Response(
        JSON.stringify({
          error: "rate_limit_exceeded",
          message: rateLimitResult.reason,
          retryAfter: rateLimitResult.retryAfter,
        }),
        {
          status: 429,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    logger.info("Chat API - Rate limit check passed", {
      requestId,
      remaining: rateLimitResult.details.requests.remaining,
    });

    mcpClient = new CalendarMcpClient(apiKey);

    await mcpClient.connect();

    const availableTools = await mcpClient.getAvailableTools(logger);

    // Simplified tools creation using AI SDK's jsonSchema helper
    const tools = (mcpClient: CalendarMcpClient) => availableTools.reduce((acc, mcpTool) => {
      acc[mcpTool.name] = tool({
        description: mcpTool.description,
        parameters: jsonSchema(mcpTool.inputSchema as Record<string, unknown>),
        execute: async (args: unknown, _options: unknown) => {
          try {
            const result = await mcpClient.callTool(mcpTool.name, args as Record<string, unknown>);
            
            return result;
          } catch (error) {
            logger.error(`Chat API - Error calling ${mcpTool.name}:`, error);
            return `Error calling ${mcpTool.name}: ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        },
      });

      return acc;
    }, {} as Record<string, Tool>);

    // Ensure mcpClient is available before creating the stream
    if (!mcpClient) {
      return createUnauthorizedError("Failed to initialize MCP client", requestId);
    }

    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: `You are a helpful calendar assistant powered by the Nylas Calendar MCP Server. 

You have access to the following calendar tools:
${availableTools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")}

You can help users with:
📅 Checking availability and calendar information
🤝 Scheduling meetings and appointments  
📋 Viewing calendar events
🔍 Finding meeting slots

You're integrated with their Google Calendar through the Nylas API, so you can access real calendar data.

CRITICAL FORMATTING RULES:
1. NEVER display raw JSON to users under any circumstances
2. When you receive tool results, always interpret and format them into natural language
3. Convert all timestamps to human-readable format with timezone
4. Use bullet points, clear formatting, and conversational language
5. Add helpful context and commentary

For calendar/availability results:
- Convert ISO timestamps like "2025-07-05T09:00:00-04:00" to "Saturday, July 5th at 9:00 AM (EDT)"
- Group related time slots together
- Use clear formatting with bullet points or numbered lists
- Provide context about what the times represent

For meeting/event results:
- Show event titles, times, and participants clearly
- Include location information if available
- Format dates and times in a user-friendly way

REMEMBER: Users should NEVER see raw JSON like {"time_slots":[...]} - always convert to natural language!`,
      messages,
      maxSteps: 5,
      tools: tools(mcpClient!),
      onFinish: async (finishResult) => {
        logger.info("Chat API - Stream finished", {
          requestId,
          usage: finishResult.usage,
          finishReason: finishResult.finishReason,
        });
        if (mcpClient) {
          await mcpClient.close();
        }
      },
      onError: async (error) => {
        logger.error("Chat API - Stream error:", error, { requestId });
        if (mcpClient) {
          await mcpClient.close();
        }
      },
    });

    return result.toDataStreamResponse({
      headers: addRequestIdToHeaders({}, requestId),
    });
  } catch (error) {
    logger.error("Chat API - Error occurred:", error);
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch (closeError) {
        // Ignore AbortError during cleanup as it means the connection was already closed
        if (!(closeError instanceof Error && closeError.name === 'AbortError')) {
          logger.error(
            "Error closing MCP client during error handling:",
            closeError
          );
        }
      }
    }
    return handleGenericError(
      error,
      "Chat API error",
      ErrorCodes.PROXY_ERROR,
      requestId
    );
  }
}
