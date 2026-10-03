import { memo, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  type NodeProps,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { isContainer, type Entry } from './json';

interface CardData {
  entry: Entry;
  properties: Entry[];
  active: string | null;
  select: (path: string) => void;
}
const Card = memo(({ data }: NodeProps<CardData>) => (
  <div className={`graph-card ${data.active === data.entry.path ? 'selected' : ''}`}>
    <button className="graph-card-title" onClick={() => data.select(data.entry.path)}>
      <span>{data.entry.type === 'array' ? '[ ]' : '{ }'}</span>
      <strong>{data.entry.parts.at(-1) ?? 'document'}</strong>
      <small>{data.entry.count}</small>
    </button>
    <div className="graph-properties nodrag nowheel">
      {data.properties.map((entry, i) => (
        <button
          key={`${entry.path}-${i}`}
          className={data.active === entry.path ? 'active' : ''}
          onClick={() => data.select(entry.path)}
        >
          <span title={String(entry.parts.at(-1))}>{entry.parts.at(-1)}</span>
          <span className={`value-${entry.type}`} title={entry.value}>
            {entry.value}
          </span>
          {entry.type === 'string' && /^#([a-fA-F0-9]{3}){1,2}$/.test(entry.value) && (
            <i className="color-swatch" style={{ background: entry.value }} />
          )}
        </button>
      ))}
      {!data.properties.length && <p>Empty {data.entry.type}</p>}
    </div>
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
  </div>
));
const nodeTypes = { json: Card };
export function graphLayout(entries: Entry[]) {
  const containers = entries.filter(isContainer);
  const groups = new Map<string, Entry[]>();
  for (const entry of entries)
    if (entry.parent !== null) {
      if (!groups.has(entry.parent)) groups.set(entry.parent, []);
      groups.get(entry.parent)!.push(entry);
    }
  const positions = new Map<string, { x: number; y: number }>();
  let y = 0;
  function visit(entry: Entry, depth: number) {
    const children = (groups.get(entry.path) || []).filter(isContainer);
    const height = 48 + Math.min(7, entry.count) * 28;
    const start = y;
    for (const child of children) visit(child, depth + 1);
    y = Math.max(y, start + height + 40);
    positions.set(entry.path, { x: depth * 320, y: (start + y - height - 40) / 2 });
  }
  if (containers[0]) visit(containers[0], 0);
  return { containers, groups, positions };
}
function Canvas({
  entries,
  active,
  select,
}: {
  entries: Entry[];
  active: string | null;
  select: (path: string) => void;
}) {
  const { fitView } = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => graphLayout(entries), [entries]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardData>([]);
  const activeRef = useRef(active),
    selectRef = useRef(select);
  activeRef.current = active;
  selectRef.current = select;
  useEffect(() => {
    setNodes(
      layout.containers.map((entry) => ({
        id: entry.path || 'root',
        type: 'json',
        position: layout.positions.get(entry.path)!,
        data: {
          entry,
          properties: layout.groups.get(entry.path) || [],
          active: activeRef.current,
          select: (path) => selectRef.current(path),
        },
      })),
    );
  }, [layout, setNodes]);
  useEffect(() => {
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, active } })));
  }, [active, setNodes]);
  const edges: Edge[] = useMemo(
    () =>
      layout.containers
        .filter((entry) => entry.parent !== null)
        .map((entry) => ({
          id: entry.path,
          source: entry.parent || 'root',
          target: entry.path,
          type: 'smoothstep',
          style: {
            stroke:
              active === entry.path || active?.startsWith(entry.path + '/') ? '#b5d68b' : '#525d57',
            strokeWidth: 1.5,
          },
        })),
    [layout, active],
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const fit = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fitView({ padding: 0.15, maxZoom: 0.9, minZoom: 0.04 }), 120);
    };
    const observer = new ResizeObserver(fit);
    if (canvas.current) observer.observe(canvas.current);
    fit();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [layout, fitView]);
  return (
    <div ref={canvas} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.04}
        maxZoom={2}
        onlyRenderVisibleElements
      >
        <Background color="#344039" gap={24} />
        <Controls />
        <div className="graph-caption">
          {nodes.length} containers <span>Scroll to zoom · drag to pan</span>
        </div>
      </ReactFlow>
    </div>
  );
}
export default function Graph(props: {
  entries: Entry[];
  active: string | null;
  select: (path: string) => void;
}) {
  const containers = props.entries.filter(isContainer);
  if (containers.length > 400)
    return (
      <div className="empty-state">
        <strong>Use the explorer for this document</strong>
        <p>
          The graph supports up to 400 containers to keep navigation smooth. All values are
          available in the explorer and exports.
        </p>
      </div>
    );
  if (!containers.length)
    return (
      <div className="empty-state">
        <strong>{props.entries.length ? 'A single value' : 'Your structure, at a glance'}</strong>
        <p>
          {props.entries.length
            ? 'Select the root value in the explorer. Objects and arrays appear here as connected cards.'
            : 'Add an object or array to see its connections.'}
        </p>
      </div>
    );
  if (new Set(props.entries.map((entry) => entry.path)).size !== props.entries.length)
    return (
      <div className="empty-state">
        <strong>Duplicate keys need a closer look</strong>
        <p>Use the explorer to inspect this document. The graph requires unique paths.</p>
      </div>
    );
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
