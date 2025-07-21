import { 
  ErrorCode, 
  ErrorCodes, 
  ErrorStatusCodes, 
  ErrorDescriptions, 
  ErrorResponse,
  NylasError 
} from '@/shared-types';

/**
 * Creates a standardized error response
 */
export function createErrorResponse(
  errorCode: ErrorCode,
  customDescription?: string,
  details?: unknown,
  requestId?: string
): Response {
  const statusCode = ErrorStatusCodes[errorCode];
  const description = customDescription || ErrorDescriptions[errorCode];
  
  const errorResponse: ErrorResponse = {
    error: errorCode,
    description
  };
  
  if (details !== undefined) {
    errorResponse.details = details;
  }
  
  if (requestId) {
    errorResponse.request_id = requestId;
  }
  
  return new Response(JSON.stringify(errorResponse), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Creates an error response with request ID from headers
 */
export function createErrorResponseWithRequestId(
  request: Request,
  errorCode: ErrorCode,
  customDescription?: string,
  details?: unknown
): Response {
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
  return createErrorResponse(errorCode, customDescription, details, requestId);
}

/**
 * Parses Nylas error response and creates standardized error
 */
export function createNylasErrorResponse(
  nylasErrorText: string,
  fallbackErrorCode: ErrorCode = ErrorCodes.UPSTREAM_ERROR,
  requestId?: string
): Response {
  let nylasError: NylasError;
  
  try {
    nylasError = JSON.parse(nylasErrorText);
  } catch {
    nylasError = { 
      error: 'parse_error', 
      message: nylasErrorText 
    };
  }
  
  const errorResponse: ErrorResponse = {
    error: fallbackErrorCode,
    description: nylasError.error_description || nylasError.message || ErrorDescriptions[fallbackErrorCode],
    details: nylasError.error || 'unknown_error'
  };
  
  if (nylasError.error_code) {
    errorResponse.error_code = nylasError.error_code;
  }
  
  if (nylasError.request_id || requestId) {
    errorResponse.request_id = nylasError.request_id || requestId;
  }
  
  return new Response(JSON.stringify(errorResponse), {
    status: ErrorStatusCodes[fallbackErrorCode],
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Creates a validation error for invalid request body
 */
export function createValidationError(
  message: string,
  requestId?: string
): Response {
  return createErrorResponse(
    ErrorCodes.INVALID_BODY,
    message,
    undefined,
    requestId
  );
}

/**
 * Creates an unauthorized error
 */
export function createUnauthorizedError(
  message?: string,
  requestId?: string
): Response {
  return createErrorResponse(
    ErrorCodes.UNAUTHORIZED,
    message,
    undefined,
    requestId
  );
}

/**
 * Creates a not found error
 */
export function createNotFoundError(
  resourceType: 'grant' | 'key',
  resourceId: string,
  requestId?: string
): Response {
  const errorCode = resourceType === 'grant' ? ErrorCodes.GRANT_NOT_FOUND : ErrorCodes.KEY_NOT_FOUND;
  const description = `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} '${resourceId}' not found or has been disabled`;
  
  return createErrorResponse(
    errorCode,
    description,
    undefined,
    requestId
  );
}

/**
 * Creates a forbidden error
 */
export function createForbiddenError(
  errorCode: typeof ErrorCodes.PATH_NOT_ALLOWED | typeof ErrorCodes.INSUFFICIENT_SCOPE,
  customDescription?: string,
  requestId?: string
): Response {
  return createErrorResponse(
    errorCode,
    customDescription,
    undefined,
    requestId
  );
}

/**
 * Creates a configuration error
 */
export function createConfigurationError(
  message: string,
  requestId?: string
): Response {
  return createErrorResponse(
    ErrorCodes.CONFIGURATION_ERROR,
    message,
    undefined,
    requestId
  );
}

/**
 * Handles generic errors with logging
 */
export function handleGenericError(
  error: unknown,
  context: string,
  fallbackErrorCode: ErrorCode = ErrorCodes.INVALID_BODY,
  requestId?: string
): Response {
  // Import logger here to avoid circular dependencies
  import('./logger').then(({ logger }) => {
    logger.error(`Generic error in ${context}`, error, { 
      requestId, 
      errorCode: fallbackErrorCode,
      context
    });
  }).catch(() => {
    // Fallback to console if logger fails
    console.error(`${context}:`, error);
  });
  
  const message = error instanceof Error ? error.message : 'Unknown error occurred';
  
  return createErrorResponse(
    fallbackErrorCode,
    message,
    undefined,
    requestId
  );
}

/**
 * Utility to extract request ID from request headers or generate one
 */
export function getOrGenerateRequestId(request: Request): string {
  return request.headers.get('X-Request-ID') || crypto.randomUUID();
}

/**
 * Adds request ID to response headers
 */
export function addRequestIdToHeaders(headers: HeadersInit, requestId: string): HeadersInit {
  return {
    ...headers,
    'X-Request-ID': requestId
  };
} 