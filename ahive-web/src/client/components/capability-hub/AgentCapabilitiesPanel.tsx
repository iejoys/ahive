/**
 * Agent 能力绑定面板
 * 
 * 用于为 Agent 绑定 MCP 工具能力
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Chip,
  Button,
  Alert,
  Snackbar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LockIcon from '@mui/icons-material/Lock';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

interface MCPServer {
  id: string;
  name: string;
  status: string;
  toolCount: number;
  error?: string;
}

interface MCPTool {
  name: string;
  description: string;
}

interface AgentBinding {
  agentId: string;
  agentKey?: string;
  capabilities: {
    server: string;
    tools: string[];
  }[];
}

interface AgentCapabilitiesPanelProps {
  agentId: string;
  agentName: string;
}

export const AgentCapabilitiesPanel: React.FC<AgentCapabilitiesPanelProps> = ({
  agentId,
  agentName,
}) => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [tools, setTools] = useState<Record<string, MCPTool[]>>({});
  const [binding, setBinding] = useState<AgentBinding | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // 选中的工具
  const [selectedTools, setSelectedTools] = useState<Record<string, string[]>>({});

  // 加载服务器列表
  useEffect(() => {
    loadServers();
    loadBinding();
  }, [agentId]);

  const loadServers = async () => {
    setLoading(true);
    try {
      const result = await window.electron.getMCPServerList();
      setServers(result || []);
      
      // 加载每个服务器的工具
      const toolsMap: Record<string, MCPTool[]> = {};
      for (const server of result || []) {
        try {
          const serverTools = await window.electron.getMCPSeverTools(server.id);
          toolsMap[server.id] = serverTools || [];
        } catch (e) {
          toolsMap[server.id] = [];
        }
      }
      setTools(toolsMap);
    } catch (error) {
      console.error('Failed to load servers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBinding = async () => {
    try {
      const result = await window.electron.getAgentCapabilities?.(agentId);
      setBinding(result);
      
      // 设置已选中的工具
      if (result?.capabilities) {
        const selected: Record<string, string[]> = {};
        for (const cap of result.capabilities) {
          selected[cap.server] = cap.tools;
        }
        setSelectedTools(selected);
      }
    } catch (error) {
      console.error('Failed to load binding:', error);
    }
  };

  const handleToolToggle = (serverId: string, toolName: string) => {
    setSelectedTools(prev => {
      const serverTools = prev[serverId] || [];
      const newTools = serverTools.includes(toolName)
        ? serverTools.filter(t => t !== toolName)
        : [...serverTools, toolName];
      
      return {
        ...prev,
        [serverId]: newTools,
      };
    });
  };

  const handleSelectAllServer = (serverId: string) => {
    const serverTools = tools[serverId] || [];
    setSelectedTools(prev => ({
      ...prev,
      [serverId]: serverTools.map(t => t.name),
    }));
  };

  const handleDeselectAllServer = (serverId: string) => {
    setSelectedTools(prev => ({
      ...prev,
      [serverId]: [],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const capabilities = Object.entries(selectedTools)
        .filter(([_, tools]) => tools.length > 0)
        .map(([server, tools]) => ({
          server,
          tools,
        }));

      const result = await window.electron.bindAgentCapabilities?.(agentId, capabilities);
      
      if (result?.success) {
        setBinding(result.binding);
        setSnackbar({
          open: true,
          message: '能力绑定成功！密钥已生成并推送给 Agent',
          severity: 'success',
        });
      } else {
        throw new Error(result?.error || '保存失败');
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `保存失败: ${error}`,
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'success';
      case 'stopped':
        return 'default';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <CheckCircleIcon fontSize="small" color="success" />;
      case 'error':
        return <ErrorIcon fontSize="small" color="error" />;
      default:
        return null;
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        {agentName} - MCP 能力绑定
      </Typography>

      {binding?.agentKey && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            <LockIcon fontSize="small" sx={{ mr: 1, verticalAlign: 'middle' }} />
            Agent 密钥: <code>{binding.agentKey}</code>
          </Typography>
        </Alert>
      )}

      {loading && <LinearProgress />}

      {!loading && servers.length === 0 && (
        <Alert severity="warning">
          没有可用的 MCP 服务器，请先启动 MCP 服务
        </Alert>
      )}

      {servers.map(server => (
        <Accordion key={server.id} defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
              <Typography sx={{ flexGrow: 1 }}>
                {server.name}
              </Typography>
              <Chip
                size="small"
                label={server.status}
                color={getStatusColor(server.status)}
                icon={getStatusIcon(server.status)}
              />
              <Chip
                size="small"
                label={`${server.toolCount} 工具`}
                variant="outlined"
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            {server.status !== 'running' && (
              <Alert severity="error" sx={{ mb: 2 }}>
                服务器未运行，请先启动
              </Alert>
            )}

            <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleSelectAllServer(server.id)}
              >
                全选
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleDeselectAllServer(server.id)}
              >
                全部取消
              </Button>
            </Box>

            <FormGroup>
              {(tools[server.id] || []).map(tool => (
                <FormControlLabel
                  key={tool.name}
                  control={
                    <Checkbox
                      checked={(selectedTools[server.id] || []).includes(tool.name)}
                      onChange={() => handleToolToggle(server.id, tool.name)}
                      disabled={server.status !== 'running'}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{tool.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {tool.description}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </FormGroup>
          </AccordionDetails>
        </Accordion>
      ))}

      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || servers.filter(s => s.status === 'running').length === 0}
        >
          {saving ? '保存中...' : '保存绑定'}
        </Button>
        <Button variant="outlined" onClick={loadBinding}>
          刷新
        </Button>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AgentCapabilitiesPanel;