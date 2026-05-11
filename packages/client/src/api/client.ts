import type { Agent, Skill, Task } from '../types';

const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }
  
  if (response.status === 204) {
    return undefined as T;
  }
  
  return response.json();
}

// Agents API
export const agentsApi = {
  getAll: () => fetchJSON<Agent[]>(`${API_BASE}/agents`),
  get: (id: string) => fetchJSON<Agent>(`${API_BASE}/agents/${id}`),
  create: (data: Partial<Agent>) => 
    fetchJSON<Agent>(`${API_BASE}/agents`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Agent>) =>
    fetchJSON<Agent>(`${API_BASE}/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchJSON<void>(`${API_BASE}/agents/${id}`, {
      method: 'DELETE',
    }),
  updateStatus: (id: string, status: string) =>
    fetchJSON<Agent>(`${API_BASE}/agents/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};

// Skills API
export const skillsApi = {
  getAll: () => fetchJSON<Skill[]>(`${API_BASE}/skills`),
  get: (id: string) => fetchJSON<Skill>(`${API_BASE}/skills/${id}`),
  create: (data: Partial<Skill>) =>
    fetchJSON<Skill>(`${API_BASE}/skills`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchJSON<void>(`${API_BASE}/skills/${id}`, {
      method: 'DELETE',
    }),
};

// Tasks API
export const tasksApi = {
  getAll: () => fetchJSON<Task[]>(`${API_BASE}/tasks`),
  getByAgent: (agentId: string) => fetchJSON<Task[]>(`${API_BASE}/tasks/agent/${agentId}`),
  get: (id: string) => fetchJSON<Task>(`${API_BASE}/tasks/${id}`),
  create: (data: { agentId: string; task: string; context?: any }) =>
    fetchJSON<Task>(`${API_BASE}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchJSON<void>(`${API_BASE}/tasks/${id}`, {
      method: 'DELETE',
    }),
};

// Health check
export const healthApi = {
  check: () => fetchJSON<{ status: string; timestamp: string }>(`${API_BASE}/health`),
};

export const api = {
  agents: agentsApi,
  skills: skillsApi,
  tasks: tasksApi,
  health: healthApi,
};
