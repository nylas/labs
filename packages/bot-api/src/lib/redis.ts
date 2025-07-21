import { Redis } from '@upstash/redis';
import { logger } from './logger';

// Edge-compatible Redis client - supports both local (via REST proxy) and Upstash Redis
export const redis = createRedisClient();

// Read-only Redis client (uses read-only token if available)
export const redisReadOnly = createReadOnlyRedisClient();

function createRedisClient(): Redis {
  // Prioritize new KV environment variables
  const kvRestUrl = process.env.KV_REST_API_URL;
  const kvRestToken = process.env.KV_REST_API_TOKEN;
  
  // Fallback to legacy Upstash environment variables
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  // Additional logging for debugging
  logger.debug('Redis environment variables check', {
    hasKvUrl: !!kvRestUrl,
    hasKvToken: !!kvRestToken,
    hasUpstashUrl: !!upstashUrl,
    hasUpstashToken: !!upstashToken,
    kvUrlMasked: kvRestUrl ? kvRestUrl.substring(0, 20) + '...' : undefined,
    kvTokenMasked: kvRestToken ? kvRestToken.substring(0, 8) + '...' : undefined
  });
  
  // Use KV vars if available, otherwise fallback to Upstash vars
  const redisUrl = kvRestUrl || upstashUrl;
  const redisToken = kvRestToken || upstashToken;
  
  if (redisUrl && redisToken) {
    const configSource = kvRestUrl ? 'KV' : 'UPSTASH';
    
    // Validate that we're not accidentally using a read-only token for the main client
    if (redisToken === process.env.KV_REST_API_READ_ONLY_TOKEN) {
      logger.error('CRITICAL: Main Redis client attempting to use read-only token!', {
        source: configSource,
        tokenMasked: redisToken.substring(0, 8) + '...'
      });
      throw new Error('Main Redis client cannot use read-only token');
    }
    
    if (redisUrl.includes('localhost')) {
      logger.info('Main Redis connection configured', { 
        type: 'local_proxy',
        source: configSource,
        tokenType: 'read-write',
        url: redisUrl,
        masked_token: redisToken.substring(0, 8) + '...'
      });
    } else {
      logger.info('Main Redis connection configured', { 
        type: 'upstash_cloud',
        source: configSource,
        tokenType: 'read-write',
        masked_url: redisUrl.replace(/\/\/.*@/, '//***@'),
        masked_token: redisToken.substring(0, 8) + '...'
      });
    }
    
    return new Redis({
      url: redisUrl,
      token: redisToken
    });
  }
  
  // Fallback to fromEnv for backward compatibility
  logger.warn('Redis configuration fallback - this might cause rate limiting issues', {
    message: 'Using Redis.fromEnv() - ensure KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are set',
    hasKvUrl: !!kvRestUrl,
    hasKvToken: !!kvRestToken,
    hasUpstashUrl: !!upstashUrl,
    hasUpstashToken: !!upstashToken
  });
  
  try {
    const fallbackClient = Redis.fromEnv();
    logger.info('Redis fromEnv fallback created successfully');
    return fallbackClient;
  } catch (error) {
    logger.error('Redis fromEnv fallback failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw new Error(`Failed to create Redis client: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createReadOnlyRedisClient(): Redis {
  // Try to use read-only token if available
  const kvRestUrl = process.env.KV_REST_API_URL;
  const kvReadOnlyToken = process.env.KV_REST_API_READ_ONLY_TOKEN;
  const kvRestToken = process.env.KV_REST_API_TOKEN;
  
  // Fallback to legacy Upstash environment variables
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  // Use KV vars if available, otherwise fallback to Upstash vars
  const redisUrl = kvRestUrl || upstashUrl;
  const readOnlyToken = kvReadOnlyToken || kvRestToken || upstashToken;
  
  if (redisUrl && readOnlyToken) {
    const tokenType = kvReadOnlyToken ? 'read-only' : 'full-access';
    const configSource = kvRestUrl ? 'KV' : 'UPSTASH';
    
    if (redisUrl.includes('localhost')) {
      logger.info('Redis read-only connection configured', { 
        type: 'local_proxy',
        source: configSource,
        tokenType,
        url: redisUrl,
        masked_token: readOnlyToken.substring(0, 8) + '...'
      });
    } else {
      logger.info('Redis read-only connection configured', { 
        type: 'upstash_cloud',
        source: configSource,
        tokenType,
        masked_url: redisUrl.replace(/\/\/.*@/, '//***@'),
        masked_token: readOnlyToken.substring(0, 8) + '...'
      });
    }
    
    return new Redis({
      url: redisUrl,
      token: readOnlyToken
    });
  }
  
  // Create a separate Redis instance instead of circular dependency
  logger.info('Redis read-only client creating separate instance with main config');
  const mainUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const mainToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (mainUrl && mainToken) {
    return new Redis({
      url: mainUrl,
      token: mainToken
    });
  }
  
  // Last resort fallback
  logger.warn('Redis read-only client using fromEnv fallback');
  return Redis.fromEnv();
}

// Function to test if Redis connection has write permissions
export async function testRedisWritePermissions(): Promise<boolean> {
  try {
    const testKey = `test:write:${Date.now()}`;
    const testValue = 'test';
    
    // Try to set and get a test value
    await redis.set(testKey, testValue, { ex: 10 }); // 10 second expiry
    const retrieved = await redis.get(testKey);
    
    // Clean up
    await redis.del(testKey);
    
    const hasWriteAccess = retrieved === testValue;
    logger.info('Redis write permissions test', { 
      success: hasWriteAccess,
      testKey: testKey.substring(0, 20) + '...'
    });
    
    return hasWriteAccess;
  } catch (error) {
    logger.error('Redis write permissions test failed', { 
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

// Function to get Redis configuration details for debugging
export function getRedisConfigDetails() {
  return {
    mainClient: {
      hasKvUrl: !!process.env.KV_REST_API_URL,
      hasKvToken: !!process.env.KV_REST_API_TOKEN,
      hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
      hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
      kvUrlMasked: process.env.KV_REST_API_URL ? process.env.KV_REST_API_URL.substring(0, 20) + '...' : undefined,
      kvTokenMasked: process.env.KV_REST_API_TOKEN ? process.env.KV_REST_API_TOKEN.substring(0, 8) + '...' : undefined,
      usingKvConfig: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    },
    readOnlyClient: {
      hasReadOnlyToken: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
      readOnlyTokenMasked: process.env.KV_REST_API_READ_ONLY_TOKEN ? process.env.KV_REST_API_READ_ONLY_TOKEN.substring(0, 8) + '...' : undefined,
    },
    otherEnvVars: {
      hasRedisUrl: !!process.env.REDIS_URL,
      hasKvUrl2: !!process.env.KV_URL,
    }
  };
}

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

export class RedisStore {
  static async getGrant(grantId: string): Promise<GrantData | null> {
    const key = `grant:${grantId}`;
    
    try {
      logger.redisOperation('hgetall', key, { grantId });
      const data = await redis.hgetall(key);
      
      if (!data || Object.keys(data).length === 0) {
        logger.debug('Grant not found', { grantId, key });
        return null;
      }
      
      logger.debug('Grant retrieved successfully', { grantId, key });
      return {
        provider: data.provider as string,
        org_id: data.org_id as string,
        refresh_token: data.refresh_token as string,
        created_at: Number(data.created_at),
        disabled: data.disabled === '1'
      };
    } catch (error) {
      logger.redisError('hgetall', error, key, { grantId });
      throw new Error(`Failed to retrieve grant ${grantId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static async setGrant(grantId: string, data: GrantData): Promise<void> {
    const key = `grant:${grantId}`;
    
    // Ensure all values are strings and not null/undefined
    const grantData: Record<string, string> = {
      provider: String(data.provider || ''),
      org_id: String(data.org_id || ''),
      refresh_token: String(data.refresh_token || ''),
      created_at: String(data.created_at || Date.now())
    };
    
    // Only add disabled field if it's explicitly true
    if (data.disabled === true) {
      grantData.disabled = '1';
    }

    try {
      logger.redisOperation('hset', key, { grantId, provider: data.provider, org_id: data.org_id });
      await redis.hset(key, grantData);
      logger.debug('Grant stored successfully', { grantId, key, provider: data.provider });
    } catch (error) {
      logger.redisError('hset', error, key, { grantId, provider: data.provider });
      throw new Error(`Failed to store grant ${grantId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static async getKey(kid: string): Promise<KeyData | null> {
    const key = `key:${kid}`;
    
    try {
      logger.redisOperation('hgetall', key, { kid });
      const data = await redis.hgetall(key);
      
      if (!data || Object.keys(data).length === 0) {
        logger.debug('Key not found', { kid, key });
        return null;
      }
      
      logger.debug('Key retrieved successfully', { kid, key });
      return {
        grant_id: data.grant_id as string,
        name: data.name ? String(data.name) : undefined,
        created_at: Number(data.created_at) || 0,
        expires_at: data.expires_at ? Number(data.expires_at) : undefined
      };
    } catch (error) {
      logger.redisError('hgetall', error, key, { kid });
      throw new Error(`Failed to retrieve key ${kid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static async setKey(kid: string, data: KeyData, ttlSeconds?: number): Promise<void> {
    const key = `key:${kid}`;
    
    // Ensure all values are strings and not null/undefined
    const keyData: Record<string, string> = {
      grant_id: String(data.grant_id || ''),
      created_at: String(data.created_at || Date.now())
    };
    
    // Only add optional fields if they have valid values
    if (data.name && data.name.trim()) {
      keyData.name = String(data.name);
    }
    
    if (data.expires_at && data.expires_at > 0) {
      keyData.expires_at = String(data.expires_at);
    }

    try {
      logger.redisOperation('hset', key, { kid, grant_id: data.grant_id, ttlSeconds });
      await redis.hset(key, keyData);
      
      if (ttlSeconds && ttlSeconds > 0) {
        logger.redisOperation('expire', key, { kid, ttlSeconds });
        await redis.expire(key, ttlSeconds);
      }
      
      logger.debug('Key stored successfully', { kid, key, grant_id: data.grant_id, ttlSeconds });
    } catch (error) {
      logger.redisError('hset/expire', error, key, { kid, grant_id: data.grant_id });
      throw new Error(`Failed to store key ${kid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static async deleteKey(kid: string): Promise<void> {
    await redis.del(`key:${kid}`);
  }

  static async keyExists(kid: string): Promise<boolean> {
    const exists = await redis.exists(`key:${kid}`);
    return exists === 1;
  }

  static async getGrantKeys(grantId: string): Promise<Array<{ kid: string; data: KeyData }>> {
    // This is a simplified implementation - in production you might want to use a separate index
    const pattern = 'key:*';
    const keys = await redis.keys(pattern);
    const results: Array<{ kid: string; data: KeyData }> = [];
    
    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (data && data.grant_id === grantId) {
        const kid = key.replace('key:', '');
        results.push({
          kid,
          data: {
            grant_id: data.grant_id as string,
            name: data.name ? String(data.name) : undefined,
            created_at: Number(data.created_at) || 0,
            expires_at: data.expires_at ? Number(data.expires_at) : undefined
          }
        });
      }
    }
    
    return results;
  }

  static async getJwtSecret(): Promise<string> {
    const key = 'secret:jwt';
    
    try {
      logger.redisOperation('get', key);
      let secret = await redis.get(key);
      
      if (!secret) {
        // Generate a new secret if one doesn't exist
        logger.info('Generating new JWT secret', { key });
        const array = new Uint8Array(32);
        globalThis.crypto.getRandomValues(array);
        secret = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        
        logger.redisOperation('set', key);
        await redis.set(key, secret);
        logger.info('New JWT secret stored', { key });
      } else {
        logger.debug('JWT secret retrieved', { key });
      }
      
      return secret as string;
    } catch (error) {
      logger.redisError('get/set jwt secret', error, key);
      throw new Error(`Failed to get/set JWT secret: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 