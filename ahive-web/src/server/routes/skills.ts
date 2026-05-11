import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Types (inline to avoid import issues)
interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  dependencies: string[];
  installs: number;
  createdAt: string;
}

interface CreateSkillRequest {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  dependencies?: string[];
}

const router = Router();

// In-memory storage
const skills: Map<string, Skill> = new Map();

// Initialize with some mock skills
const initialSkills: Skill[] = [
  {
    id: 'web-search',
    name: '网络搜索',
    description: '在互联网上搜索信息',
    category: 'web',
    icon: '🔍',
    dependencies: [],
    installs: 32500,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'summarize',
    name: '文档摘要',
    description: '总结长文档和文本内容',
    category: 'core',
    icon: '📝',
    dependencies: ['web-search'],
    installs: 28000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'code-gen',
    name: '代码生成',
    description: '用多种编程语言生成代码',
    category: 'core',
    icon: '💻',
    dependencies: [],
    installs: 45000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'debug',
    name: '调试',
    description: '发现并修复代码中的bug',
    category: 'core',
    icon: '🐛',
    dependencies: ['code-gen'],
    installs: 21000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'refactor',
    name: '重构',
    description: '重构和改进代码质量',
    category: 'core',
    icon: '🔧',
    dependencies: ['code-gen'],
    installs: 18000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'data-analysis',
    name: '数据分析',
    description: '分析和处理数据',
    category: 'data',
    icon: '📊',
    dependencies: [],
    installs: 22000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'visualize',
    name: '数据可视化',
    description: '从数据创建可视化图表',
    category: 'data',
    icon: '📈',
    dependencies: ['data-analysis'],
    installs: 15000,
    createdAt: new Date().toISOString(),
  },
];

// Initialize
initialSkills.forEach(skill => skills.set(skill.id, skill));

// Get all skills
router.get('/', (req, res) => {
  const skillList = Array.from(skills.values());
  res.json(skillList);
});

// Get single skill
router.get('/:id', (req, res) => {
  const skill = skills.get(req.params.id);
  if (!skill) {
    return res.status(404).json({ error: '技能未找到' });
  }
  res.json(skill);
});

// Create skill
router.post('/', (req, res) => {
  const data: CreateSkillRequest = req.body;
  const skill: Skill = {
    id: data.id || uuidv4(),
    name: data.name,
    description: data.description || '',
    category: data.category || 'custom',
    icon: data.icon || '⭐',
    dependencies: data.dependencies || [],
    installs: 0,
    createdAt: new Date().toISOString(),
  };
  skills.set(skill.id, skill);
  res.status(201).json(skill);
});

// Delete skill
router.delete('/:id', (req, res) => {
  if (!skills.has(req.params.id)) {
    return res.status(404).json({ error: '技能未找到' });
  }
  skills.delete(req.params.id);
  res.status(204).send();
});

export { router as skillsRouter, skills };
