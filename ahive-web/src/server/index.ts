import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { agentsRouter } from './routes/agents.js';
import { skillsRouter } from './routes/skills.js';
import { tasksRouter } from './routes/tasks.js';
// A2A 路由已迁移到 Electron 客户端 (端口 3003)
// import { a2aRouter, setSocketIO } from './routes/a2a.js';

const app = express();
const httpServer = createServer(app);

// ==================== CORS 安全配置 ====================
// 生产环境应限制允许的源
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://your-domain.com'])
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3001'];

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // 允许无 origin 的请求（如移动应用、Postman）
      if (!origin) return callback(null, true);
      
      if (ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Rejected origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
  }
});

const PORT = (globalThis.process?.env?.PORT as string) || '3001';

// Middleware - 使用相同的 CORS 配置
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false); // 对于 Express，返回 false 而不是错误
    }
  },
  credentials: true
}));

app.use(express.json());

// Root endpoint
  app.get('/', (req, res) => {
    res.json({ 
      name: 'AHIVE API', 
      version: '2.0.0',
      endpoints: {
        agents: '/api/agents',
        skills: '/api/skills',
        tasks: '/api/tasks',
        health: '/api/health',
      },
      note: 'A2A 服务已迁移到 Electron 客户端 (端口 3003)'
    });
  });

// Routes
app.use('/api/agents', agentsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/tasks', tasksRouter);
// A2A 路由已迁移到 Electron 客户端 (端口 3003)
// app.use('/a2a', a2aRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('subscribe', (agentId: string) => {
    socket.join(`agent:${agentId}`);
    console.log(`Socket ${socket.id} subscribed to agent:${agentId}`);
  });

  socket.on('unsubscribe', (agentId: string) => {
    socket.leave(`agent:${agentId}`);
    console.log(`Socket ${socket.id} unsubscribed from agent:${agentId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// A2A WebSocket 已迁移到 Electron 客户端
// setSocketIO(io);

// Export io for use in routes
export { io };

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT_NUM = parseInt(PORT, 10);

httpServer.listen(PORT_NUM, () => {
  console.log(`AHIVE server running on http://localhost:${PORT_NUM}`);
  console.log(`Socket.io enabled on port ${PORT_NUM}`);
  console.log(`CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});