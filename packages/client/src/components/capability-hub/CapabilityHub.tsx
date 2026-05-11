import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { CapabilityCard } from './CapabilityCard';
import { useStore } from '../../store/useStore';
import type { Skill } from '../../types';

const nodeTypes = {
  capability: CapabilityCard,
};

function buildNodesAndEdges(skills: Skill[]) {
  const nodes: Node<Skill>[] = [];
  const edges: Edge[] = [];

  // Arrange skills in a hub-like layout (center + orbit, NOT tree!)
  // Find core skills (no dependencies) - these go in the center
  const coreSkills = skills.filter((s) => s.dependencies.length === 0);
  const dependentSkills = skills.filter((s) => s.dependencies.length > 0);

  // Place core skills in the center cluster
  const centerX = 400;
  const centerY = 300;
  coreSkills.forEach((skill, index) => {
    const angle = (index / coreSkills.length) * Math.PI * 2;
    const radius = 80;
    nodes.push({
      id: skill.id,
      type: 'capability',
      position: {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      },
      data: skill,
    });
  });

  // Place dependent skills in outer orbits
  dependentSkills.forEach((skill, index) => {
    const angle = (index / dependentSkills.length) * Math.PI * 2;
    const radius = 200 + (index % 3) * 60; // Multiple orbit rings
    nodes.push({
      id: skill.id,
      type: 'capability',
      position: {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      },
      data: skill,
    });

    // Create edges for dependencies
    skill.dependencies.forEach((depId: string) => {
      edges.push({
        id: `${depId}-${skill.id}`,
        source: depId,
        target: skill.id,
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#f59e0b',
        },
        style: {
          stroke: '#f59e0b',
          strokeWidth: 2,
        },
      });
    });
  });

  return { nodes, edges };
}

export function CapabilityHub() {
  const { skills, selectSkill } = useStore();

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(skills),
    [skills]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectSkill(node.id);
    },
    [selectSkill]
  );

  return (
    <div className="w-full h-full bg-gray-900" style={{ width: '100%', height: '100%' }}>
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
        defaultEdgeOptions={{
          animated: true,
        }}
      >
        <Background color="#1e1e2e" gap={20} size={1} />
        <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg" />
        <MiniMap
          nodeColor={(node) => {
            const skill = node.data as Skill | undefined;
            const colors: Record<string, string> = {
              core: '#6366f1',
              web: '#22c55e',
              data: '#f59e0b',
              ai: '#ec4899',
              system: '#8b5cf6',
            };
            return colors[skill?.category ?? ''] || '#71717a';
          }}
          maskColor="rgba(10, 10, 15, 0.8)"
          className="!bg-gray-800 !border-gray-700 !rounded-lg"
        />
      </ReactFlow>
      </div>
    </div>
  );
}
