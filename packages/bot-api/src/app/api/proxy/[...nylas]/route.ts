import { validateAccessByAccessTokenOrAPIKey } from "@/lib/auth";
import {
  addRequestIdToHeaders,
  createConfigurationError,
  createUnauthorizedError,
  getOrGenerateRequestId,
  handleGenericError,
} from "@/lib/errors";
import { RedisStore } from "@/lib/redis";
import { ErrorCodes } from "@/shared-types";

export const runtime = "edge";

async function processAvailabilityBody(
  originalBody: string | null
): Promise<string> {
  if (!originalBody) {
    return JSON.stringify({});
  }

  try {
    const bodyObj = JSON.parse(originalBody);

    return JSON.stringify(bodyObj);
  } catch {
    return originalBody;
  }
}

function buildNylasUrl(
  nylasApiUri: string,
  pathString: string,
  grantId?: string,
  queryParams?: URLSearchParams
): string {
  let baseUrl: string;
  if (pathString.startsWith("calendars/availability")) {
    baseUrl = `${nylasApiUri}/v3/${pathString}`;
  } else {
    baseUrl = `${nylasApiUri}/v3/grants/${grantId}/${pathString}`;
  }

  // Add query parameters if provided
  if (queryParams && queryParams.toString()) {
    baseUrl += `?${queryParams.toString()}`;
  }

  return baseUrl;
}

async function forwardToNylas(
  url: string,
  method: string,
  headers: HeadersInit,
  body?: string
): Promise<Response> {
  return fetch(url, { method, headers, body });
}

async function handleRequest(
  request: Request,
  method: string,
  nylasPath: string[]
) {
  const requestId = getOrGenerateRequestId(request);

  try {
    // Verify access by access token or API key
    const [grantInfo, authError] = await validateAccessByAccessTokenOrAPIKey(
      request,
      requestId
    );
    if (authError) return authError;

    // Check if grant is still valid
    const grantId = grantInfo.grant_id.replace("grant:", "");
    const grant = await RedisStore.getGrant(grantId);
    if (!grant || grant.disabled) {
      return createUnauthorizedError(
        "Grant not found or has been disabled",
        requestId
      );
    }

    // Build Nylas API configuration
    const nylasApiUri = process.env.NYLAS_API_URI || "https://api.us.nylas.com";
    const nylasApiKey = process.env.NYLAS_API_KEY;

    if (!nylasApiKey) {
      return createConfigurationError(
        "Nylas API key not configured",
        requestId
      );
    }

    // Build URL and process request
    const pathString = nylasPath.join("/");

    // Extract query parameters from the incoming request
    const url = new URL(request.url);
    const allQueryParams = url.searchParams;

    // Filter out the 'nylas' parameter which is used by Next.js routing
    const queryParams = new URLSearchParams();
    for (const [key, value] of allQueryParams.entries()) {
      if (key !== "nylas") {
        queryParams.append(key, value);
      }
    }

    const nylasUrl = buildNylasUrl(
      nylasApiUri,
      pathString,
      grantId,
      queryParams
    );

    const isAvailabilityEndpoint = pathString.startsWith(
      "calendars/availability"
    );

    // Prepare headers
    const forwardHeaders: HeadersInit = {
      Authorization: `Bearer ${nylasApiKey}`,
      "User-Agent": "nylas-bot-api",
      "X-Request-ID": requestId,
    };

    const contentType = request.headers.get("Content-Type");
    if (contentType) {
      forwardHeaders["Content-Type"] = contentType;
    }

    // Process request body
    let body: string | undefined;
    if (["POST", "PUT", "PATCH"].includes(method)) {
      const originalBody = (await request.text()) || null;

      if (isAvailabilityEndpoint) {
        console.log("📅 AVAILABILITY REQUEST DEBUG:");
        console.log("  - Original Body:", originalBody);

        body = await processAvailabilityBody(originalBody);
        console.log("  - Processed Body:", body);
      } else {
        body = originalBody || undefined;
      }
    }

    // Forward request to Nylas
    const nylasResponse = await forwardToNylas(
      nylasUrl,
      method,
      forwardHeaders,
      body
    );

    // Prepare response headers
    const responseHeaders: HeadersInit = addRequestIdToHeaders(
      {
        "Content-Type":
          nylasResponse.headers.get("Content-Type") || "application/json",
      },
      requestId
    );

    // Forward response with original status code
    const responseBody = await nylasResponse.text();

    return new Response(responseBody, {
      status: nylasResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return handleGenericError(
      error,
      "Proxy request error",
      ErrorCodes.PROXY_ERROR,
      requestId
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nylas: string[] }> }
) {
  const { nylas } = await params;
  return handleRequest(request, "GET", nylas);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ nylas: string[] }> }
) {
  const { nylas } = await params;
  return handleRequest(request, "POST", nylas);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ nylas: string[] }> }
) {
  const { nylas } = await params;
  return handleRequest(request, "PUT", nylas);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ nylas: string[] }> }
) {
  const { nylas } = await params;
  return handleRequest(request, "PATCH", nylas);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ nylas: string[] }> }
) {
  const { nylas } = await params;
  return handleRequest(request, "DELETE", nylas);
}
