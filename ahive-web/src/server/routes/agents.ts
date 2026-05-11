import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Types (inline to avoid import issues)
interface Agent {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'working' | 'paused' | 'error';
  avatar: string;
  position: { x: number; y: number; z: number };
  skills: string[];
  type: 'opencode' | 'mcp' | 'mock';
  createdAt: string;
  updatedAt: string;
}

interface CreateAgentRequest {
  name: string;
  description?: string;
  status?: Agent['status'];
  avatar?: string;
  position?: { x: number; y: number; z: number };
  skills?: string[];
  type?: Agent['type'];
}

const router = Router();

// In-memory storage
const agents: Map<string, Agent> = new Map();

// Initialize with some mock agents
const initialAgents: Agent[] = [
  {
    id: '1',
    name: 'Coder',
    description: '代码生成与调试专家',
    status: 'idle',
    avatar: 'coder',
    position: { x: 0, y: 0, z: 0 },
    skills: ['code-gen', 'debug', 'refactor'],
    type: 'opencode',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    name: 'Searcher',
    description: '网络搜索与信息收集',
    status: 'idle',
    avatar: 'searcher',
    position: { x: 2, y: 0, z: 1 },
    skills: ['web-search', 'summarize'],
    type: 'mcp',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    name: 'Analyzer',
    description: '数据分析与可视化',
    status: 'idle',
    avatar: 'analyzer',
    position: { x: -2, y: 0, z: 2 },
    skills: ['data-analysis', 'visualize'],
    type: 'mock',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Initialize
initialAgents.forEach(agent => agents.set(agent.id, agent));

// Get all agents
router.get('/', (req, res) => {
  const agentList = Array.from(agents.values());
  res.json(agentList);
});

// Get single agent
router.get('/:id', (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: '智能体未找到' });
  }
  res.json(agent);
});

// Create agent
router.post('/', (req, res) => {
  const data: CreateAgentRequest = req.body;
  const agent: Agent = {
    id: uuidv4(),
    name: data.name,
    description: data.description || '',
    status: data.status || 'idle',
    avatar: data.avatar || 'default',
    position: data.position || { x: 0, y: 0, z: 0 },
    skills: data.skills || [],
    type: data.type || 'mock',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  agents.set(agent.id, agent);
  res.status(201).json(agent);
});

// Update agent
router.put('/:id', (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: '智能体未找到' });
  }
  
  const updated = { ...agent, ...req.body, updatedAt: new Date().toISOString() };
  agents.set(req.params.id, updated);
  res.json(updated);
});

// Delete agent
router.delete('/:id', (req, res) => {
  if (!agents.has(req.params.id)) {
    return res.status(404).json({ error: '智能体未找到' });
  }
  agents.delete(req.params.id);
  res.status(204).send();
});

// Update agent status
router.patch('/:id/status', (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: '智能体未找到' });
  }
  
  const { status } = req.body;
  if (!['idle', 'working', 'paused', 'error'].includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }
  
  agent.status = status;
  agent.updatedAt = new Date().toISOString();
  res.json(agent);
});

export { router as agentsRouter, agents };
