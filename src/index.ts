import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT: number = parseInt(process.env.PORT || '3000', 10);
const PROXY_AUTH_KEY: string = process.env.PROXY_AUTH_KEY || '';

export function checkAuth(req: Request, res: Response): boolean {
  const key: string = (req.headers['x-proxy-key'] as string) || '';
  if (key !== PROXY_AUTH_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 占位：阶段1实现 /api/chat（SSE），阶段2实现 /api/tool-result
app.post('/api/chat', (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  res.status(501).json({ error: 'not implemented yet (phase 1)' });
});

app.post('/api/tool-result', (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  res.status(501).json({ error: 'not implemented yet (phase 2)' });
});

app.listen(PORT, () => {
  console.log(`[ai-agent] listening on port ${PORT}`);
});

export { app };
