import { cacheGet, cacheSet } from '../lib/redis.js';

// Middleware to cache GET requests
export const cacheMiddleware = (duration = 300) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Create cache key from URL and query params
    const cacheKey = `cache:${req.originalUrl || req.url}`;

    try {
      // Try to get from cache
      const cachedData = await cacheGet(cacheKey);

      if (cachedData) {
        console.log(`✅ Cache HIT: ${cacheKey}`);
        return res.status(200).json(cachedData);
      }

      console.log(`❌ Cache MISS: ${cacheKey}`);

      // Store original res.json
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response
      res.json = function (data) {
        // Cache the response
        cacheSet(cacheKey, data, duration).catch(err => {
          console.error('Cache set error:', err);
        });

        // Call original json method
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};

// Middleware to invalidate cache on mutations
export const invalidateCacheMiddleware = (patterns) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override res.json to invalidate cache after successful response
    res.json = async function (data) {
      // Only invalidate on successful responses (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const { cacheDelPattern } = await import('../lib/redis.js');

        for (const pattern of patterns) {
          await cacheDelPattern(pattern);
          console.log(`🗑️  Invalidated cache: ${pattern}`);
        }
      }

      return originalJson(data);
    };

    next();
  };
};

export default cacheMiddleware;
