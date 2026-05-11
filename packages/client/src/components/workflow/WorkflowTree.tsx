import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { WorkflowNode } from './WorkflowNode';
import { WorkflowEdge as CustomWorkflowEdge } from './WorkflowEdge';
import { WorkflowEdgePanel } from './WorkflowEdgePanel';
import { WorkflowToolbar } from './WorkflowToolbar';
import { BlackboardPanel } from './BlackboardPanel';
import { NodeConfigPanel } from './NodeConfigPanel';
import { NodeToolbox } from './NodeToolbox';
import { useStore } from '../../store/useStore';
import type { WorkflowNode as WorkflowNodeType, WorkflowEdge as WorkflowEdgeType, Agent, WorkflowNodeType as NodeTypeName } from '../../types';

const nodeTypes = {
  workflow: WorkflowNode,
};

// 使用自定义边组件
const edgeTypes = {
  default: CustomWorkflowEdge,
};

interface WorkflowTreeProps {
  workflowId?: string;
}

// 判断边类型: normal=正常流程, fail=失败退回
function getEdgeType(
  sourceHandle?: string, 
  targetHandle?: string
): 'normal' | 'fail' {
  // 底部 → 左侧 = 失败退回线
  if (targetHandle === 'left') return 'fail';
  return 'normal';
}

// 获取边标记颜色
function getEdgeMarkerColor(edgeType: 'normal' | 'fail') {
  return edgeType === 'fail' ? '#ef4444' : '#6366f1';
}

// 构建节点和边的函数
function buildNodesAndEdges(
  nodes: WorkflowNodeType[],
  edges: WorkflowEdgeType[],
  agents: Agent[]
): { nodes: Node[]; edges: Edge[] } {
  const flowNodes: Node[] = nodes.map((node) => ({
    id: node.id,
    type: 'workflow',
    position: node.position,
    data: { ...node, agents },
  }));

  const flowEdges: Edge[] = edges.map((edge) => {
    // 兼容旧数据：默认值
    const sourceHandle = edge.sourceHandle || 'bottom';
    const targetHandle = edge.targetHandle || 'top';
    const edgeType = getEdgeType(sourceHandle, targetHandle);
    
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle,
      target: edge.target,
      targetHandle,
      label: edge.label,
      type: 'default', // 使用自定义边组件
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: getEdgeMarkerColor(edgeType),
      },
      data: {
        failCondition: edge.failCondition || edge.condition,
        conditionFailTarget: edge.conditionFailTarget,
        edgeType, // 传递边类型给自定义边组件
      },
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export function WorkflowTree({ workflowId }: WorkflowTreeProps) {
  const { 
    workflows, 
    currentWorkflowId, 
    agents,
    selectWorkflowNode,
    addWorkflowNode,
    addWorkflowEdge,
    updateWorkflowEdge,
    removeWorkflowEdge,
    selectedWorkflowNodeId,
    updateWorkflowNode,
    updateWorkflowNodePosition,
    removeWorkflowNode,
    addWorkflow,
    setCurrentWorkflow,
  } = useStore();
  
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  
  // 追踪上一个工作流ID，用于判断是否切换了工作流
  const prevWorkflowIdRef = useRef<string | null>(null);
  
  // 获取当前工作流
  const workflow = workflows.find(w => w.id === (workflowId || currentWorkflowId));
  const currentWfId = workflow?.id;
  
  // 获取选中的节点
  const selectedNode = workflow?.nodes.find(n => n.id === selectedWorkflowNodeId);
  
  // 初始化节点和边 - 只依赖工作流ID，不依赖workflow对象本身
  const initialNodesAndEdges = useMemo(
    () => buildNodesAndEdges(workflow?.nodes || [], workflow?.edges || [], agents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentWfId, agents]
  );
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodesAndEdges.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialNodesAndEdges.edges);
  
  // 只在切换工作流时才重置节点位置
  useEffect(() => {
    if (prevWorkflowIdRef.current !== currentWfId) {
      prevWorkflowIdRef.current = currentWfId || null;
      setNodes(initialNodesAndEdges.nodes);
      setEdges(initialNodesAndEdges.edges);
    }
  }, [currentWfId, initialNodesAndEdges, setNodes, setEdges]);
  
  // 监听 workflow.edges 变化，同步到 ReactFlow
  useEffect(() => {
    if (workflow?.edges) {
      const newEdges = buildNodesAndEdges(workflow.nodes, workflow.edges, agents).edges;
      setEdges(newEdges);
    }
  }, [workflow?.edges, workflow?.nodes, agents, setEdges]);
  
  // 监听 workflow.nodes 变化，同步到 ReactFlow
  useEffect(() => {
    if (workflow?.nodes) {
      const newNodes = buildNodesAndEdges(workflow.nodes, workflow.edges || [], agents).nodes;
      setNodes(newNodes);
    }
  }, [workflow?.nodes, workflow?.edges, agents, setNodes]);
  
  // 确保有工作流存在
  useEffect(() => {
    if (workflows.length === 0) {
      // 创建默认工作流
      const newWorkflow = {
        id: `workflow-${Date.now()}`,
        name: '默认工作流',
        nodes: [],
        edges: [],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addWorkflow(newWorkflow);
      setCurrentWorkflow(newWorkflow.id);
    } else if (!currentWorkflowId) {
      // 如果有工作流但没有选中，选中第一个
      setCurrentWorkflow(workflows[0].id);
    }
  }, [workflows, currentWorkflowId, addWorkflow, setCurrentWorkflow]);
  
  // 节点拖拽结束后保存位置到 store
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      updateWorkflowNodePosition(node.id, node.position);
    },
    [updateWorkflowNodePosition]
  );
  
  // 处理边更新 - 更新后同步界面并取消选中
  const handleUpdateEdge = useCallback((edge: WorkflowEdgeType) => {
    updateWorkflowEdge(edge);
    // 取消选中，关闭面板
    setEdges(eds => eds.map(e => ({ ...e, selected: false })));
  }, [updateWorkflowEdge, setEdges]);
  
  // 处理边删除 - 删除后取消选中
  const handleRemoveEdge = useCallback((edgeId: string) => {
    removeWorkflowEdge(edgeId);
    // 取消选中，关闭面板
    setEdges(eds => eds.map(e => ({ ...e, selected: false })));
  }, [removeWorkflowEdge, setEdges]);
  
  // 处理节点删除 - 删除后取消选中并关闭配置面板
  const handleRemoveNode = useCallback((nodeId: string) => {
    // 先取消选中，关闭配置面板
    selectWorkflowNode(null);
    // 从 store 中删除节点
    removeWorkflowNode(nodeId);
    // 从本地 nodes 状态中移除
    setNodes(nds => nds.filter(n => n.id !== nodeId));
  }, [removeWorkflowNode, setNodes, selectWorkflowNode]);
  
  // 处理连接
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      
      // 确定连接点
      const sourceHandle = (connection.sourceHandle as 'bottom') || 'bottom';
      const targetHandle = (connection.targetHandle as 'top' | 'left') || 'top';
      const edgeType = getEdgeType(sourceHandle, targetHandle);
      
      // 创建新边
      const newEdge: WorkflowEdgeType = {
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        source: connection.source,
        sourceHandle,
        target: connection.target,
        targetHandle,
        createdAt: new Date().toISOString(),
      };
      
      setEdges((eds) => addEdge({
        ...connection,
        id: newEdge.id,
        sourceHandle,
        targetHandle,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color: getEdgeMarkerColor(edgeType) },
        data: { edgeType },
      }, eds));
      
      addWorkflowEdge(newEdge);
    },
    [setEdges, addWorkflowEdge]
  );
  
  // 节点点击
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectWorkflowNode(node.id);
    },
    [selectWorkflowNode]
  );
  
  // 边点击 - 打开编辑面板
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      // 打开边编辑面板
      console.log('Edge clicked:', edge);
    },
    []
  );
  
  // 拖拽放置节点
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      
      const nodeType = event.dataTransfer.getData('application/reactflow') as NodeTypeName;
      if (!nodeType || !reactFlowInstance) return;
      
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      
      // 根据节点类型生成默认名称
      const getNodeDefaultName = (type: NodeTypeName): string => {
        const nameMap: Record<NodeTypeName, string> = {
          agent: '智能体节点',
          milestone: '里程碑',
          department: '部门节点',
          api: 'API节点',
          condition: '条件分支',
          parallel: '并行执行',
          loop: '循环节点',
          delay: '延时节点',
          variable: '变量设置',
          transform: '数据转换',
          output: '输出节点',
          human: '人工审核',
          review: '审核评分',
          notify: '通知节点',
          webhook: 'Webhook',
          email: '邮件节点',
          message: '消息节点',
          group: '分组节点',
        };
        return nameMap[type] || '新节点';
      };
      
      const newNode: WorkflowNodeType = {
        id: `node-${Date.now()}`,
        type: nodeType,
        name: getNodeDefaultName(nodeType),
        position,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config: {},
      };
      
      setNodes((nds) => [
        ...nds,
        {
          id: newNode.id,
          type: 'workflow',
          position,
          data: { ...newNode, agents },
        },
      ]);
      
      addWorkflowNode(newNode);
    },
    [reactFlowInstance, addWorkflowNode, agents]
  );
  
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);
  
  // 获取当前选中的边
  const selectedEdge = edges.find(e => e.selected);
  
  return (
    <div className="w-full h-full bg-gray-900 relative flex" ref={reactFlowWrapper}>
      {/* 左侧工具箱 */}
      <NodeToolbox />
      
      {/* 主画布区域 */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onNodeDragStop={onNodeDragStop}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{
            animated: false,
            type: 'default',
          }}
          connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1e1e2e" gap={20} size={1} />
          <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg" />
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as WorkflowNodeType;
              return data?.type === 'agent' ? '#6366f1' : '#22c55e';
            }}
            maskColor="rgba(10, 10, 15, 0.8)"
            className="!bg-gray-800 !border-gray-700 !rounded-lg"
          />
          
          {/* 工具栏 */}
          <Panel position="top-left">
            <WorkflowToolbar />
          </Panel>
          
          {/* 边编辑面板 */}
          {selectedEdge && (
            <Panel position="top-right">
              <WorkflowEdgePanel 
                edge={selectedEdge}
                onUpdate={handleUpdateEdge}
                onDelete={handleRemoveEdge}
              />
            </Panel>
          )}
        </ReactFlow>
        
        {/* 黑板监控面板 */}
        <div className="absolute bottom-4 left-4 w-80">
          <BlackboardPanel />
        </div>
        
{/* 节点配置面板 */}
      {selectedNode && (
        <div className="absolute top-4 right-4">
          <NodeConfigPanel
            key={selectedNode.id}
            node={selectedNode}
            agents={agents}
            workflowNodes={workflow?.nodes || []}
            onUpdate={updateWorkflowNode}
            onDelete={handleRemoveNode}
            onClose={() => selectWorkflowNode(null)}
          />
        </div>
      )}
      </div>
    </div>
  );
}