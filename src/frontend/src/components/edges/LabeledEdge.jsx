import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

export default function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: '#3b4a6b', strokeWidth: 2 }} />
      <EdgeLabelRenderer>
        <div
          className="edge-label"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <input
            value={data?.trigger ?? ''}
            onChange={(event) => data?.onChange?.(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            placeholder="gatilho"
            className="edge-label-input"
            title="Texto que o cliente deve digitar para seguir por este caminho"
          />
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
