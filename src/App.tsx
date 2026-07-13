/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { 
  Copy, Check, Info, Trash2, Code2, AlertCircle, ListTree, Crosshair, 
  GripHorizontal, Settings2, ChevronRight, ChevronDown, Folder, 
  FileJson, PlusSquare, MinusSquare, Box, Layers, FileSpreadsheet, Download,
  Network, Maximize2, Minimize2, Eye, EyeOff
} from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { parse } from 'json-source-map';
import { utils, writeFile } from 'xlsx';
import ReactFlow, { 
  Background, 
  Controls, 
  Panel,
  MarkerType,
  Position,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Handle,
  ReactFlowProvider,
  useReactFlow
} from 'reactflow';

const JsonNode = ({ data, selected }: { data: any, selected?: boolean }) => {
  const isColor = (val: any) => typeof val === 'string' && /^#([A-Fa-f0-9]{3}){1,2}$/.test(val);
  
  return (
    <div 
      className={`min-w-[240px] rounded-lg border shadow-2xl overflow-hidden transition-all duration-300 ${selected ? 'ring-2 ring-blue-500 border-blue-400 scale-[1.02]' : 'border-neutral-800 bg-[#1a1a1a]'}`}
      onClick={() => {
        if (data.onPathClick) data.onPathClick(data.path);
      }}
    >
      <div className={`px-3 py-2 border-b flex items-center justify-between font-mono ${selected ? 'bg-blue-600/20 text-blue-200 border-blue-500/30' : 'bg-[#222] text-neutral-400 border-neutral-800'}`}>
        <div className="flex items-center gap-2">
          {data.type === 'Array' ? <Layers size={13} className="text-purple-400" /> : <Box size={13} className="text-blue-400" />}
          <span className="text-[11px] font-bold tracking-tight truncate max-w-[120px] uppercase">{data.label || 'root'}</span>
        </div>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/30 text-neutral-500 border border-white/5 uppercase tracking-wider">{data.type}</span>
      </div>
      
      <div className="p-1.5 space-y-0.5 max-h-[350px] overflow-auto custom-scrollbar-dark">
        {data.properties && data.properties.map((prop: any, i: number) => (
          <div 
            key={i} 
            onClick={(e) => {
              e.stopPropagation();
              if (data.onPathClick) data.onPathClick(prop.path);
            }}
            className={`flex flex-col gap-0.5 px-2 py-1.5 rounded text-[10px] group transition-all duration-200 border border-transparent cursor-pointer ${data.activePath === prop.path ? 'bg-blue-500/10 border-blue-500/30' : 'hover:bg-white/5'}`}
          >
            <div className="flex items-center justify-between gap-3">
               <span className={`font-mono font-medium truncate ${data.activePath === prop.path ? 'text-blue-400' : 'text-neutral-400 group-hover:text-neutral-300'}`}>{prop.key}</span>
               {isColor(prop.value) ? (
                 <div className="w-3 h-3 rounded-sm border border-white/10 shadow-sm" style={{ backgroundColor: prop.value }} />
               ) : (
                 <span className="text-[8px] text-neutral-600 font-mono uppercase opacity-40">{prop.type}</span>
               )}
            </div>
            {!prop.isContainer ? (
              <span className={`text-[10px] truncate max-w-[200px] font-mono ${
                data.activePath === prop.path 
                  ? 'text-blue-300' 
                  : typeof prop.value === 'number' ? 'text-orange-400'
                  : typeof prop.value === 'boolean' ? 'text-pink-400'
                  : 'text-neutral-500'
              }`}>
                {String(prop.value)}
              </span>
            ) : (
              <span className="text-[9px] text-neutral-600 font-mono italic opacity-40">
                {String(prop.value).split(' ')[1]} {String(prop.value).split(' ')[0]}
              </span>
            )}
          </div>
        ))}
        {(!data.properties || data.properties.length === 0) && (
          <div className="px-3 py-6 text-center opacity-10 italic text-[10px] text-neutral-400">Empty Container</div>
        )}
      </div>
      
      {/* Handles for connections */}
      <Handle type="target" position={Position.Left} className="!w-1.5 !h-1.5 !bg-blue-500 !border-none" />
      <Handle type="source" position={Position.Right} className="!w-1.5 !h-1.5 !bg-blue-500 !border-none" />
    </div>
  );
};

const nodeTypes = {
  jsonNode: JsonNode
};

function JSONGraph({ paths, activePath, onPathClick }: { paths: PathEntry[], activePath: string | null, onPathClick: (path: string) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;
  const onPathClickRef = useRef(onPathClick);
  onPathClickRef.current = onPathClick;

  useEffect(() => {
    const activePath = activePathRef.current;
    const onPathClick = (path: string) => onPathClickRef.current(path);
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    
    // Group properties by their parent path to form object nodes
    const containerNodes = paths.filter(p => typeof p.value === 'string' && (p.value.startsWith('Object') || p.value.startsWith('Array')));
    const depthLevels: Record<number, number> = {};

    containerNodes.forEach((container) => {
      const properties = paths.filter(p => {
        const pPath = p.path;
        const cPath = container.path;
        if (pPath === cPath) return false;
        
        const lastSlash = pPath.lastIndexOf('/');
        const parentPath = lastSlash === -1 ? "" : pPath.substring(0, lastSlash);
        return parentPath === cPath;
      }).map(p => ({
        key: p.parts[p.parts.length - 1],
        value: p.value,
        path: p.path,
        type: typeof p.value === 'string' && (p.value.startsWith('Object') || p.value.startsWith('Array')) 
          ? (p.value.startsWith('Array') ? 'Array' : 'Object') 
          : typeof p.value,
        isContainer: typeof p.value === 'string' && (p.value.startsWith('Object') || p.value.startsWith('Array'))
      }));

      const depth = container.parts.length;
      if (!depthLevels[depth]) depthLevels[depth] = 0;
      const yOffset = depthLevels[depth] * 380;
      depthLevels[depth]++;

      newNodes.push({
        id: container.path,
        type: 'jsonNode',
        data: {
          label: container.parts.length > 0 ? String(container.parts[container.parts.length - 1]) : 'root',
          type: container.value.startsWith('Array') ? 'Array' : 'Object',
          properties,
          activePath,
          path: container.path,
          onPathClick
        },
        position: { x: depth * 550, y: yOffset },
      });

      if (depth > 0) {
        const lastSlash = container.path.lastIndexOf('/');
        const parentPath = lastSlash === -1 ? "" : container.path.substring(0, lastSlash);
        
        newEdges.push({
          id: `e-${parentPath}-${container.path}`,
          source: parentPath,
          target: container.path,
          label: String(container.parts[container.parts.length - 1]),
          labelStyle: { fill: '#60a5fa', fontSize: 9, fontWeight: 700, fontFamily: 'monospace' },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: '#1a1a1a', fillOpacity: 0.95 },
          style: { 
            stroke: activePath?.startsWith(container.path) ? '#3b82f6' : '#262626', 
            strokeWidth: activePath?.startsWith(container.path) ? 3 : 2,
            filter: activePath?.startsWith(container.path) ? 'drop-shadow(0 0 10px #3b82f6)' : 'none'
          },
          animated: activePath?.startsWith(container.path),
          markerEnd: { 
            type: MarkerType.ArrowClosed, 
            color: activePath?.startsWith(container.path) ? '#3b82f6' : '#262626',
            width: 15,
            height: 15
          },
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);

    const t = setTimeout(() => {
      fitView({ padding: 0.4, duration: 1000 });
    }, 100);
    return () => clearTimeout(t);
  }, [paths, fitView, setNodes, setEdges]);

  // Cheap highlight sync: update styles in place instead of rebuilding the graph
  useEffect(() => {
    setNodes(nds => nds.map(n => (
      n.data.activePath === activePath ? n : { ...n, data: { ...n.data, activePath } }
    )));
    setEdges(eds => eds.map(e => {
      const isActive = !!activePath?.startsWith(e.target);
      return {
        ...e,
        style: {
          stroke: isActive ? '#3b82f6' : '#262626',
          strokeWidth: isActive ? 3 : 2,
          filter: isActive ? 'drop-shadow(0 0 10px #3b82f6)' : 'none'
        },
        animated: isActive,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isActive ? '#3b82f6' : '#262626',
          width: 15,
          height: 15
        },
      };
    }));
  }, [activePath, paths, setNodes, setEdges]);

  return (
    <div className="w-full h-full bg-[#121212]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.01}
        maxZoom={1.5}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
      >
        <Background color="#333" gap={30} size={1} />
        <Controls position="bottom-right" className="!bg-neutral-900 !border-neutral-800 !shadow-2xl grayscale invert" />
        <Panel position="top-left" className="bg-black/40 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center">
              <Network size={14} className="text-blue-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Visual Graph</span>
              <span className="text-[8px] font-mono text-neutral-500">Interactive JSON Deep-Dive</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function JSONGraphWrapper(props: any) {
  return (
    <ReactFlowProvider>
      <JSONGraph {...props} />
    </ReactFlowProvider>
  );
}

const getActivePointer = (pointers: any, line: number, column: number) => {
  let bestMatch = null;
  let deepest = -1;

  for (const [path, info] of Object.entries<any>(pointers)) {
    const { key, value, valueEnd } = info;
    
    // Check if the cursor is within the key or value range
    const isWithin = (start: any, end: any) => {
      if (!start || !end) return false;
      if (line < start.line || line > end.line) return false;
      if (line === start.line && column < start.column) return false;
      if (line === end.line && column > end.column) return false;
      return true;
    };

    if (isWithin(key, valueEnd) || isWithin(value, valueEnd)) {
      const depth = path.split('/').length;
      if (depth > deepest) {
        deepest = depth;
        bestMatch = path;
      }
    }
  }
  return bestMatch;
};

const INITIAL_JSON = `{
  "welcome": "to JSON Prettify",
  "features": [
    "live formatting",
    "validation markers",
    "one-click copy",
    "minimalist UI"
  ],
  "isSimple": true,
  "count": 42
}`;

interface PathEntry {
  path: string;
  parts: (string | number)[];
  value: any;
  displayPath: string;
}

const toJsonPointer = (parts: (string | number)[]) => {
  if (parts.length === 0) return '/';
  return '/' + parts.map(p => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
};

const toJsonPath = (parts: (string | number)[]) => {
  if (parts.length === 0) return '$';
  let path = '$';
  parts.forEach(part => {
    if (typeof part === 'number') {
      path += `[${part}]`;
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
      path += `.${part}`;
    } else {
      path += `['${part.replace(/'/g, "\\'")}']`;
    }
  });
  return path;
};

const toJsPath = (parts: (string | number)[]) => {
  if (parts.length === 0) return '';
  let path = '';
  parts.forEach((part, i) => {
    if (typeof part === 'number') {
      path += `[${part}]`;
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
      if (i === 0) path += part;
      else path += `.${part}`;
    } else {
      path += `['${part.replace(/'/g, "\\'")}']`;
    }
  });
  return path;
};

const parsePointer = (pointer: string): (string | number)[] => {
  if (pointer === '/' || pointer === '') return [];
  return pointer.split('/').slice(1).map(part => {
    const p = part.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^\d+$/.test(p) ? parseInt(p, 10) : p;
  });
};

type PaneType = 'input' | 'output' | 'paths' | 'graph';

const PaneWrapper = ({ type, paneWidths, collapsedPanes, setCollapsedPanes, startResizing, renderPane }: any) => {
  const isCollapsed = collapsedPanes.has(type);
  const controls = useDragControls();

  return (
    <Reorder.Item 
      key={type}
      value={type}
      dragListener={false}
      dragControls={controls}
      data-pane={type}
      className={`h-full bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col relative group ${isCollapsed ? 'flex-none' : 'mx-2'}`}
      style={{
        width: isCollapsed ? '48px' : `${paneWidths[type]}%`, 
        minWidth: isCollapsed ? '48px' : '200px' 
      }}
    >
      <div className="h-full w-full">
        {renderPane(type, controls)}
      </div>
      
      {!isCollapsed && (
        <div 
          onPointerDown={(e) => startResizing(type, e)}
          className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize hover:bg-neutral-900/10 active:bg-neutral-900 transition-colors z-30 flex items-center justify-center"
        >
          <div className="w-[1px] h-4 bg-neutral-200" />
        </div>
      )}
    </Reorder.Item>
  );
};

export default function App() {
  const [input, setInput] = useState(INITIAL_JSON);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'key' | 'value' | null>(null);
  const [paths, setPaths] = useState<PathEntry[]>([]);
  const [sourceMap, setSourceMap] = useState<any>(null);
  const [outputSourceMap, setOutputSourceMap] = useState<any>(null);
  const [paneOrder, setPaneOrder] = useState<PaneType[]>(['input', 'output', 'paths']);
  const [collapsedPanes, setCollapsedPanes] = useState<Set<PaneType>>(new Set());
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pathListRef = useRef<HTMLDivElement>(null);
  const activePathRef = useRef<HTMLButtonElement>(null);
  const outputPreRef = useRef<HTMLDivElement>(null);

  const formatJSON = useCallback((val: string) => {
    if (!val.trim()) {
      setOutput('');
      setError(null);
      setPaths([]);
      setSourceMap(null);
      setOutputSourceMap(null);
      return;
    }
    try {
      const parsed = JSON.parse(val);
      const formatted = JSON.stringify(parsed, null, 2);
      setOutput(formatted);
      setError(null);

      const outMap = parse(formatted);
      setOutputSourceMap(outMap);

      const newPaths: PathEntry[] = [];
      const walk = (obj: any, currentPath: string = '', currentParts: (string | number)[] = []) => {
        const entryPath = currentPath || '';
        if (obj && typeof obj === 'object') {
          newPaths.push({
            path: entryPath,
            parts: currentParts,
            value: Array.isArray(obj) ? `Array(${obj.length})` : 'Object',
            displayPath: entryPath || '/'
          });

          Object.entries(obj).forEach(([key, value]) => {
            const nextPath = `${currentPath}/${key}`;
            const nextParts = [...currentParts, Array.isArray(obj) ? parseInt(key, 10) : key];
            walk(value, nextPath, nextParts);
          });
        } else {
          newPaths.push({
            path: entryPath,
            parts: currentParts,
            value: String(obj),
            displayPath: entryPath || '/'
          });
        }
      };

      walk(parsed);
      setPaths(newPaths);

      const map = parse(val);
      setSourceMap(map);

    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Invalid JSON format');
      }
      setOutput('');
      setPaths([]);
      setSourceMap(null);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => formatJSON(input), 120);
    return () => clearTimeout(t);
  }, [input, formatJSON]);

  const getCharIndex = (line: number, column: number, text: string) => {
    const lines = text.split('\n');
    let index = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      index += lines[i].length + 1;
    }
    return index + column;
  };

  const [highlightBox, setHighlightBox] = useState<{ top: number; height: number } | null>(null);
  const [rowCopiedIdx, setRowCopiedIdx] = useState<number | null>(null);

  const syncOutputHighlight = useCallback((path: string | null) => {
    if (path === null || !outputSourceMap || !outputPreRef.current || !output) {
      setHighlightBox(null);
      return;
    }

    const outPointer = outputSourceMap.pointers[path];
    if (outPointer) {
      const startLine = outPointer.value.line;
      const endLine = outPointer.valueEnd.line;
      const lineCount = endLine - startLine + 1;
      
      const outputLineHeight = 20; 
      setHighlightBox({
        top: startLine * outputLineHeight + 24, 
        height: lineCount * outputLineHeight
      });

      // Handle scrolling separately to ensure it doesn't block re-renders
      const outTargetScroll = startLine * outputLineHeight - outputPreRef.current.clientHeight / 2 + 10;
      outputPreRef.current.scrollTo({
        top: Math.max(0, outTargetScroll),
        behavior: 'auto'
      });
    } else {
      setHighlightBox(null);
    }
  }, [outputSourceMap, output]);

  const handleCursorMove = useCallback(() => {
    if (!textareaRef.current || !sourceMap) return;

    // Use requestAnimationFrame to ensure we read the selection AFTER the browser updates it
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      
      const selectionStart = textareaRef.current.selectionStart;
      const val = textareaRef.current.value;
      const lines = val.substring(0, selectionStart).split('\n');
      const line = lines.length - 1;
      const column = lines[lines.length - 1].length;

      const foundPointer = getActivePointer(sourceMap.pointers, line, column);
      
      if (foundPointer !== null) {
        setActivePath(foundPointer);
        const pointerData = sourceMap.pointers[foundPointer];
        
        if (pointerData.key && pointerData.keyEnd) {
          const isBeforeValue = (line < pointerData.value.line) || (line === pointerData.value.line && column < pointerData.value.column);
          const isAfterKeyStart = (line > pointerData.key.line) || (line === pointerData.key.line && column >= pointerData.key.column);
          
          if (isAfterKeyStart && isBeforeValue) {
            setActiveSection('key');
          } else {
            setActiveSection('value');
          }
        } else {
          setActiveSection('value');
        }
      } else {
        setActivePath(null);
        setActiveSection(null);
        setHighlightBox(null);
      }
    });
  }, [sourceMap]);

  useEffect(() => {
    handleCursorMove();
  }, [handleCursorMove, input]);

  useEffect(() => {
    if (activePath !== null && activePathRef.current && pathListRef.current) {
      const target = activePathRef.current;
      target.scrollIntoView({
        behavior: 'auto',
        block: 'nearest'
      });
    }
  }, [activePath]);

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleClear = () => setInput('');
  const handleExample = () => setInput(INITIAL_JSON);

  const scrollToPathInEditor = (path: string) => {
    if (!sourceMap || !textareaRef.current) return;
    const pointer = sourceMap.pointers[path];
    if (pointer) {
      setActivePath(path);
      setActiveSection('value');

      const val = textareaRef.current.value;
      const start = getCharIndex(pointer.value.line, pointer.value.column, val);
      const end = getCharIndex(pointer.valueEnd.line, pointer.valueEnd.column, val);
      
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start, end);
      
      const lineHeight = 20;
      const targetScroll = pointer.value.line * lineHeight - textareaRef.current.clientHeight / 2 + 10;
      textareaRef.current.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'auto'
      });

      // Explicitly sync output even if activePath is same
      syncOutputHighlight(path);
    }
  };

  useEffect(() => {
    syncOutputHighlight(activePath);
  }, [activePath, outputSourceMap, syncOutputHighlight]);

  const [paneWidths, setPaneWidths] = useState<Record<PaneType, number>>({
    input: 30,
    output: 35,
    paths: 35,
    graph: 35
  });

  const resizingRef = useRef<{ type: PaneType; startX: number; clientX: number; startWidth: number; lastWidth: number; frame: number } | null>(null);

  const startResizing = (type: PaneType, e: any) => {
    e.preventDefault();
    resizingRef.current = {
      type,
      startX: e.clientX,
      clientX: e.clientX,
      startWidth: paneWidths[type],
      lastWidth: paneWidths[type],
      frame: 0
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', stopResizing);
    document.body.style.cursor = 'col-resize';
  };

  // During the drag, write widths straight to the DOM (rAF-throttled) so the
  // whole app doesn't re-render on every pointermove; commit to state on release.
  const handlePointerMove = (e: PointerEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    r.clientX = e.clientX;
    if (r.frame) return;
    r.frame = requestAnimationFrame(() => {
      r.frame = 0;
      const deltaX = r.clientX - r.startX;
      const containerWidth = document.querySelector('main')?.clientWidth || 1000;
      const deltaPercent = (deltaX / containerWidth) * 100;
      r.lastWidth = Math.max(15, Math.min(70, r.startWidth + deltaPercent));
      const el = document.querySelector(`[data-pane="${r.type}"]`) as HTMLElement | null;
      if (el) el.style.width = `${r.lastWidth}%`;
    });
  };

  const stopResizing = () => {
    const r = resizingRef.current;
    if (r) {
      if (r.frame) cancelAnimationFrame(r.frame);
      setPaneWidths(prev => ({ ...prev, [r.type]: r.lastWidth }));
    }
    resizingRef.current = null;
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', stopResizing);
    document.body.style.cursor = '';
  };

  const [showShortcutPopup, setShowShortcutPopup] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const [showAllPathFormats, setShowAllPathFormats] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');

  const toggleCollapse = useCallback((path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = () => setCollapsedPaths(new Set());
  const collapseAll = () => {
    const allObjectPaths = paths
      .filter(p => typeof p.value === 'string' && (p.value.startsWith('Object') || p.value.startsWith('Array')))
      .map(p => p.path);
    setCollapsedPaths(new Set(allObjectPaths));
  };

  const handleExport = () => {
    if (paths.length === 0) return;
    
    const data = paths.map(p => {
      const isContainer = typeof p.value === 'string' && (p.value.startsWith('Object') || p.value.startsWith('Array'));
      
      return {
        'Level': p.parts.length,
        'Field Name': p.parts.length > 0 ? String(p.parts[p.parts.length - 1]) : 'root',
        'Type': isContainer ? (p.value.startsWith('Array') ? 'Array' : 'Object') : 'Scalar',
        'Sample Value': isContainer ? '' : p.value,
        'JSONPath Reference': toJsonPath(p.parts),
        'JSON Pointer': toJsonPointer(p.parts),
        'Requirement ID': '',
        'Mapping Target': '',
        'Business Rule / Logic': '',
        'Description': '',
      };
    });
    
    // Sort by path to maintain hierarchical order in Excel
    const sortedData = [...data].sort((a, b) => a['JSON Pointer'].localeCompare(b['JSON Pointer']));

    const worksheet = utils.json_to_sheet(sortedData);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Data_Mapping_IRD');
    
    // Auto-calculate column widths
    const colWidths = Object.keys(sortedData[0] || {}).map(key => {
      const maxLen = Math.max(
        key.length,
        ...sortedData.map(row => String((row as any)[key]).length)
      );
      return { wch: Math.min(maxLen + 4, 60) };
    });
    worksheet['!cols'] = colWidths;

    // Apply some basic header styling if possible (SheetJS basic doesn't support complex styles easily without extra plugins, 
    // but we can ensure the data is clean)

    writeFile(workbook, `IRD_Mapping_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcutPopup(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const copyPathToClipboard = () => {
    if (activePath) {
      navigator.clipboard.writeText(activePath);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    }
  };

  const filteredPaths = useMemo(() => paths.filter(p => {
    if (viewMode === 'list') return true;
    if (p.path === '') return true; // Always show root
    const parts = p.path.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const parent = '/' + parts.slice(0, i).join('/');
      if (collapsedPaths.has(parent)) return false;
    }
    return true;
  }), [paths, viewMode, collapsedPaths]);

  const renderPane = (type: PaneType, dragControls: any) => {
    const isCollapsed = collapsedPanes.has(type);

    if (isCollapsed) {
      return (
        <div className="h-full flex flex-col items-center py-4 bg-neutral-50 border-r border-neutral-100 min-w-[48px] w-[48px]">
          <button 
            onClick={() => setCollapsedPanes(prev => {
              const next = new Set(prev);
              next.delete(type);
              return next;
            })}
            className="p-2 rounded-lg hover:bg-neutral-200 text-neutral-600 mb-6"
            title={`Expand ${type}`}
          >
            <Maximize2 size={16} />
          </button>
          <div className="flex-1 [writing-mode:vertical-lr] rotate-180 flex items-center justify-center">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 select-none">{type}</span>
          </div>
        </div>
      );
    }

    const handleProps = {
      className: "h-10 px-4 flex items-center border-b border-neutral-100 bg-neutral-50/50 group/header cursor-default",
    };

    switch (type) {
      case 'input':
        return (
          <div className="h-full flex flex-col bg-white overflow-hidden" id="input-pane">
            <div {...handleProps}>
               <div 
                className="flex items-center flex-1 cursor-grab active:cursor-grabbing h-full"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <GripHorizontal size={14} className="text-neutral-400 mr-2 group-hover/header:text-neutral-600 transition-colors" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 group-hover/header:text-neutral-900 transition-colors">Input</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                 <button 
                    onClick={() => setCollapsedPanes(prev => new Set(prev).add('input'))}
                    className="p-1 rounded text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                    title="Collapse"
                  >
                    <Minimize2 size={12} />
                  </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden relative flex flex-col">
              <div className={`h-9 border-b border-neutral-100 flex items-center px-4 gap-2 flex-shrink-0 transition-colors duration-300 ${activePath !== null ? 'bg-neutral-50/50' : 'bg-transparent'}`}>
                {activePath !== null ? (
                  <>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-tighter shrink-0">Path</span>
                      <span className="font-mono text-[10px] text-neutral-600 truncate bg-white px-1.5 py-0.5 rounded border border-neutral-200/50 shadow-sm">
                        {activePath === '' ? '/' : activePath}
                      </span>
                    </div>
                    <button 
                      onClick={copyPathToClipboard}
                      className="p-1 px-2 rounded-md hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1.5 shrink-0 group"
                      title="Copy Full Path"
                    >
                      <AnimatePresence mode="wait">
                        {pathCopied ? (
                          <motion.div key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
                            <Check size={12} className="text-green-500" />
                          </motion.div>
                        ) : (
                          <motion.div key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
                            <Copy size={12} className="text-neutral-400 group-hover:text-current" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <span className="text-[10px] font-bold uppercase tracking-tight">{pathCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </>
                ) : (
                  <span className="text-[9px] font-bold text-neutral-400/50 uppercase tracking-tighter">No entry selected</span>
                )}
              </div>
              <div className="flex-1 relative">
                <AnimatePresence>
                  {showShortcutPopup && activePath !== null && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-neutral-900 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 border border-white/10 backdrop-blur-xl"
                    >
                      <div className="flex flex-col">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-neutral-400 leading-none mb-1">Current Path</span>
                        <span className="font-mono text-xs truncate max-w-[200px]">{activePath === '' ? '/' : activePath}</span>
                      </div>
                      <div className="h-6 w-px bg-white/10" />
                      <button 
                        onClick={copyPathToClipboard}
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2 group"
                      >
                        {pathCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-neutral-300 group-hover:text-white" />}
                        <span className="text-[10px] font-bold uppercase tracking-wider">{pathCopied ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button 
                        onClick={() => setShowShortcutPopup(false)}
                        className="p-1 hover:bg-white/10 rounded-full text-neutral-500 hover:text-white"
                      >
                        <Trash2 size={12} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setHighlightBox(null);
                  }}
                  onPointerUp={handleCursorMove}
                  onKeyUp={handleCursorMove}
                  onFocus={handleCursorMove}
                  onSelect={handleCursorMove}
                  spellCheck={false}
                  autoFocus
                  className="absolute inset-0 w-full h-full p-6 font-mono text-sm border-none focus:ring-0 focus:outline-none bg-transparent placeholder:text-neutral-300 custom-scrollbar resize-none overflow-auto leading-[20px] caret-neutral-900 selection:bg-blue-500/30"
                  placeholder='Paste your raw JSON here...'
                  id="input-textarea"
                />
              </div>
            </div>
          </div>
        );
      case 'output':
        return (
          <div className="h-full flex flex-col bg-neutral-50/10 overflow-hidden" id="output-pane">
            <div {...handleProps}>
              <div 
                className="flex items-center flex-1 cursor-grab active:cursor-grabbing h-full"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <GripHorizontal size={14} className="text-neutral-400 mr-2 group-hover/header:text-neutral-600 transition-colors" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 group-hover/header:text-neutral-900 transition-colors">Prettified</span>
              </div>
              <div className="flex items-center gap-2">
                 <AnimatePresence>
                  {copied && (
                    <motion.span initial={{ opacity: 0, x: 5 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                      Copied!
                    </motion.span>
                  )}
                </AnimatePresence>
                <button
                  onClick={handleCopy}
                  disabled={!output}
                  className={`p-1.5 rounded transition-all duration-200 ${output ? 'text-neutral-600 hover:text-neutral-900' : 'text-neutral-300 cursor-not-allowed'}`}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button 
                  onClick={() => setCollapsedPanes(prev => new Set(prev).add('output'))}
                  className="p-1 rounded text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                  title="Collapse"
                >
                  <Minimize2 size={12} />
                </button>
              </div>
            </div>
              <div className={`h-9 border-b border-neutral-100 flex items-center px-6 shrink-0 transition-colors duration-300 ${activePath !== null ? 'bg-neutral-50/50' : 'bg-transparent'}`}>
                {activePath !== null ? (
                  <>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-tighter shrink-0">JSONPath</span>
                      <span className="font-mono text-[10px] text-blue-600 truncate bg-white px-1.5 py-0.5 rounded border border-blue-100 shadow-sm">
                        {toJsonPath(parsePointer(activePath))}
                      </span>
                    </div>
                    <button 
                      onClick={() => {
                        const jp = toJsonPath(parsePointer(activePath));
                        navigator.clipboard.writeText(jp);
                        setCopied(true); // Reusing copied state for feedback
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="p-1 px-2 rounded-md hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1.5 shrink-0 group"
                      title="Copy JSONPath"
                    >
                      <AnimatePresence mode="wait">
                        {copied ? (
                          <motion.div key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
                            <Check size={12} className="text-green-500" />
                          </motion.div>
                        ) : (
                          <motion.div key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
                            <Copy size={12} className="text-neutral-400 group-hover:text-current" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <span className="text-[10px] font-bold uppercase tracking-tight">{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </>
                ) : (
                  <span className="text-[9px] font-bold text-neutral-400/50 uppercase tracking-tighter">No node selected</span>
                )}
              </div>
              <div ref={outputPreRef} className="flex-1 overflow-auto p-6 font-mono text-sm custom-scrollbar relative">
              <AnimatePresence mode="wait">
                {error ? (
                  <motion.div key="error" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto">
                    <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500 mb-4"><AlertCircle size={20} /></div>
                    <h3 className="text-sm font-semibold text-neutral-900 mb-1">Invalid JSON</h3>
                    <p className="text-xs text-neutral-500 leading-relaxed font-sans">{error}</p>
                  </motion.div>
                ) : output ? (
                  <div className="relative">
                    {highlightBox && (
                      <motion.div 
                        initial={{ opacity: 0, scaleX: 0.95 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        className="absolute inset-x-0 bg-blue-500/10 border-l-2 border-blue-500 pointer-events-none z-0"
                        style={{ 
                          top: highlightBox.top - 24, // subtract padding to align with text
                          height: highlightBox.height 
                        }}
                      />
                    )}
                    <motion.pre 
                      key="output" 
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }} 
                      className="whitespace-pre-wrap break-all text-neutral-700 relative z-10 leading-[20px]" 
                      id="output-pre"
                    >
                      {output}
                    </motion.pre>
                  </div>
                ) : (
                  <div key="empty" className="flex flex-col items-center justify-center h-full opacity-20 select-none">
                    <Code2 size={48} className="mb-4" />
                    <p className="text-xs font-semibold tracking-widest uppercase">Waiting for Input</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        );
      case 'paths':
        return (
          <div className="h-full flex flex-col bg-neutral-100/30 overflow-hidden" id="path-pane">
            <div {...handleProps} className="h-10 border-b border-neutral-200 flex items-center px-4 bg-neutral-50/50 group/header select-none justify-between shrink-0">
              <div 
                className="flex items-center flex-1 cursor-grab active:cursor-grabbing h-full"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <GripHorizontal size={14} className="text-neutral-400 mr-2 group-hover/header:text-neutral-600 transition-colors" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 group-hover/header:text-neutral-900 transition-colors">Path Explorer</span>
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')} 
                  className={`p-1 rounded transition-colors ${viewMode === 'list' ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200'}`}
                  title={viewMode === 'tree' ? "Switch to List View" : "Switch to Tree View"}
                >
                  {viewMode === 'tree' ? <ListTree size={12} /> : <Code2 size={12} />}
                </button>
                <div className="w-px h-3 bg-neutral-200 mx-1" />
                {viewMode === 'tree' && (
                  <>
                    <button onClick={expandAll} className="p-1 rounded text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200 transition-colors" title="Expand All">
                      <PlusSquare size={12} />
                    </button>
                    <button onClick={collapseAll} className="p-1 rounded text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200 transition-colors" title="Collapse All">
                      <MinusSquare size={12} />
                    </button>
                    <div className="w-px h-3 bg-neutral-200 mx-1" />
                  </>
                )}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllPathFormats(!showAllPathFormats);
                  }}
                  className={`p-1 rounded transition-colors ${showAllPathFormats ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200'}`}
                  title={showAllPathFormats ? "Hide extended paths" : "Show extended paths"}
                >
                  <Settings2 size={12} />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport();
                  }}
                  className="p-1 rounded text-neutral-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                  title="Export Mapping to Excel"
                >
                  <FileSpreadsheet size={12} />
                </button>
                <button 
                  onClick={() => setCollapsedPanes(prev => new Set(prev).add('paths'))}
                  className="p-1 rounded text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                  title="Collapse"
                >
                  <Minimize2 size={12} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 custom-scrollbar">
              {paths.length > 0 ? (
                <div className={viewMode === 'list' ? "space-y-1" : "space-y-0.5"}>
                  {filteredPaths.map((p, idx) => {
                    const depth = viewMode === 'tree' ? p.parts.length : 0;
                    const isObject = typeof p.value === 'string' && (p.value.startsWith('Object') || p.value.startsWith('Array'));
                    const isCollapsed = collapsedPaths.has(p.path);
                    const label = viewMode === 'tree' ? (p.parts.length > 0 ? p.parts[p.parts.length - 1] : '/') : p.displayPath;

                    return (
                      <div key={idx} className="group/row relative">
                        <div 
                          className={`flex items-center w-full rounded-md transition-all group border ${
                            activePath === p.path 
                              ? 'bg-neutral-900 border-neutral-900 text-white shadow-sm ring-4 ring-neutral-900/5 z-[1]' 
                              : 'bg-white border-transparent hover:border-neutral-200'
                          }`}
                          style={{ 
                            marginLeft: viewMode === 'tree' ? `${depth * 12}px` : '0px', 
                            width: viewMode === 'tree' ? `calc(100% - ${depth * 12}px)` : '100%' 
                          }}
                        >
                          <div className="flex flex-col w-full relative">
                            {/* Hierarchy Lines */}
                            {viewMode === 'tree' && Array.from({ length: depth }).map((_, i) => (
                              <div 
                                key={i}
                                className="absolute top-0 bottom-0 border-l border-neutral-200"
                                style={{ left: `-${(i + 1) * 12 - 6}px` }}
                              />
                            ))}

                            <div className={`flex items-center ${viewMode === 'list' ? 'min-h-[44px]' : 'min-h-[36px]'} px-3 py-1.5 gap-2 relative`}>
                              {isObject && viewMode === 'tree' ? (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCollapse(p.path);
                                  }}
                                  className={`shrink-0 transition-all p-1 rounded hover:bg-neutral-100 ${isCollapsed ? 'text-neutral-400' : 'text-neutral-600'}`}
                                >
                                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                              ) : viewMode === 'tree' ? (
                                <div className="w-[18px] shrink-0" />
                              ) : null}
                              
                              <button
                                ref={activePath === p.path ? activePathRef : null}
                                onClick={() => scrollToPathInEditor(p.path)}
                                className="flex items-center gap-2 flex-1 min-w-0 text-left group/btn"
                              >
                                <div className={`shrink-0 transition-opacity ${activePath === p.path ? 'opacity-100' : 'opacity-60 group-hover/btn:opacity-80'}`}>
                                  {isObject ? (p.value.startsWith('Array') ? <Layers size={14} /> : <Box size={14} />) : <FileJson size={14} />}
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className={`font-mono text-[11px] truncate transition-all ${
                                    activePath === p.path 
                                      ? activeSection === 'key' 
                                        ? 'text-white font-bold underline underline-offset-4 decoration-blue-400' 
                                        : 'text-white/80' 
                                      : 'text-neutral-700 font-medium'
                                  }`}>
                                    {label}
                                  </span>
                                  {(viewMode === 'tree' || activePath === p.path) && p.path !== '/' && (
                                    <span className={`text-[9px] font-mono transition-all truncate ${
                                      activePath === p.path ? 'text-white/50' : 'text-neutral-500/80'
                                    }`}>
                                      {p.path}
                                    </span>
                                  )}
                                  {viewMode === 'list' && (
                                     <span className={`text-[8px] font-bold uppercase tracking-widest transition-all ${
                                       activePath === p.path ? 'text-white/30' : 'text-neutral-400'
                                     }`}>
                                       {isObject ? 'Container' : 'Value Node'}
                                     </span>
                                  )}
                                </div>
                                
                                {!isObject && (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md truncate border transition-all ${
                                    activePath === p.path 
                                      ? activeSection === 'value' 
                                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm font-bold' 
                                        : 'bg-white/10 border-white/20 text-white/70' 
                                      : 'bg-neutral-50 border-neutral-100 text-neutral-600 font-medium'
                                  }`}>
                                    {p.value}
                                  </span>
                                )}
                                {isObject && (
                                   <span className={`text-[9px] font-bold whitespace-nowrap px-1.5 py-0.5 rounded transition-all ${
                                     activePath === p.path 
                                       ? 'bg-white/10 text-white/70 border border-white/10' 
                                       : 'bg-neutral-100 text-neutral-600 border border-neutral-200/50'
                                   }`}>
                                     {p.value}
                                   </span>
                                )}
                              </button>

                              {activePath === p.path && <Crosshair size={10} className="text-white/40 shrink-0 ml-auto" />}
                            </div>

                            {activePath === p.path && showAllPathFormats && (
                              <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                className="px-3 pb-3 pt-1 border-t border-white/10 space-y-2 w-full overflow-hidden"
                              >
                                <div className="flex flex-col gap-2">
                                  {[
                                    { label: 'Pointer', value: toJsonPointer(p.parts), id: 'pointer' },
                                    { label: 'JSONPath', value: toJsonPath(p.parts), id: 'jsonpath' },
                                    { label: 'JS', value: toJsPath(p.parts), id: 'js' }
                                  ].map((f) => (
                                    <div key={f.id} className="flex items-center justify-between gap-3 group/detail bg-white/5 p-1.5 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <span className="text-[7px] font-bold uppercase tracking-widest text-white/40 leading-none mb-1">{f.label}</span>
                                        <span className="font-mono text-[9px] text-white/80 truncate">{f.value}</span>
                                      </div>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(f.value);
                                          setCopiedFormat(`${idx}-${f.id}`);
                                          setTimeout(() => setCopiedFormat(null), 1000);
                                        }}
                                        className="shrink-0 p-1 rounded hover:bg-white/20 text-white/30 hover:text-white transition-colors"
                                      >
                                        {copiedFormat === `${idx}-${f.id}` ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </div>
                        </div>
                        
                        {/* Copy pointer button for non-active or simple UI */}
                        {!showAllPathFormats && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(p.path);
                              setRowCopiedIdx(idx);
                              setTimeout(() => setRowCopiedIdx(null), 1000);
                            }}
                            className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded shadow-sm transition-all z-[2] border flex items-center gap-1 ${
                              rowCopiedIdx === idx ? 'opacity-100 scale-105' : 'opacity-0 group-hover/row:opacity-100'
                            } ${
                              activePath === p.path 
                                ? 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-white' 
                                : 'bg-white border-neutral-200 text-neutral-400 hover:text-neutral-900'
                            }`}
                            title="Copy Pointer"
                          >
                            {rowCopiedIdx === idx ? (
                               <Check size={10} className="text-green-500" />
                            ) : (
                              <Copy size={10} />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center h-full opacity-30 select-none text-center">
                  <ListTree size={32} className="mb-2" />
                  <p className="text-[10px] font-bold uppercase tracking-tighter">No Paths Found</p>
                </div>
              )}
            </div>
          </div>
        );
      case 'graph':
        return (
          <div className="h-full flex flex-col bg-white overflow-hidden" id="graph-pane">
            <div {...handleProps} className="h-10 border-b border-neutral-200 flex items-center px-4 bg-neutral-50/50 group/header select-none justify-between shrink-0">
              <div 
                className="flex items-center flex-1 cursor-grab active:cursor-grabbing h-full"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <GripHorizontal size={14} className="text-neutral-400 mr-2 group-hover/header:text-neutral-600 transition-colors" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 group-hover/header:text-neutral-900 transition-colors">Visual Graph</span>
              </div>
              <div className="flex items-center gap-1">
                 <button 
                    onClick={() => setCollapsedPanes(prev => new Set(prev).add('graph'))}
                    className="p-1 rounded text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                    title="Collapse"
                  >
                    <Minimize2 size={12} />
                  </button>
                 <button 
                  onClick={() => {
                    setPaneOrder(prev => prev.filter(p => p !== 'graph'));
                  }}
                  className="p-1 rounded text-neutral-400 hover:text-red-500 hover:bg-neutral-100 transition-colors"
                  title="Close Graph"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="flex-1 relative bg-[#121212] overflow-hidden">
               {paths.length > 0 ? (
                 <JSONGraphWrapper paths={paths} activePath={activePath} onPathClick={scrollToPathInEditor} />
               ) : (
                <div className="flex flex-col items-center justify-center h-full opacity-20 select-none text-white">
                  <Network size={48} className="mb-4" />
                  <p className="text-xs font-semibold tracking-widest uppercase text-center">Enter valid JSON<br/>to visualize</p>
                </div>
               )}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden bg-white">
      {/* Header */}
      <header className="h-14 border-b border-neutral-200 flex items-center justify-between px-6 z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-neutral-900 flex items-center justify-center text-white shadow-sm">
            <Code2 size={18} />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight leading-none">JSON Prettify</h1>
            <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-widest leading-none mt-1">Live Explorer</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
             onClick={() => {
               if (paneOrder.includes('graph')) {
                 setPaneOrder(prev => prev.filter(p => p !== 'graph'));
               } else {
                 setPaneOrder(prev => [...prev, 'graph']);
               }
             }}
             className={`flex items-center gap-2 text-xs font-medium px-4 py-1.5 rounded-full transition-all ${
               paneOrder.includes('graph') 
                 ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                 : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
             }`}
          >
            <Network size={14} />
            Visual Graph
          </button>
          <div className="h-4 w-px bg-neutral-200 mx-1" />
          <button onClick={handleExample} className="text-xs font-medium px-4 py-1.5 rounded-full hover:bg-neutral-100 transition-colors text-neutral-600">
            Example
          </button>
          <div className="h-4 w-px bg-neutral-200 mx-1" />
          <button onClick={handleClear} className="p-1.5 rounded-full hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-red-500" title="Clear Input">
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 relative overflow-hidden bg-neutral-50 lg:px-4 py-4">
        <Reorder.Group 
          axis="x" 
          values={paneOrder} 
          onReorder={setPaneOrder} 
          className="flex h-full w-full items-stretch"
        >
          {paneOrder.map((type) => (
            <PaneWrapper
              key={type}
              type={type}
              paneWidths={paneWidths}
              collapsedPanes={collapsedPanes}
              setCollapsedPanes={setCollapsedPanes}
              startResizing={startResizing}
              renderPane={renderPane}
            />
          ))}
        </Reorder.Group>
      </main>

      {/* Footer */}
      <footer className="h-8 border-t border-neutral-200 flex items-center justify-between px-6 text-[10px] text-neutral-400 font-medium z-20 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-red-500' : input.trim() ? 'bg-green-500' : 'bg-neutral-300'}`} />
            <span>{error ? 'Format Error' : input.trim() ? 'Valid' : 'Empty'}</span>
          </div>
          {activePath !== null && (
             <div className="flex items-center gap-1.5 opacity-80">
               <span className="opacity-50">Caret:</span>
               <span className="font-mono text-neutral-600">{activePath === '' ? '/' : activePath}</span>
               <span className="px-1 bg-neutral-100 rounded text-[8px] uppercase">{activeSection}</span>
             </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span>Drag headers to reorder • Double click path to copy</span>
          <Info size={10} />
        </div>
      </footer>
    </div>
  );
}

