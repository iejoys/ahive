import { useStore } from '../../store/useStore';

interface WorkflowListProps {
  onSelect?: (id: string) => void;
  onEdit?: (id: string) => void;
}

export function WorkflowList({ onSelect, onEdit }: WorkflowListProps) {
  const { workflows, currentWorkflowId, setCurrentWorkflow, language } = useStore();
  
  const t = {
    zh: {
      title: '工作流列表',
      empty: '暂无工作流，点击右上角创建',
      nodes: '节点',
      edges: '连接',
      edit: '编辑',
      activate: '激活',
      deactivate: '停用',
    },
    en: {
      title: 'Workflows',
      empty: 'No workflows, click top-right to create',
      nodes: 'Nodes',
      edges: 'Edges',
      edit: 'Edit',
      activate: 'Activate',
      deactivate: 'Deactivate',
    },
  }[language];
  
  if (workflows.length === 0) {
    return (
      <div className="p-4 text-gray-400 text-center">
        {t.empty}
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {workflows.map((workflow) => (
        <div
          key={workflow.id}
          className={`p-3 rounded-lg border transition-colors cursor-pointer ${
            currentWorkflowId === workflow.id
              ? 'bg-indigo-600/20 border-indigo-500'
              : 'bg-gray-800 border-gray-700 hover:border-gray-600'
          }`}
          onClick={() => {
            setCurrentWorkflow(workflow.id);
            onSelect?.(workflow.id);
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium">{workflow.name}</span>
            {workflow.isActive && (
              <span className="text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded">
                {language === 'zh' ? '活动中' : 'Active'}
              </span>
            )}
          </div>
          
          {workflow.description && (
            <p className="text-gray-400 text-sm mb-2">{workflow.description}</p>
          )}
          
          <div className="flex items-center gap-4 text-gray-500 text-xs">
            <span>🤖 {workflow.nodes.length} {t.nodes}</span>
            <span>🔗 {workflow.edges.length} {t.edges}</span>
          </div>
          
          <div className="flex gap-2 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(workflow.id);
              }}
              className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded transition-colors"
            >
              {t.edit}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
