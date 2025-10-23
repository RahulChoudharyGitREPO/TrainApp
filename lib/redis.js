import Redis from 'ioredis';

// Support both REDIS_URL and individual connection params
// Strip any quotes that might be in the URL
const cleanRedisUrl = process.env.REDIS_URL?.replace(/^["']|["']$/g, '').trim();

const redisConfig = cleanRedisUrl
  ? cleanRedisUrl
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    };

const redis = new Redis(redisConfig, {
  retryStrategy: (times) => {
    // Stop retrying after 3 attempts
    if (times > 3) {
      return null;
    }
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  connectTimeout: 10000,
  lazyConnect: false,
  keepAlive: 30000,
  family: 4, // Force IPv4
  tls: cleanRedisUrl ? {} : undefined, // Enable TLS for Upstash
});

let isRedisConnected = false;

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
  isRedisConnected = true;
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
  isRedisConnected = false;
});

redis.on('close', () => {
  console.log('⚠️  Redis connection closed');
  isRedisConnected = false;
});

// Cache utility functions with graceful fallback
export const cacheGet = async (key) => {
  if (!isRedisConnected) return null;

  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    // Silent fallback - just return null if Redis fails
    return null;
  }
};

export const cacheSet = async (key, value, expiryInSeconds = 3600) => {
  if (!isRedisConnected) return false;

  try {
    await redis.setex(key, expiryInSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    // Silent fallback
    return false;
  }
};

export const cacheDel = async (key) => {
  if (!isRedisConnected) return false;

  try {
    await redis.del(key);
    return true;
  } catch (error) {
    return false;
  }
};

export const cacheDelPattern = async (pattern) => {
  if (!isRedisConnected) return false;

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return true;
  } catch (error) {
    return false;
  }
};

export default redis;
