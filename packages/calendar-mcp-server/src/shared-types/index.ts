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
// McpApi types
export type McpApiDateRange = string;

export interface McpApiMyAvailabilityRequest {
    range: McpApiDateRange;
}

export interface McpApiContactAvailabilityRequest {
    email: string;
    range: McpApiDateRange;
}

export interface McpApiMutualSlotsRequest {
    emails: string[];
    range: McpApiDateRange;
    durationMin: number;
}

export interface McpApiScheduleMeetingRequest {
    emails: string[];
    start: string;
    end: string;
    title: string;
    description?: string;
    addSelf?: boolean;
}

export interface McpApiConsecutiveSlotsRequest {
    sessions: Array<{
        label: string;
        emails: string[];
        durationMin: number;
    }>;
    range: McpApiDateRange;
    gapMaxMin: number;
}

export interface McpApiTimeSlot {
    start: string;
    end: string;
    emails?: string[];
}

export interface McpApiAvailabilityResponse {
    time_slots: McpApiTimeSlot[];
    order?: string[];
}

export interface McpApiConsecutiveSlotBlock {
    start: string;
    end: string;
    schedule: Array<{
        label: string;
        start: string;
        end: string;
    }>;
}

export interface McpApiEventResponse {
    id: string;
    status: string;
    title?: string;
    start?: string;
    end?: string;
}
// BotApi types
export interface BotApiParticipant {
    email: string;
    calendar_ids?: string[];
}

export interface BotApiAvailabilityRequest {
    start_time: number;
    end_time: number;
    duration_minutes: number;
    participants?: BotApiParticipant[];
    interval_minutes?: number;
    availability_rules?: {
        buffer?: {
            before?: number;
            after?: number;
        };
        default_open_hours?: Array<{
            days: number[];
            timezone: string;
            start: string;
            end: string;
            exdates?: string[];
        }>;
    };
    tentative_as_busy?: boolean;
}

export interface BotApiEventCreateRequest {
    title: string;
    description?: string;
    when: {
        start_time: number;
        end_time: number;
    };
    calendar_id?: string;
    participants?: BotApiParticipant[];
}

export interface BotApiEventUpdateRequest {
    title?: string;
    description?: string;
    when?: {
        start_time: number;
        end_time: number;
    };
    calendar_id?: string;
}

export interface BotApiTimeSlot {
    start: string;
    end: string;
    emails?: string[];
}

export interface BotApiAvailabilityResponse {
    time_slots: BotApiTimeSlot[];
    order?: string[];
}

export interface BotApiEventResponse {
    id: string;
    status: string;
    title?: string;
    when?: {
        start_time: string;
        end_time: string;
    };
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
export declare const ErrorCodes: {
    readonly OAUTH_URL_ERROR: "oauth_url_error";
    readonly INVALID_STATE: "invalid_state";
    readonly EXCHANGE_FAILED: "exchange_failed";
    readonly INVALID_BODY: "invalid_body";
    readonly INVALID_DATE_RANGE: "invalid_date_range";
    readonly INVALID_DURATION: "invalid_duration";
    readonly GRANT_NOT_FOUND: "grant_not_found";
    readonly KEY_NOT_FOUND: "key_not_found";
    readonly EMAIL_NOT_CONNECTED: "email_not_connected";
    readonly UNAUTHORIZED: "unauthorized";
    readonly TOKEN_REVOKED: "token_revoked";
    readonly GRANT_INVALID: "grant_invalid";
    readonly INSUFFICIENT_SCOPE: "insufficient_scope";
    readonly LOGOUT_FAILED: "logout_failed";
    readonly PATH_NOT_ALLOWED: "path_not_allowed";
    readonly CONFIGURATION_ERROR: "configuration_error";
    readonly PROXY_ERROR: "proxy_error";
    readonly UPSTREAM_ERROR: "upstream_error";
};
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
export declare const ErrorStatusCodes: Record<ErrorCode, number>;
export declare const ErrorDescriptions: Record<ErrorCode, string>;
