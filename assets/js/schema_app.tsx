import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Circle, Layer, Line, Shape, Stage, Text } from "react-konva";

import type { Context as KonvaContext } from "konva/lib/Context";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Stage as KonvaStage } from "konva/lib/Stage";

type Point = { x: number; y: number };
type Tool = "cursor" | "hand";
type PlacementMode = "none" | "atom" | "annotation";
type Selection = { kind: "atom" | "bond" | "annotation"; id: string } | null;
type EndpointKey = "start" | "end";

type Atom = {
  id: string;
  x: number;
  y: number;
  radius: number;
  label: string;
};

type FreeEndpoint = {
  kind: "free";
  x: number;
  y: number;
};

type AttachedEndpoint = {
  kind: "attached";
  atomId: string;
  angle: number;
};

type BondEndpoint = FreeEndpoint | AttachedEndpoint;

type Bond = {
  id: string;
  start: BondEndpoint;
  end: BondEndpoint;
  curvature: number;
};

type AnnotationMessage = {
  id: string;
  author: string;
  body: string;
  timestamp: string;
};

type Annotation = {
  id: string;
  x: number;
  y: number;
  expanded: boolean;
  draftMessage: string;
  messages: AnnotationMessage[];
};

type ViewState = {
  x: number;
  y: number;
  scale: number;
};

type DraggingAtom = {
  atomId: string;
  offset: Point;
};

type DraftBond = {
  start: AttachedEndpoint;
  current: Point;
  startPoint: Point;
};

type AtomEditor = {
  atomId: string;
  value: string;
};

type GridLine = {
  key: string;
  points: number[];
  axis: boolean;
};

const ATOM_RADIUS = 36;
const ATOM_COLLISION_PADDING = 16;
const ANNOTATION_RADIUS = 10;
const ANNOTATION_COLLISION_PADDING = 18;
const GRID_SIZE = 96;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.4;
const BOND_HEAD_LENGTH = 18;
const BOND_HEAD_WIDTH = 12;
const BOND_CURVATURE = 0.18;
const BOND_START_EDGE_THRESHOLD = 12;
const BOND_SNAP_DISTANCE = 42;
const BOND_CREATE_MIN_DISTANCE = 18;
const BOND_CURVATURE_LIMIT = 0.9;
const INITIAL_BOND_SPAN = 124;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${uuid}`;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(point: Point) {
  const magnitude = Math.hypot(point.x, point.y);

  if (magnitude < 0.0001) {
    return { x: 1, y: 0 };
  }

  return { x: point.x / magnitude, y: point.y / magnitude };
}

function perpendicular(point: Point) {
  return { x: -point.y, y: point.x };
}

function dot(a: Point, b: Point) {
  return a.x * b.x + a.y * b.y;
}

function worldToScreen(point: Point, view: ViewState) {
  return {
    x: point.x * view.scale + view.x,
    y: point.y * view.scale + view.y
  };
}

function screenToWorld(point: Point, view: ViewState) {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale
  };
}

function getPointerWorldPoint(stage: KonvaStage | null, view: ViewState) {
  const pointer = stage?.getPointerPosition();

  if (!pointer) {
    return null;
  }

  return screenToWorld(pointer, view);
}

function angleFor(atom: Atom, point: Point) {
  return Math.atan2(point.y - atom.y, point.x - atom.x);
}

function endpointPoint(endpoint: BondEndpoint, atomIndex: Map<string, Atom>): Point {
  if (endpoint.kind === "free") {
    return { x: endpoint.x, y: endpoint.y };
  }

  const atom = atomIndex.get(endpoint.atomId);

  if (!atom) {
    return { x: 0, y: 0 };
  }

  return {
    x: atom.x + Math.cos(endpoint.angle) * atom.radius,
    y: atom.y + Math.sin(endpoint.angle) * atom.radius
  };
}

function bondCurve(bond: Bond, atomIndex: Map<string, Atom>) {
  const start = endpointPoint(bond.start, atomIndex);
  const end = endpointPoint(bond.end, atomIndex);
  const delta = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.max(distance(start, end), 1);
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const normal = normalize(perpendicular(delta));
  const control = {
    x: midpoint.x + normal.x * length * bond.curvature,
    y: midpoint.y + normal.y * length * bond.curvature
  };

  return { start, end, control, midpoint, normal, length };
}

function arrowHeadGeometry(
  endpoint: BondEndpoint,
  control: Point,
  end: Point,
  atomIndex: Map<string, Atom>
) {
  const direction =
    endpoint.kind === "attached"
      ? (() => {
          const atom = atomIndex.get(endpoint.atomId);

          if (!atom) {
            return normalize({ x: end.x - control.x, y: end.y - control.y });
          }

          return normalize({ x: atom.x - end.x, y: atom.y - end.y });
        })()
      : normalize({ x: end.x - control.x, y: end.y - control.y });

  const normal = perpendicular(direction);
  const shaftEnd = {
    x: end.x - direction.x * BOND_HEAD_LENGTH,
    y: end.y - direction.y * BOND_HEAD_LENGTH
  };

  return {
    shaftEnd,
    headPoints: [
      end.x,
      end.y,
      shaftEnd.x + normal.x * (BOND_HEAD_WIDTH / 2),
      shaftEnd.y + normal.y * (BOND_HEAD_WIDTH / 2),
      shaftEnd.x - normal.x * (BOND_HEAD_WIDTH / 2),
      shaftEnd.y - normal.y * (BOND_HEAD_WIDTH / 2)
    ]
  };
}

function drawQuadraticCurve(
  ctx: KonvaContext,
  start: Point,
  control: Point,
  end: Point
) {
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
}

function setBondEndpoint(bond: Bond, endpointKey: EndpointKey, endpoint: BondEndpoint): Bond {
  if (endpointKey === "start") {
    return { ...bond, start: endpoint };
  }

  return { ...bond, end: endpoint };
}

function getBondEndpoint(bond: Bond, endpointKey: EndpointKey) {
  return endpointKey === "start" ? bond.start : bond.end;
}

function oppositeEndpoint(bond: Bond, endpointKey: EndpointKey) {
  return endpointKey === "start" ? bond.end : bond.start;
}

function findOpenAtomPosition(point: Point, atoms: Atom[], annotations: Annotation[]) {
  const nextPoint = { ...point };

  while (true) {
    const collidesWithAtom = atoms.some((atom) => {
      return distance(nextPoint, atom) < atom.radius + ATOM_RADIUS + ATOM_COLLISION_PADDING;
    });

    const collidesWithAnnotation = annotations.some((annotation) => {
      return (
        distance(nextPoint, annotation) <
        ANNOTATION_RADIUS + ATOM_RADIUS + ANNOTATION_COLLISION_PADDING
      );
    });

    if (!collidesWithAtom && !collidesWithAnnotation) {
      return nextPoint;
    }

    nextPoint.y += ATOM_RADIUS * 2 + ATOM_COLLISION_PADDING;
  }
}

function findSnapAtom(point: Point, atoms: Atom[], excludedAtomIds: string[] = []) {
  const excluded = new Set(excludedAtomIds);
  let closest: Atom | null = null;
  let closestDistance = Infinity;

  for (const atom of atoms) {
    if (excluded.has(atom.id)) {
      continue;
    }

    const atomDistance = distance(point, atom);

    if (atomDistance < closestDistance && atomDistance <= atom.radius + BOND_SNAP_DISTANCE) {
      closest = atom;
      closestDistance = atomDistance;
    }
  }

  return closest;
}

function buildGrid(stageSize: { width: number; height: number }, view: ViewState) {
  if (stageSize.width === 0 || stageSize.height === 0) {
    return [] as GridLine[];
  }

  const worldLeft = -view.x / view.scale;
  const worldTop = -view.y / view.scale;
  const worldRight = worldLeft + stageSize.width / view.scale;
  const worldBottom = worldTop + stageSize.height / view.scale;
  const startX = Math.floor(worldLeft / GRID_SIZE) * GRID_SIZE - GRID_SIZE;
  const endX = Math.ceil(worldRight / GRID_SIZE) * GRID_SIZE + GRID_SIZE;
  const startY = Math.floor(worldTop / GRID_SIZE) * GRID_SIZE - GRID_SIZE;
  const endY = Math.ceil(worldBottom / GRID_SIZE) * GRID_SIZE + GRID_SIZE;
  const lines: GridLine[] = [];

  for (let x = startX; x <= endX; x += GRID_SIZE) {
    lines.push({ key: `vx-${x}`, points: [x, startY, x, endY], axis: x === 0 });
  }

  for (let y = startY; y <= endY; y += GRID_SIZE) {
    lines.push({ key: `hy-${y}`, points: [startX, y, endX, y], axis: y === 0 });
  }

  return lines;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)
  );
}

function annotationTimestamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type SchemaAppProps = {
  schemaCode: string;
};

export function SchemaApp({ schemaCode }: SchemaAppProps) {
  const stageRef = useRef<KonvaStage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const centeredViewRef = useRef(false);

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("cursor");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [placementMode, setPlacementMode] = useState<PlacementMode>("none");
  const [selection, setSelection] = useState<Selection>(null);
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pointerWorld, setPointerWorld] = useState<Point | null>(null);
  const [draggingAtom, setDraggingAtom] = useState<DraggingAtom | null>(null);
  const [draftBond, setDraftBond] = useState<DraftBond | null>(null);
  const [atomEditor, setAtomEditor] = useState<AtomEditor | null>(null);

  const activeTool = spaceHeld ? "hand" : tool;
  const atomIndex = new Map(atoms.map((atom) => [atom.id, atom]));
  const gridLines = buildGrid(stageSize, view);
  const viewportCenter = screenToWorld(
    { x: stageSize.width / 2, y: stageSize.height / 2 },
    view
  );

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(Math.round(entry.contentRect.width), 320);
      const height = Math.max(Math.round(entry.contentRect.height), 320);

      setStageSize({ width, height });

      if (!centeredViewRef.current) {
        centeredViewRef.current = true;
        setView({ x: width / 2, y: height / 2, scale: 1 });
      }
    });

    const node = containerRef.current;

    if (node) {
      observer.observe(node);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setSpaceHeld(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceHeld(false);
      }
    };

    const handleBlur = () => {
      setSpaceHeld(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  function updatePointer() {
    const point = getPointerWorldPoint(stageRef.current, view);

    if (point) {
      setPointerWorld(point);
    }

    return point;
  }

  function createAtom(point: Point) {
    const openPoint = findOpenAtomPosition(point, atoms, annotations);
    const atom = {
      id: makeId("atom"),
      x: openPoint.x,
      y: openPoint.y,
      radius: ATOM_RADIUS,
      label: ""
    };

    setAtoms((current) => [...current, atom]);
    setSelection({ kind: "atom", id: atom.id });

    return atom;
  }

  function createAnnotation(point: Point) {
    const annotation = {
      id: makeId("annotation"),
      x: point.x,
      y: point.y,
      expanded: true,
      draftMessage: "",
      messages: []
    };

    setAnnotations((current) => [...current, annotation]);
    setSelection({ kind: "annotation", id: annotation.id });

    return annotation;
  }

  function startAtomPlacement() {
    setTool("cursor");
    setPlacementMode("atom");
    setSelection(null);
    setAtomEditor(null);
  }

  function startAnnotationPlacement() {
    setTool("cursor");
    setPlacementMode("annotation");
    setSelection(null);
    setAtomEditor(null);
  }

  function addFreeBond() {
    const bond = {
      id: makeId("bond"),
      start: { kind: "free", x: viewportCenter.x - INITIAL_BOND_SPAN, y: viewportCenter.y - 24 },
      end: { kind: "free", x: viewportCenter.x + INITIAL_BOND_SPAN, y: viewportCenter.y + 24 },
      curvature: BOND_CURVATURE
    } satisfies Bond;

    setTool("cursor");
    setPlacementMode("none");
    setAtomEditor(null);
    setBonds((current) => [...current, bond]);
    setSelection({ kind: "bond", id: bond.id });
  }

  function openAtomEditor(atom: Atom) {
    setSelection({ kind: "atom", id: atom.id });
    setAtomEditor({ atomId: atom.id, value: atom.label });
  }

  function saveAtomEditor() {
    if (!atomEditor) {
      return;
    }

    const nextLabel = atomEditor.value.trim();

    setAtoms((current) => {
      return current.map((atom) => {
        if (atom.id !== atomEditor.atomId) {
          return atom;
        }

        return { ...atom, label: nextLabel };
      });
    });

    setAtomEditor(null);
  }

  function finalizeDraftBond(point: Point) {
    if (!draftBond || distance(draftBond.startPoint, point) < BOND_CREATE_MIN_DISTANCE) {
      setDraftBond(null);
      return;
    }

    const snapAtom = findSnapAtom(point, atoms, [draftBond.start.atomId]);
    const bond = {
      id: makeId("bond"),
      start: draftBond.start,
      end: snapAtom
        ? { kind: "attached", atomId: snapAtom.id, angle: angleFor(snapAtom, point) }
        : { kind: "free", x: point.x, y: point.y },
      curvature: BOND_CURVATURE
    } satisfies Bond;

    setBonds((current) => [...current, bond]);
    setSelection({ kind: "bond", id: bond.id });
    setDraftBond(null);
  }

  function handleStageMouseDown(event: KonvaEventObject<MouseEvent>) {
    if (activeTool !== "cursor" || event.evt.button !== 0) {
      return;
    }

    const point = updatePointer();

    if (!point) {
      return;
    }

    if (placementMode === "atom") {
      const atom = createAtom(point);
      setPlacementMode("none");
      openAtomEditor(atom);
      return;
    }

    if (placementMode === "annotation") {
      createAnnotation(point);
      setPlacementMode("none");
      return;
    }

    if (event.target === event.target.getStage()) {
      setSelection(null);
      setAtomEditor(null);
    }
  }

  function handleStageMouseMove() {
    const point = updatePointer();

    if (!point) {
      return;
    }

    if (draggingAtom) {
      setAtoms((current) => {
        return current.map((atom) => {
          if (atom.id !== draggingAtom.atomId) {
            return atom;
          }

          return {
            ...atom,
            x: point.x + draggingAtom.offset.x,
            y: point.y + draggingAtom.offset.y
          };
        });
      });
    }

    if (draftBond) {
      setDraftBond({ ...draftBond, current: point });
    }
  }

  function handleStageMouseUp() {
    const point = updatePointer();

    if (draggingAtom) {
      setDraggingAtom(null);
    }

    if (draftBond) {
      finalizeDraftBond(point ?? draftBond.current);
    }
  }

  function handleStageDoubleClick(event: KonvaEventObject<MouseEvent>) {
    if (
      activeTool !== "cursor" ||
      placementMode !== "none" ||
      event.evt.button !== 0 ||
      event.target !== event.target.getStage()
    ) {
      return;
    }

    const point = getPointerWorldPoint(stageRef.current, view);

    if (!point) {
      return;
    }

    const atom = createAtom(point);
    openAtomEditor(atom);
  }

  function handleStageContextMenu(event: KonvaEventObject<PointerEvent>) {
    if (activeTool !== "cursor" || event.target !== event.target.getStage()) {
      return;
    }

    event.evt.preventDefault();
    const point = getPointerWorldPoint(stageRef.current, view);

    if (!point) {
      return;
    }

    createAnnotation(point);
  }

  function handleWheel(event: KonvaEventObject<WheelEvent>) {
    if (activeTool !== "hand") {
      return;
    }

    event.evt.preventDefault();

    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();

    if (!stage || !pointer) {
      return;
    }

    const worldPoint = screenToWorld(pointer, view);
    const nextScale = clamp(
      event.evt.deltaY < 0 ? view.scale * 1.08 : view.scale / 1.08,
      MIN_SCALE,
      MAX_SCALE
    );

    setView({
      scale: nextScale,
      x: pointer.x - worldPoint.x * nextScale,
      y: pointer.y - worldPoint.y * nextScale
    });
  }

  function handleAtomMouseDown(atom: Atom, event: KonvaEventObject<MouseEvent>) {
    if (activeTool !== "cursor" || placementMode !== "none" || event.evt.button !== 0) {
      return;
    }

    event.cancelBubble = true;
    setSelection({ kind: "atom", id: atom.id });
    setAtomEditor(null);

    const point = getPointerWorldPoint(stageRef.current, view);

    if (!point) {
      return;
    }

    const radialDistance = distance(point, atom);

    if (radialDistance >= atom.radius - BOND_START_EDGE_THRESHOLD) {
      setDraftBond({
        start: { kind: "attached", atomId: atom.id, angle: angleFor(atom, point) },
        current: point,
        startPoint: point
      });

      return;
    }

    setDraggingAtom({
      atomId: atom.id,
      offset: { x: atom.x - point.x, y: atom.y - point.y }
    });
  }

  function handleAtomDoubleClick(atom: Atom, event: KonvaEventObject<MouseEvent>) {
    if (activeTool !== "cursor") {
      return;
    }

    event.cancelBubble = true;
    openAtomEditor(atom);
  }

  function handleBondSelect(event: KonvaEventObject<MouseEvent>, bondId: string) {
    if (placementMode !== "none") {
      return;
    }

    event.cancelBubble = true;
    setSelection({ kind: "bond", id: bondId });
    setAtomEditor(null);
  }

  function updateBondCurvature(bond: Bond, nextControl: Point) {
    const curve = bondCurve(bond, atomIndex);
    const offset = { x: nextControl.x - curve.midpoint.x, y: nextControl.y - curve.midpoint.y };
    const signedDistance = dot(offset, curve.normal);
    const nextCurvature = clamp(
      signedDistance / Math.max(curve.length, 1),
      -BOND_CURVATURE_LIMIT,
      BOND_CURVATURE_LIMIT
    );

    setBonds((current) => {
      return current.map((item) => {
        if (item.id !== bond.id) {
          return item;
        }

        return { ...item, curvature: nextCurvature };
      });
    });
  }

  function detachEndpoint(bond: Bond, endpointKey: EndpointKey) {
    const point = endpointPoint(getBondEndpoint(bond, endpointKey), atomIndex);

    setBonds((current) => {
      return current.map((item) => {
        if (item.id !== bond.id) {
          return item;
        }

        return setBondEndpoint(item, endpointKey, { kind: "free", x: point.x, y: point.y });
      });
    });
  }

  function handleEndpointDragStart(bond: Bond, endpointKey: EndpointKey) {
    setSelection({ kind: "bond", id: bond.id });

    if (getBondEndpoint(bond, endpointKey).kind === "attached") {
      detachEndpoint(bond, endpointKey);
    }
  }

  function handleEndpointDragMove(
    event: KonvaEventObject<DragEvent>,
    bondId: string,
    endpointKey: EndpointKey
  ) {
    const { x, y } = event.target.position();

    setBonds((current) => {
      return current.map((bond) => {
        if (bond.id !== bondId) {
          return bond;
        }

        return setBondEndpoint(bond, endpointKey, { kind: "free", x, y });
      });
    });
  }

  function handleEndpointDragEnd(
    event: KonvaEventObject<DragEvent>,
    bond: Bond,
    endpointKey: EndpointKey
  ) {
    const { x, y } = event.target.position();
    const other = oppositeEndpoint(bond, endpointKey);
    const excludedAtomIds = other.kind === "attached" ? [other.atomId] : [];
    const snapAtom = findSnapAtom({ x, y }, atoms, excludedAtomIds);

    setBonds((current) => {
      return current.map((item) => {
        if (item.id !== bond.id) {
          return item;
        }

        if (!snapAtom) {
          return setBondEndpoint(item, endpointKey, { kind: "free", x, y });
        }

        return setBondEndpoint(item, endpointKey, {
          kind: "attached",
          atomId: snapAtom.id,
          angle: angleFor(snapAtom, { x, y })
        });
      });
    });
  }

  function updateAnnotationDraft(annotationId: string, draftMessage: string) {
    setAnnotations((current) => {
      return current.map((annotation) => {
        if (annotation.id !== annotationId) {
          return annotation;
        }

        return { ...annotation, draftMessage };
      });
    });
  }

  function appendAnnotationMessage(annotationId: string) {
    setAnnotations((current) => {
      return current.map((annotation) => {
        if (annotation.id !== annotationId) {
          return annotation;
        }

        const body = annotation.draftMessage.trim();

        if (body === "") {
          return annotation;
        }

        return {
          ...annotation,
          draftMessage: "",
          expanded: true,
          messages: [
            ...annotation.messages,
            {
              id: makeId("message"),
              author: "anon",
              body,
              timestamp: annotationTimestamp()
            }
          ]
        };
      });
    });
  }

  function setAnnotationExpanded(annotationId: string, expanded: boolean) {
    setAnnotations((current) => {
      return current.map((annotation) => {
        if (annotation.id !== annotationId) {
          return annotation;
        }

        return { ...annotation, expanded };
      });
    });
  }

  const previewAtom =
    placementMode === "atom" && pointerWorld
      ? findOpenAtomPosition(pointerWorld, atoms, annotations)
      : null;

  const statusText =
    placementMode === "atom"
      ? "Click anywhere to place a new atom."
      : placementMode === "annotation"
        ? "Click anywhere to place a new annotation."
        : activeTool === "hand"
          ? "Drag to pan. Scroll to zoom. Release Space to return to the cursor tool."
          : "Double-click empty space to add an atom. Drag from an atom edge to create a bond. Right-click to annotate.";

  const atomBeingEdited = atomEditor ? atomIndex.get(atomEditor.atomId) : null;
  const atomEditorPosition = atomBeingEdited ? worldToScreen(atomBeingEdited, view) : null;

  return (
    <div className="schema-workspace">
      <div className="schema-toolbar" role="toolbar" aria-label="Schema tools">
        <div className="schema-toolbar__group">
          <button
            type="button"
            className={`schema-tool-button ${tool === "cursor" ? "is-active" : ""}`}
            onClick={() => {
              setTool("cursor");
              setPlacementMode("none");
            }}
          >
            Cursor
          </button>
          <button
            type="button"
            className={`schema-tool-button ${tool === "hand" ? "is-active" : ""}`}
            onClick={() => {
              setTool("hand");
              setPlacementMode("none");
            }}
          >
            Hand
          </button>
        </div>

        <div className="schema-toolbar__group">
          <button
            type="button"
            className={`schema-action-button ${placementMode === "atom" ? "is-active" : ""}`}
            onClick={startAtomPlacement}
          >
            Add atom
          </button>
          <button type="button" className="schema-action-button" onClick={addFreeBond}>
            Add bond
          </button>
          <button
            type="button"
            className={`schema-action-button ${placementMode === "annotation" ? "is-active" : ""}`}
            onClick={startAnnotationPlacement}
          >
            Add annotation
          </button>
        </div>

        <div className="schema-toolbar__meta">
          <span className="schema-toolbar__code">schema/{schemaCode}</span>
          <span className="schema-toolbar__mode">
            {activeTool === "hand" ? "Hand mode" : "Cursor mode"}
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`schema-stage-shell schema-stage-shell--${
          placementMode !== "none" ? "placing" : activeTool
        }`}
      >
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable={activeTool === "hand"}
          onDragMove={(event) => {
            setView((current) => ({
              ...current,
              x: event.target.x(),
              y: event.target.y()
            }));
          }}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onMouseLeave={handleStageMouseUp}
          onDblClick={handleStageDoubleClick}
          onContextMenu={handleStageContextMenu}
          onWheel={handleWheel}
        >
          <Layer>
            {gridLines.map((line) => {
              return (
                <Line
                  key={line.key}
                  points={line.points}
                  stroke={line.axis ? "rgba(148, 163, 184, 0.22)" : "rgba(71, 85, 105, 0.28)"}
                  strokeWidth={line.axis ? 1.8 : 1}
                  listening={false}
                />
              );
            })}

            {bonds.map((bond) => {
              const curve = bondCurve(bond, atomIndex);
              const selected = selection?.kind === "bond" && selection.id === bond.id;
              const head = arrowHeadGeometry(bond.end, curve.control, curve.end, atomIndex);

              return (
                <React.Fragment key={bond.id}>
                  <Shape
                    sceneFunc={(ctx, shape) => {
                      drawQuadraticCurve(ctx, curve.start, curve.control, head.shaftEnd);
                      ctx.strokeShape(shape);
                    }}
                    stroke={selected ? "#f8fafc" : "#cbd5e1"}
                    strokeWidth={selected ? 4.5 : 3}
                    lineCap="round"
                    lineJoin="round"
                    hitStrokeWidth={22}
                    onMouseDown={(event) => handleBondSelect(event, bond.id)}
                  />
                  <Line
                    points={head.headPoints}
                    closed
                    fill={selected ? "#f8fafc" : "#cbd5e1"}
                    stroke={selected ? "#f8fafc" : "#cbd5e1"}
                    strokeWidth={1.25}
                    lineJoin="round"
                    listening={false}
                  />

                  {selected && (
                    <>
                      <Circle
                        x={curve.start.x}
                        y={curve.start.y}
                        radius={9}
                        fill="#0f172a"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        draggable
                        onMouseDown={(event) => {
                          event.cancelBubble = true;
                        }}
                        onDragStart={() => handleEndpointDragStart(bond, "start")}
                        onDragMove={(event) => handleEndpointDragMove(event, bond.id, "start")}
                        onDragEnd={(event) => handleEndpointDragEnd(event, bond, "start")}
                      />
                      <Circle
                        x={curve.end.x}
                        y={curve.end.y}
                        radius={9}
                        fill="#0f172a"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        draggable
                        onMouseDown={(event) => {
                          event.cancelBubble = true;
                        }}
                        onDragStart={() => handleEndpointDragStart(bond, "end")}
                        onDragMove={(event) => handleEndpointDragMove(event, bond.id, "end")}
                        onDragEnd={(event) => handleEndpointDragEnd(event, bond, "end")}
                      />
                      <Circle
                        x={curve.control.x}
                        y={curve.control.y}
                        radius={8}
                        fill="#38bdf8"
                        stroke="#e0f2fe"
                        strokeWidth={1.5}
                        draggable
                        onMouseDown={(event) => {
                          event.cancelBubble = true;
                        }}
                        onDragMove={(event) => updateBondCurvature(bond, event.target.position())}
                      />
                    </>
                  )}
                </React.Fragment>
              );
            })}

            {draftBond && (() => {
              const start = endpointPoint(draftBond.start, atomIndex);
              const delta = { x: draftBond.current.x - start.x, y: draftBond.current.y - start.y };
              const length = Math.max(distance(start, draftBond.current), 1);
              const midpoint = { x: (start.x + draftBond.current.x) / 2, y: (start.y + draftBond.current.y) / 2 };
              const control = {
                x: midpoint.x + normalize(perpendicular(delta)).x * length * BOND_CURVATURE,
                y: midpoint.y + normalize(perpendicular(delta)).y * length * BOND_CURVATURE
              };
              const head = arrowHeadGeometry(
                { kind: "free", x: draftBond.current.x, y: draftBond.current.y },
                control,
                draftBond.current,
                atomIndex
              );

              return (
                <>
                  <Shape
                    sceneFunc={(ctx, shape) => {
                      drawQuadraticCurve(ctx, start, control, head.shaftEnd);
                      ctx.strokeShape(shape);
                    }}
                    stroke="#67e8f9"
                    strokeWidth={3}
                    lineCap="round"
                    lineJoin="round"
                    dash={[10, 12]}
                    listening={false}
                  />
                  <Line
                    points={head.headPoints}
                    closed
                    fill="#67e8f9"
                    stroke="#67e8f9"
                    strokeWidth={1.25}
                    listening={false}
                  />
                </>
              );
            })()}

            {atoms.map((atom) => {
              const selected = selection?.kind === "atom" && selection.id === atom.id;

              return (
                <React.Fragment key={atom.id}>
                  <Circle
                    x={atom.x}
                    y={atom.y}
                    radius={atom.radius + (selected ? 10 : 0)}
                    fill={selected ? "rgba(56, 189, 248, 0.18)" : "rgba(0, 0, 0, 0)"}
                    listening={false}
                  />
                  <Circle
                    x={atom.x}
                    y={atom.y}
                    radius={atom.radius}
                    fill={selected ? "#1e293b" : "#0f172a"}
                    stroke={selected ? "#67e8f9" : "#475569"}
                    strokeWidth={selected ? 3 : 2}
                    onMouseDown={(event) => handleAtomMouseDown(atom, event)}
                    onDblClick={(event) => handleAtomDoubleClick(atom, event)}
                  />
                  {atom.label !== "" && (
                    <Text
                      x={atom.x - 88}
                      y={atom.y - 10}
                      width={176}
                      align="center"
                      text={atom.label}
                      fill="#e2e8f0"
                      fontSize={14}
                      fontStyle="600"
                      listening={false}
                    />
                  )}
                </React.Fragment>
              );
            })}

            {annotations.map((annotation) => {
              const selected = selection?.kind === "annotation" && selection.id === annotation.id;

              return (
                <Circle
                  key={annotation.id}
                  x={annotation.x}
                  y={annotation.y}
                  radius={selected ? ANNOTATION_RADIUS + 2 : ANNOTATION_RADIUS}
                  fill={selected ? "#fde68a" : "#f59e0b"}
                  stroke="#0f172a"
                  strokeWidth={2}
                  onMouseDown={(event) => {
                    event.cancelBubble = true;
                    setSelection({ kind: "annotation", id: annotation.id });
                    setAnnotationExpanded(annotation.id, true);
                    setAtomEditor(null);
                  }}
                />
              );
            })}

            {previewAtom && (
              <Circle
                x={previewAtom.x}
                y={previewAtom.y}
                radius={ATOM_RADIUS}
                fill="rgba(56, 189, 248, 0.12)"
                stroke="#38bdf8"
                strokeWidth={2}
                dash={[10, 10]}
                listening={false}
              />
            )}

            {placementMode === "annotation" && pointerWorld && (
              <Circle
                x={pointerWorld.x}
                y={pointerWorld.y}
                radius={ANNOTATION_RADIUS}
                fill="rgba(245, 158, 11, 0.65)"
                stroke="#fef3c7"
                strokeWidth={2}
                listening={false}
              />
            )}
          </Layer>
        </Stage>

        <div className="schema-overlay">
          <div className="schema-status-card">
            <div className="schema-status-card__row">
              <span className="schema-status-card__label">Schema</span>
              <strong>{schemaCode}</strong>
            </div>
            <p>{statusText}</p>
          </div>

          {atoms.length === 0 && bonds.length === 0 && annotations.length === 0 && placementMode === "none" && (
            <div className="schema-empty-state">
              <h2>Start with an atom.</h2>
              <p>Double-click empty space, click Add atom, or drop a bond into the workspace.</p>
            </div>
          )}

          {annotations.map((annotation) => {
            if (!annotation.expanded) {
              return null;
            }

            const screen = worldToScreen(annotation, view);
            const left = clamp(screen.x + 18, 16, Math.max(16, stageSize.width - 320));
            const top = clamp(screen.y + 18, 16, Math.max(16, stageSize.height - 260));

            return (
              <div
                key={`${annotation.id}-thread`}
                className="annotation-thread"
                style={{ left, top }}
              >
                <div className="annotation-thread__header">
                  <div>
                    <strong>Annotation</strong>
                    <p>Threaded notes for this point in the schema.</p>
                  </div>
                  <button
                    type="button"
                    className="annotation-thread__close"
                    aria-label="Collapse annotation"
                    onClick={() => setAnnotationExpanded(annotation.id, false)}
                  >
                    x
                  </button>
                </div>

                <div className="annotation-thread__messages">
                  {annotation.messages.length === 0 ? (
                    <p className="annotation-thread__empty">No replies yet. Start the thread below.</p>
                  ) : (
                    annotation.messages.map((message) => {
                      return (
                        <div key={message.id} className="annotation-thread__message">
                          <div className="annotation-thread__message-meta">
                            <strong>{message.author}</strong>
                            <span>{message.timestamp}</span>
                          </div>
                          <p>{message.body}</p>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="annotation-thread__composer">
                  <textarea
                    value={annotation.draftMessage}
                    onChange={(event) => updateAnnotationDraft(annotation.id, event.target.value)}
                    placeholder="Add a question or note..."
                  />
                  <button type="button" onClick={() => appendAnnotationMessage(annotation.id)}>
                    Send
                  </button>
                </div>
              </div>
            );
          })}

          {atomEditor && atomBeingEdited && atomEditorPosition && (
            <div
              className="atom-label-editor"
              style={{ left: atomEditorPosition.x, top: atomEditorPosition.y }}
            >
              <input
                id="atom-label-input"
                autoFocus
                type="text"
                value={atomEditor.value}
                placeholder="Label atom"
                onChange={(event) => {
                  setAtomEditor({ ...atomEditor, value: event.target.value });
                }}
                onBlur={saveAtomEditor}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveAtomEditor();
                  }

                  if (event.key === "Escape") {
                    setAtomEditor(null);
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
