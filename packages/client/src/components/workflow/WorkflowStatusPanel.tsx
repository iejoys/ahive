/**
 * 工作流状态面板
 * 显示当前执行和未完成的实例
 */

import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';

type TabType = 'current' | 'incomplete';

export function WorkflowStatusPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [operating, setOperating] = useState<string | null>(null); // 正在操作的实例ID
  
  const {
    executionInstance,
    incompleteInstances,
    selectedInstanceDetails,
    loadIncompleteInstances,
    loadInstanceDetails,
  } = useStore();
  
  // 加载未完成的实例
  useEffect(() => {
    if (activeTab === 'incomplete') {
      loadIncompleteInstances();
    }
  }, [activeTab, loadIncompleteInstances]);
  
  // 加载实例详情
  useEffect(() => {
    if (selectedInstance) {
      loadInstanceDetails(selectedInstance);
    }
  }, [selectedInstance, loadInstanceDetails]);
  
  // ==================== 操作处理函数 ====================
  
  // 接续执行
  const handleResume = async (instanceId: string) => {
    if (operating) return; // 防止重复操作
    setOperating(instanceId);
    
    try {
      const result = await window.electronAPI?.resumeWorkflow?.(instanceId);
      if (result) {
        console.log('[WorkflowStatusPanel] 接续执行成功:', instanceId);
        // 刷新列表
        loadIncompleteInstances();
      } else {
        console.error('[WorkflowStatusPanel] 接续执行失败:', instanceId);
        alert('接续执行失败');
      }
    } catch (error: any) {
      console.error('[WorkflowStatusPanel] 接续执行错误:', error);
      alert(`接续执行错误: ${error.message}`);
    } finally {
      setOperating(null);
    }
  };
  
  // 强制关闭
  const handleForceStop = async (instanceId: string) => {
    if (operating) return;
    
    const confirmed = window.confirm('确定要强制关闭此工作流实例吗？这将停止当前执行并将状态标记为失败。');
    if (!confirmed) return;
    
    setOperating(instanceId);
    
    try {
      const result = await window.electronAPI?.stopWorkflow?.(instanceId);
      if (result) {
        console.log('[WorkflowStatusPanel] 强制关闭成功:', instanceId);
        // 刷新列表
        loadIncompleteInstances();
      } else {
        console.error('[WorkflowStatusPanel] 强制关闭失败:', instanceId);
        alert('强制关闭失败');
      }
    } catch (error: any) {
      console.error('[WorkflowStatusPanel] 强制关闭错误:', error);
      alert(`强制关闭错误: ${error.message}`);
    } finally {
      setOperating(null);
    }
  };
  
  // 标记为失败（清理僵尸实例）
  const handleMarkAsFailed = async (instanceId: string) => {
    if (operating) return;
    
    const confirmed = window.confirm('此实例可能已停止响应。确定要将其标记为失败状态吗？');
    if (!confirmed) return;
    
    setOperating(instanceId);
    
    try {
      // 调用强制停止 API（会更新数据库状态）
      const result = await window.electronAPI?.forceStopWorkflow?.(instanceId);
      if (result) {
        console.log('[WorkflowStatusPanel] 标记失败成功:', instanceId);
        // 刷新列表
        loadIncompleteInstances();
      } else {
        console.error('[WorkflowStatusPanel] 标记失败失败:', instanceId);
        alert('标记失败失败');
      }
    } catch (error: any) {
      console.error('[WorkflowStatusPanel] 标记失败错误:', error);
      alert(`标记失败错误: ${error.message}`);
    } finally {
      setOperating(null);
    }
  };
  
  // 计算运行时长 - 根据状态选择正确的结束时间
  const formatDuration = (startedAt: string, status?: string, completedAt?: string, updatedAt?: string, interruptAt?: string) => {
    const start = new Date(startedAt).getTime();
    
    // 根据状态决定结束时间
    let endTime: number;
    if (status === 'completed' && completedAt) {
      endTime = new Date(completedAt).getTime();
    } else if (status === 'completed') {
      // completed 状态但没有 completedAt，使用 updatedAt
      endTime = updatedAt ? new Date(updatedAt).getTime() : start;
    } else if ((status === 'failed' || status === 'paused') && interruptAt) {
      endTime = new Date(interruptAt).getTime();
    } else if (status === 'failed' || status === 'paused') {
      // failed/paused 状态但没有 interruptAt，使用 updatedAt
      endTime = updatedAt ? new Date(updatedAt).getTime() : start;
    } else {
      // running 状态：使用实时时间
      endTime = Date.now();
    }
    
    const seconds = Math.floor((endTime - start) / 1000);
    
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分`;
  };
  
  // 状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return '🔄';
      case 'paused': return '⏸️';
      case 'failed': return '❌';
      case 'completed': return '✅';
      default: return '⏳';
    }
  };
  
  // 状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#f59e0b';
      case 'paused': return '#3b82f6';
      case 'failed': return '#ef4444';
      case 'completed': return '#22c55e';
      default: return '#6b7280';
    }
  };
  
  return (
    <div style={{
      width: '400px',
      maxHeight: '600px',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderRadius: '12px',
      padding: '16px',
      color: 'white',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
      overflow: 'hidden',
    }}>
      {/* 标题 */}
      <div style={{
        fontSize: '16px',
        fontWeight: 'bold',
        marginBottom: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span>📊</span>
        <span>工作流状态</span>
      </div>
      
      {/* 选项卡 */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '16px',
      }}>
        <button
          onClick={() => setActiveTab('current')}
          style={{
            flex: 1,
            padding: '8px 12px',
            backgroundColor: activeTab === 'current' ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '14px',
            transition: 'background-color 0.2s',
          }}
        >
          当前执行
        </button>
        <button
          onClick={() => setActiveTab('incomplete')}
          style={{
            flex: 1,
            padding: '8px 12px',
            backgroundColor: activeTab === 'incomplete' ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '14px',
            transition: 'background-color 0.2s',
          }}
        >
          未完成 ({incompleteInstances.length})
        </button>
      </div>
      
      {/* 内容区域 */}
      <div style={{
        maxHeight: '450px',
        overflowY: 'auto',
      }}>
        {/* 当前执行 */}
        {activeTab === 'current' && (
          <div>
            {executionInstance ? (
              <div style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '8px',
                padding: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '20px' }}>{getStatusIcon(executionInstance.status)}</span>
                  <span style={{ fontSize: '14px', fontWeight: '500' }}>
                    {executionInstance.workflowId}
                  </span>
                </div>
                
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                  状态: <span style={{ color: getStatusColor(executionInstance.status) }}>
                    {executionInstance.status}
                  </span>
                </div>
                
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                  当前节点: {executionInstance.currentNodeId}
                </div>
                
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  运行时长: {formatDuration(executionInstance.startedAt, executionInstance.status, executionInstance.completedAt, executionInstance.updatedAt, executionInstance.interruptAt)}
                </div>
                
                {executionInstance.error && (
                  <div style={{
                    fontSize: '12px',
                    color: '#ef4444',
                    marginTop: '8px',
                    padding: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '4px',
                  }}>
                    错误: {executionInstance.error}
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                textAlign: 'center',
                color: '#9ca3af',
                padding: '20px',
              }}>
                暂无执行中的工作流
              </div>
            )}
          </div>
        )}
        
        {/* 未完成实例 */}
        {activeTab === 'incomplete' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {incompleteInstances.length > 0 ? (
              incompleteInstances.map((instance) => (
                <div
                  key={instance.instanceId}
                  onClick={() => setSelectedInstance(
                    selectedInstance === instance.instanceId ? null : instance.instanceId
                  )}
                  style={{
                    backgroundColor: selectedInstance === instance.instanceId 
                      ? 'rgba(59, 130, 246, 0.2)' 
                      : 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '8px',
                    padding: '12px',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '18px' }}>{getStatusIcon(instance.status)}</span>
                    <span style={{ fontSize: '14px', fontWeight: '500', flex: 1 }}>
                      {instance.workflowName}
                    </span>
                  </div>
                  
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                    当前节点: {instance.currentNodeName || instance.currentNodeId}
                  </div>
                  
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                    运行时长: {formatDuration(instance.startedAt, instance.status, instance.completedAt, instance.updatedAt, instance.interruptAt)}
                  </div>
                  
                  {/* 操作按钮 */}
                  <div style={{ 
                    marginTop: '8px', 
                    display: 'flex', 
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}>
                    {/* 接续执行按钮 - 仅对 paused 状态显示 */}
                    {instance.status === 'paused' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResume(instance.instanceId);
                        }}
                        style={{
                          padding: '4px 12px',
                          backgroundColor: '#22c55e',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'white',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                        title="接续执行"
                      >
                        ▶️ 接续执行
                      </button>
                    )}
                    
                    {/* 强制关闭按钮 - 对 running/paused 状态显示 */}
                    {(instance.status === 'running' || instance.status === 'paused') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleForceStop(instance.instanceId);
                        }}
                        style={{
                          padding: '4px 12px',
                          backgroundColor: '#ef4444',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'white',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                        title="强制关闭"
                      >
                        ⏹️ 强制关闭
                      </button>
                    )}
                    
                    {/* 标记为失败按钮 - 对异常 running 状态显示（超过一定时间） */}
                    {instance.status === 'running' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkAsFailed(instance.instanceId);
                        }}
                        style={{
                          padding: '4px 12px',
                          backgroundColor: '#f59e0b',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'white',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                        title="标记为失败（清理僵尸实例）"
                      >
                        ⚠️ 标记失败
                      </button>
                    )}
                  </div>
                  
                  {/* 展开详情 */}
                  {selectedInstance === instance.instanceId && selectedInstanceDetails && (
                    <div style={{
                      marginTop: '12px',
                      paddingTop: '12px',
                      borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                    }}>
                      <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '8px' }}>
                        节点执行进度:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {selectedInstanceDetails.nodeStates.map((node, idx) => (
                          <div key={`${node.nodeId}-${idx}`} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '12px',
                          }}>
                            <span style={{ fontSize: '14px' }}>{getStatusIcon(node.status)}</span>
                            <span style={{ flex: 1 }}>{node.nodeName || node.nodeId}</span>
                            {node.duration && (
                              <span style={{ color: '#9ca3af' }}>
                                {Math.floor(node.duration / 1000)}秒
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div style={{
                textAlign: 'center',
                color: '#9ca3af',
                padding: '20px',
              }}>
                暂无未完成的实例
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}