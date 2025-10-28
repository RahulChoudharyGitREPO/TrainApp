import Redis from 'ioredis';

let redis = null;
let isRedisConnected = false;

// Only create Redis connection if REDIS_URL is provided
const cleanRedisUrl = process.env.REDIS_URL?.replace(/^["']|["']$/g, '').trim();

if (cleanRedisUrl) {
  try {
    redis = new Redis(cleanRedisUrl, {
      retryStrategy: (times) => {
        if (times > 3) {
          console.log('⚠️  Redis: Max retries reached, giving up');
          return null;
        }
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 10000,
      lazyConnect: true, // Don't connect immediately
      keepAlive: 30000,
      family: 4,
      tls: {},
    });

    // Connect asynchronously without blocking
    redis.connect().catch((err) => {
      console.log('⚠️  Redis connection failed:', err.message);
      console.log('ℹ️  Server will continue without caching');
      redis = null;
    });

    redis.on('connect', () => {
      console.log('✅ Connected to Redis');
      isRedisConnected = true;
    });

    redis.on('error', (err) => {
      console.log('⚠️  Redis error:', err.message);
      isRedisConnected = false;
    });

    redis.on('close', () => {
      console.log('⚠️  Redis connection closed');
      isRedisConnected = false;
    });
  } catch (err) {
    console.log('⚠️  Redis initialization failed:', err.message);
    console.log('ℹ️  Server will continue without caching');
    redis = null;
  }
} else {
  console.log('ℹ️  No REDIS_URL configured - caching disabled');
}

// Cache utility functions with graceful fallback
export const cacheGet = async (key) => {
  if (!redis || !isRedisConnected) return null;

  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    // Silent fallback - just return null if Redis fails
    return null;
  }
};

export const cacheSet = async (key, value, expiryInSeconds = 3600) => {
  if (!redis || !isRedisConnected) return false;

  try {
    await redis.setex(key, expiryInSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    // Silent fallback
    return false;
  }
};

export const cacheDel = async (key) => {
  if (!redis || !isRedisConnected) return false;

  try {
    await redis.del(key);
    return true;
  } catch (error) {
    return false;
  }
};

export const cacheDelPattern = async (pattern) => {
  if (!redis || !isRedisConnected) return false;

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
