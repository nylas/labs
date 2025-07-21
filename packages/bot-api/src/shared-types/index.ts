export interface GrantData {
    provider: string;
    org_id: string;
    refresh_token: string;
    created_at: number;
    disabled?: boolean;
}
export interface KeyData {
    grant_id: string;
    name?: string;
    created_at: number;
    expires_at?: number;
}
export interface JwtPayload {
    sub: string;
    kid: string;
    iat: number;
    exp?: number;
    org: string;
    scp: string[];
    [key: string]: unknown;
}
export interface CreateKeyRequest {
    name?: string;
    ttl_days?: number;
    forever?: boolean;
}
export interface CreateKeyResponse {
    api_key: string;
    kid: string;
    expires_at?: number;
}
export interface ListKeysResponse {
    keys: Array<{
        kid: string;
        name?: string;
        expires_at?: number;
    }>;
}
export namespace McpApi {
    type DateRange = string;
    interface MyAvailabilityRequest {
        range: DateRange;
    }
    interface ContactAvailabilityRequest {
        email: string;
        range: DateRange;
    }
    interface MutualSlotsRequest {
        emails: string[];
        range: DateRange;
        durationMin: number;
    }
    interface ScheduleMeetingRequest {
        emails: string[];
        start: string;
        end: string;
        title: string;
        description?: string;
        addSelf?: boolean;
    }
    interface ConsecutiveSlotsRequest {
        sessions: Array<{
            label: string;
            emails: string[];
            durationMin: number;
        }>;
        range: DateRange;
        gapMaxMin: number;
    }
    interface TimeSlot {
        start: string;
        end: string;
        emails?: string[];
    }
    interface AvailabilityResponse {
        time_slots: TimeSlot[];
        order?: string[];
    }
    interface ConsecutiveSlotBlock {
        start: string;
        end: string;
        schedule: Array<{
            label: string;
            start: string;
            end: string;
        }>;
    }
    interface EventResponse {
        id: string;
        status: string;
        title?: string;
        start?: string;
        end?: string;
    }
}
export namespace BotApi {
    interface Participant {
        email: string;
        calendar_ids?: string[];
    }
    interface AvailabilityRequest {
        start_time: number;
        end_time: number;
        duration_minutes: number;
        participants?: Participant[];
        interval_minutes?: number;
        availability_rules?: {
            buffer?: {
                before?: number;
                after?: number;
            };
        };
        tentative_as_busy?: boolean;
    }
    interface EventCreateRequest {
        title: string;
        description?: string;
        when: {
            start_time: number;
            end_time: number;
        };
        calendar_id?: string;
        participants?: Participant[];
    }
    interface EventUpdateRequest {
        title?: string;
        description?: string;
        when?: {
            start_time: number;
            end_time: number;
        };
        calendar_id?: string;
    }
    interface TimeSlot {
        start: string;
        end: string;
        emails?: string[];
    }
    interface AvailabilityResponse {
        time_slots: TimeSlot[];
        order?: string[];
    }
    interface EventResponse {
        id: string;
        status: string;
        title?: string;
        when?: {
            start_time: string;
            end_time: string;
        };
    }
}
export interface ValidationError {
    field: string;
    message: string;
}
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    errors?: ValidationError[];
    request_id?: string;
}
export interface AvailabilityRequest {
    start_time: string;
    end_time: string;
    duration_minutes: number;
    interval_minutes?: number;
}
export interface EventCreateRequest {
    title: string;
    description?: string;
    start_time: string;
    end_time: string;
    participants?: Array<{
        email: string;
        name?: string;
    }>;
}
export interface EventUpdateRequest {
    title?: string;
    description?: string;
    start_time?: string;
    end_time?: string;
}
export interface ErrorResponse {
    error: string;
    description?: string;
    details?: unknown;
    error_code?: number;
    request_id?: string;
}
export interface NylasError {
    error: string;
    error_description?: string;
    error_code?: number;
    request_id?: string;
    message?: string;
    type?: string;
    description?: string;
}
export const ErrorCodes = {
    OAUTH_URL_ERROR: "oauth_url_error",
    INVALID_STATE: "invalid_state",
    EXCHANGE_FAILED: "exchange_failed",
    INVALID_BODY: "invalid_body",
    INVALID_DATE_RANGE: "invalid_date_range",
    INVALID_DURATION: "invalid_duration",
    GRANT_NOT_FOUND: "grant_not_found",
    KEY_NOT_FOUND: "key_not_found",
    EMAIL_NOT_CONNECTED: "email_not_connected",
    UNAUTHORIZED: "unauthorized",
    TOKEN_REVOKED: "token_revoked",
    GRANT_INVALID: "grant_invalid",
    INSUFFICIENT_SCOPE: "insufficient_scope",
    LOGOUT_FAILED: "logout_failed",
    PATH_NOT_ALLOWED: "path_not_allowed",
    CONFIGURATION_ERROR: "configuration_error",
    PROXY_ERROR: "proxy_error",
    UPSTREAM_ERROR: "upstream_error",
    RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export const ErrorStatusCodes: Record<ErrorCode, number> = {
    [ErrorCodes.OAUTH_URL_ERROR]: 400,
    [ErrorCodes.INVALID_STATE]: 400,
    [ErrorCodes.EXCHANGE_FAILED]: 401,
    [ErrorCodes.INVALID_BODY]: 400,
    [ErrorCodes.INVALID_DATE_RANGE]: 400,
    [ErrorCodes.INVALID_DURATION]: 400,
    [ErrorCodes.GRANT_NOT_FOUND]: 404,
    [ErrorCodes.KEY_NOT_FOUND]: 404,
    [ErrorCodes.EMAIL_NOT_CONNECTED]: 404,
    [ErrorCodes.UNAUTHORIZED]: 401,
    [ErrorCodes.TOKEN_REVOKED]: 401,
    [ErrorCodes.GRANT_INVALID]: 401,
    [ErrorCodes.INSUFFICIENT_SCOPE]: 403,
    [ErrorCodes.LOGOUT_FAILED]: 500,
    [ErrorCodes.PATH_NOT_ALLOWED]: 403,
    [ErrorCodes.CONFIGURATION_ERROR]: 500,
    [ErrorCodes.PROXY_ERROR]: 502,
    [ErrorCodes.UPSTREAM_ERROR]: 502,
    [ErrorCodes.RATE_LIMIT_EXCEEDED]: 429,
};

export const ErrorDescriptions: Record<ErrorCode, string> = {
    [ErrorCodes.OAUTH_URL_ERROR]: "Failed to generate OAuth URL",
    [ErrorCodes.INVALID_STATE]: "Invalid OAuth state parameter",
    [ErrorCodes.EXCHANGE_FAILED]: "OAuth token exchange failed",
    [ErrorCodes.INVALID_BODY]: "Invalid request body",
    [ErrorCodes.INVALID_DATE_RANGE]: "Invalid date range provided",
    [ErrorCodes.INVALID_DURATION]: "Invalid duration specified",
    [ErrorCodes.GRANT_NOT_FOUND]: "Grant not found",
    [ErrorCodes.KEY_NOT_FOUND]: "API key not found",
    [ErrorCodes.EMAIL_NOT_CONNECTED]: "Email not connected to organization",
    [ErrorCodes.UNAUTHORIZED]: "Unauthorized access",
    [ErrorCodes.TOKEN_REVOKED]: "Access token has been revoked",
    [ErrorCodes.GRANT_INVALID]: "Grant is invalid or expired",
    [ErrorCodes.INSUFFICIENT_SCOPE]: "Insufficient permissions for this operation",
    [ErrorCodes.LOGOUT_FAILED]: "Failed to logout user",
    [ErrorCodes.PATH_NOT_ALLOWED]: "API path not allowed",
    [ErrorCodes.CONFIGURATION_ERROR]: "Server configuration error",
    [ErrorCodes.PROXY_ERROR]: "Proxy request failed",
    [ErrorCodes.UPSTREAM_ERROR]: "Upstream service error",
    [ErrorCodes.RATE_LIMIT_EXCEEDED]: "Rate limit exceeded - too many requests",
};
