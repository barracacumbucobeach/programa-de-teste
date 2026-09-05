import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

// Nenhuma ligação mostra número/asterisco no quadro — o desenho da ligação
// já é a própria regra: liga um balão no outro e ele segue esse caminho,
// sem nada pra digitar ou configurar. Botões nomeados (criados com
// "+ Adicionar botão") são a única forma de dar uma escolha de verdade ao
// cliente, e o número deles já aparece dentro do próprio balão — não
// precisa (e não deve) duplicar esse número aqui na ligação.
export default function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data }) {
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
          className="edge-label edge-label-plain"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            type="button"
            className="edge-delete-btn"
            onClick={(event) => {
              event.stopPropagation();
              data?.onDelete?.();
            }}
            title="Remover esta conexão"
          >
            ✕
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
