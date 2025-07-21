import { NextResponse } from 'next/server';
import { testRedisWritePermissions, getRedisConfigDetails } from '../../../lib/redis';

export const runtime = 'edge';

export async function GET() {
  try {
    // Test Redis write permissions
    const redisWriteTest = await testRedisWritePermissions();
    
    // Get detailed Redis configuration
    const redisConfig = getRedisConfigDetails();

    return NextResponse.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      redis: {
        writePermissions: redisWriteTest,
        configuration: redisConfig
      }
    });
  } catch (error) {
    return NextResponse.json(
      { 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        redis: {
          configuration: getRedisConfigDetails()
        }
      },
      { status: 500 }
    );
  }
} 