import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

const PROXY_AUTH_KEY: string = process.env.PROXY_AUTH_KEY || ''
const PROXY_SECRET: string = process.env.PROXY_SECRET || PROXY_AUTH_KEY || 'uestc-helper-secret-key-default'

// Nonce 查重缓存（5分钟 TTL 防重放攻击）
const recentNonces = new Map<string, number>()
const NONCE_TTL_MS = 5 * 60 * 1000

// 滑动窗口 IP / Client 频控缓存
interface RateLimitBucket {
  timestamps: number[]
}
const rateLimitMap = new Map<string, RateLimitBucket>()

/**
 * 清理过期的 Nonces 和频控记录
 */
function cleanupExpiredCache() {
  const now = Date.now()
  for (const [nonce, ts] of recentNonces.entries()) {
    if (now - ts > NONCE_TTL_MS) {
      recentNonces.delete(nonce)
    }
  }
  for (const [ip, bucket] of rateLimitMap.entries()) {
    bucket.timestamps = bucket.timestamps.filter(t => now - t < 60000)
    if (bucket.timestamps.length === 0) {
      rateLimitMap.delete(ip)
    }
  }
}

// 每 2 分钟清理一次缓存
setInterval(cleanupExpiredCache, 2 * 60 * 1000)

/**
 * 校验请求签名与防重放
 */
export function verifyRequestSecurity(req: Request, res: Response, next: NextFunction): void {
  const proxyKey = (req.headers['x-proxy-key'] as string) || ''
  const timestampHeader = (req.headers['x-timestamp'] as string) || ''
  const nonce = (req.headers['x-nonce'] as string) || ''
  const signature = (req.headers['x-signature'] as string) || ''

  // 1. 签名模式校验
  if (timestampHeader && nonce && signature) {
    const timestamp = parseInt(timestampHeader, 10)
    const now = Date.now()

    // 检查时间戳有效性（允许 ±5 分钟漂移）
    if (isNaN(timestamp) || Math.abs(now - timestamp) > NONCE_TTL_MS) {
      res.status(401).json({ error: 'Request timestamp expired or out of sync' })
      return
    }

    // 检查 Nonce 防重放
    if (recentNonces.has(nonce)) {
      res.status(401).json({ error: 'Replay attack detected: nonce already used' })
      return
    }
    recentNonces.set(nonce, now)

    // 计算预期签名：HMAC-SHA256(timestamp + '\n' + nonce + '\n' + path, secret)
    const stringToSign = `${timestamp}\n${nonce}\n${req.path}`
    const expectedSig = crypto
      .createHmac('sha256', PROXY_SECRET)
      .update(stringToSign)
      .digest('hex')

    if (signature !== expectedSig) {
      res.status(401).json({ error: 'Invalid request signature' })
      return
    }

    next()
    return
  }

  // 2. 静态 Key 回退校验（兼容旧端或单机测试）
  if (PROXY_AUTH_KEY && proxyKey === PROXY_AUTH_KEY) {
    next()
    return
  }

  // 3. Web/PWA 公共只读与学生自服务端点放行（已由 rateLimiter 保护）
  const publicPaths = ['/api/v1/knowledge', '/api/v1/config', '/api/v1/jwc', '/api/jwc']
  if (publicPaths.some(prefix => req.path.startsWith(prefix))) {
    next()
    return
  }

  // 若无密钥配置且在开发环境中，允许通过，但给出警告
  if (!PROXY_AUTH_KEY && process.env.NODE_ENV !== 'production') {
    next()
    return
  }

  res.status(401).json({ error: 'Unauthorized: missing or invalid security credentials' })
}

/**
 * IP 滑动窗口速率限制中间件
 * @param maxPerMinute 每分钟最大请求数
 */
export function rateLimiter(maxPerMinute: number = 30) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown_client'
    const now = Date.now()

    let bucket = rateLimitMap.get(ip)
    if (!bucket) {
      bucket = { timestamps: [] }
      rateLimitMap.set(ip, bucket)
    }

    // 剔除 1 分钟之前的请求记录
    bucket.timestamps = bucket.timestamps.filter(t => now - t < 60000)

    if (bucket.timestamps.length >= maxPerMinute) {
      res.status(429).json({
        error: `请求频次超出限制（最多每分钟 ${maxPerMinute} 次），请稍后重试。`,
        retryAfterMs: 60000 - (now - bucket.timestamps[0])
      })
      return
    }

    bucket.timestamps.push(now)
    next()
  }
}

/**
 * 用户输入边界防御中间件
 */
export function validatePayloadBoundaries(req: Request, res: Response, next: NextFunction): void {
  const body = req.body
  if (body && body.message && typeof body.message === 'string') {
    if (body.message.length > 4000) {
      res.status(400).json({ error: '消息内容过长，单条输入限制为 4000 字符以内' })
      return
    }
  }
  next()
}
