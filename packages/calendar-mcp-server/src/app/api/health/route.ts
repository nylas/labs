// Using Node.js runtime for @vercel/mcp-adapter compatibility

export async function GET() {
  try {
    const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';
    
    // Simple health check - just ping the Bot API health endpoint without authentication
    const response = await fetch(`${BOT_API_URL}/api/health`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return Response.json(
        { 
          status: 'degraded',
          bot_api: 'unreachable',
          bot_api_status: response.status
        },
        { status: 503 }
      );
    }

    return Response.json({ 
      status: 'ok',
      bot_api: 'healthy'
    });
  } catch (error) {
    return Response.json(
      { 
        status: 'error',
        bot_api: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 