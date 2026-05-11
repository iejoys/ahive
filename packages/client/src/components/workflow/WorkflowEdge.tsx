/**
 * 自定义工作流边组件
 * 解决审核返回线条混乱问题
 */

import { getBezierPath, EdgeLabelRenderer, BaseEdge } from 'reactflow';
import type { EdgeProps } from 'reactflow';

/**
 * 判断边类型
 */
function getEdgeType(
  sourceHandle?: string,
  targetHandle?: string
): 'normal' | 'fail' {
  if (targetHandle === 'left') return 'fail';
  return 'normal';
}

/**
 * 自定义工作流边
 */
export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  sourceHandle,
  targetHandle,
}: EdgeProps) {
  const edgeType = getEdgeType(sourceHandle, targetHandle);
  
  // 失败返回线使用特殊路径
  if (edgeType === 'fail') {
    // 失败返回线：曲线向上绕行
    const [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: 0.5, // 增加曲率让曲线更明显
    });
    
    return (
      <>
        {/* 主线条 - 虚线 */}
        <BaseEdge
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            stroke: '#ef4444',
            strokeWidth: 2,
            strokeDasharray: '8 4', // 虚线
          }}
        />
        {/* 动画光点效果 */}
        <circle r="4" fill="#ef4444">
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
        {/* 标签 */}
        {label && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                fontSize: 11,
                fontWeight: 500,
                backgroundColor: '#1f2937',
                padding: '2px 6px',
                borderRadius: 4,
                color: '#ef4444',
                border: '1px solid #ef4444',
              }}
              className="nodrag nopan"
            >
              {label}
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    );
  }
  
  // 正常流程线：直线或轻微曲线
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.2,
  });
  
  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: '#6366f1',
          strokeWidth: 2,
        }}
      />
      {/* 正向流程动画光点 */}
      <circle r="3" fill="#6366f1" opacity="0.6">
        <animateMotion
          dur="3s"
          repeatCount="indefinite"
          path={edgePath}
        />
      </circle>
      {/* 标签 */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 11,
              fontWeight: 500,
              backgroundColor: '#1f2937',
              padding: '2px 6px',
              borderRadius: 4,
              color: '#6366f1',
              border: '1px solid #6366f1',
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * 里程碑内部边样式
 * 用于二级节点之间的连接
 */
export function MilestoneEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  sourceHandle,
  targetHandle,
}: EdgeProps) {
  const edgeType = getEdgeType(sourceHandle, targetHandle);
  
  // 里程碑内部的失败返回线
  if (edgeType === 'fail') {
    // 使用更紧凑的曲线路径
    const [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY: sourceY - 20, // 向上偏移起点
      sourcePosition,
      targetX,
      targetY: targetY - 20, // 向上偏移终点
      targetPosition,
      curvature: 0.4,
    });
    
    return (
      <>
        <BaseEdge
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            stroke: '#f97316', // 橙色，区别于红色
            strokeWidth: 1.5,
            strokeDasharray: '5 3',
          }}
        />
        {label && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                fontSize: 10,
                backgroundColor: '#1f2937',
                padding: '1px 4px',
                borderRadius: 3,
                color: '#f97316',
                border: '1px solid #f97316',
              }}
              className="nodrag nopan"
            >
              {label}
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    );
  }
  
  // 里程碑内部正常流程
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.15,
  });
  
  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: '#10b981', // 绿色，里程碑主题色
          strokeWidth: 1.5,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 10,
              backgroundColor: '#1f2937',
              padding: '1px 4px',
              borderRadius: 3,
              color: '#10b981',
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}