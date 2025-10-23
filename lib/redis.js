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

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

// Cache utility functions
export const cacheGet = async (key) => {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis GET error:', error);
    return null;
  }
};

export const cacheSet = async (key, value, expiryInSeconds = 3600) => {
  try {
    await redis.setex(key, expiryInSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('Redis SET error:', error);
    return false;
  }
};

export const cacheDel = async (key) => {
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error('Redis DEL error:', error);
    return false;
  }
};

export const cacheDelPattern = async (pattern) => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return true;
  } catch (error) {
    console.error('Redis DEL pattern error:', error);
    return false;
  }
};

export default redis;
