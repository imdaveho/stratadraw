import React, { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Circle, Group, Layer, Rect, Shape, Stage, Text } from "react-konva"
import { Presence, Socket } from "phoenix"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { basicSetup } from "codemirror"
import { markdown as markdownLanguage } from "@codemirror/lang-markdown"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { yCollab } from "y-codemirror.next"
import { marked } from "marked"
import DOMPurify from "dompurify"

type Tool = "pan" | "select" | "atom" | "bond" | "annotation"
type Selection = null | { kind: "atom" | "bond" | "annotation"; id: string }

type DocumentInfo = {
  id: string
  kind: "atom" | "annotation"
  markdown: string
  ydoc_state: string
  atom_id?: string | null
  annotation_id?: string | null
}

type AtomShape = {
  id: string
  label: string
  x: number
  y: number
  radius: number
  fill_color: string
  stroke_color: string
  document: DocumentInfo | null
}

type BondShape = {
  id: string
  label: string
  curvature: number
  source_atom_id: string
  target_atom_id: string
}

type AnnotationShape = {
  id: string
  x: number
  y: number
  width: number
  height: number
  fill_color: string
  document: DocumentInfo | null
}

type PresenceMember = {
  user_id: string
  email: string
  color: string
}

type BoardPayload = {
  current_user: { id: string; email: string }
  pattern: { id: string; name: string; description?: string }
  members: PresenceMember[]
  atoms: AtomShape[]
  bonds: BondShape[]
  annotations: AnnotationShape[]
}

const TOOL_LABELS: Array<{ tool: Tool; label: string }> = [
  { tool: "pan", label: "Pan" },
  { tool: "select", label: "Select" },
  { tool: "atom", label: "Atom" },
  { tool: "bond", label: "Bond" },
  { tool: "annotation", label: "Annotation" }
]

function decodePayload(encoded: string) {
  return JSON.parse(window.atob(encoded)) as BoardPayload
}

function encodeBinary(data: Uint8Array) {
  let binary = ""

  for (let index = 0; index < data.length; index += 1) {
    binary += String.fromCharCode(data[index])
  }

  return window.btoa(binary)
}

function decodeBinary(data: string) {
  const binary = window.atob(data || "")
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const index = items.findIndex((item) => item.id === nextItem.id)

  if (index === -1) {
    return [...items, nextItem]
  }

  const next = [...items]
  next[index] = nextItem
  return next
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function flattenPresence(presence: Presence) {
  return presence.list((userId, data) => {
    const firstMeta = data.metas[0] || {}

    return {
      user_id: userId,
      email: firstMeta.email || "Collaborator",
      color: firstMeta.color || "#94a3b8"
    }
  }) as PresenceMember[]
}

function toWorldPoint(pointer: { x: number; y: number }, camera: { x: number; y: number; scale: number }) {
  return {
    x: (pointer.x - camera.x) / camera.scale,
    y: (pointer.y - camera.y) / camera.scale
  }
}

function toScreenPoint(point: { x: number; y: number }, camera: { x: number; y: number; scale: number }) {
  return {
    x: point.x * camera.scale + camera.x,
    y: point.y * camera.scale + camera.y
  }
}

function magnitude(x: number, y: number) {
  return Math.sqrt(x * x + y * y) || 1
}

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/[#>*_~\-\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function bondGeometry(
  source: { x: number; y: number; radius: number },
  target: { x: number; y: number; radius: number },
  curvature: number
) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = magnitude(dx, dy)
  const nx = -dy / length
  const ny = dx / length
  const midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
  const control = {
    x: midpoint.x + nx * length * curvature,
    y: midpoint.y + ny * length * curvature
  }

  const sourceVectorX = control.x - source.x
  const sourceVectorY = control.y - source.y
  const sourceVectorLength = magnitude(sourceVectorX, sourceVectorY)
  const start = {
    x: source.x + (sourceVectorX / sourceVectorLength) * source.radius,
    y: source.y + (sourceVectorY / sourceVectorLength) * source.radius
  }

  const targetVectorX = control.x - target.x
  const targetVectorY = control.y - target.y
  const targetVectorLength = magnitude(targetVectorX, targetVectorY)
  const end = {
    x: target.x + (targetVectorX / targetVectorLength) * target.radius,
    y: target.y + (targetVectorY / targetVectorLength) * target.radius
  }

  const tangentX = end.x - control.x
  const tangentY = end.y - control.y

  return {
    midpoint,
    control,
    start,
    end,
    angle: Math.atan2(tangentY, tangentX)
  }
}

function pushWithReply(channel: any, event: string, payload: any) {
  return new Promise<any>((resolve, reject) => {
    channel
      .push(event, payload)
      .receive("ok", resolve)
      .receive("error", reject)
      .receive("timeout", () => reject({ reason: "timeout" }))
  })
}

class DocumentBridge {
  socket: Socket
  documentId: string
  channel: any
  doc: Y.Doc
  text: Y.Text
  awareness: Awareness
  onMarkdownChange: (markdown: string) => void
  handleUpdate: (update: Uint8Array, origin: unknown) => void
  handleRemote: (payload: any) => void
  remoteRef: number | null

  constructor(socket: Socket, documentId: string, user: PresenceMember, onMarkdownChange: (markdown: string) => void) {
    this.socket = socket
    this.documentId = documentId
    this.channel = socket.channel(`document:${documentId}`, {})
    this.doc = new Y.Doc()
    this.text = this.doc.getText("content")
    this.awareness = new Awareness(this.doc)
    this.awareness.setLocalStateField("user", { name: user.email, color: user.color })
    this.onMarkdownChange = onMarkdownChange
    this.remoteRef = null

    this.handleUpdate = (update, origin) => {
      if (origin === "remote") {
        return
      }

      const markdown = this.text.toString()
      this.onMarkdownChange(markdown)

      this.channel.push("document:update", {
        update: encodeBinary(update),
        snapshot: encodeBinary(Y.encodeStateAsUpdate(this.doc)),
        markdown
      })
    }

    this.handleRemote = (payload) => {
      if (payload.update) {
        Y.applyUpdate(this.doc, decodeBinary(payload.update), "remote")
      }

      this.onMarkdownChange(payload.markdown ?? this.text.toString())
    }
  }

  connect() {
    return new Promise<DocumentInfo>((resolve, reject) => {
      this.channel
        .join()
        .receive("ok", ({ document }: { document: DocumentInfo }) => {
          if (document.ydoc_state) {
            Y.applyUpdate(this.doc, decodeBinary(document.ydoc_state), "bootstrap")
          } else if (document.markdown) {
            this.text.insert(0, document.markdown)
          }

          this.remoteRef = this.channel.on("document:updated", this.handleRemote)
          this.doc.on("update", this.handleUpdate)
          this.onMarkdownChange(this.text.toString())
          resolve(document)
        })
        .receive("error", reject)
        .receive("timeout", () => reject(new Error("timeout")))
    })
  }

  destroy() {
    this.doc.off("update", this.handleUpdate)
    if (this.remoteRef !== null) {
      this.channel.off("document:updated", this.remoteRef)
    }
    this.channel.leave()
    this.awareness.destroy()
    this.doc.destroy()
  }
}

function BondPath({
  source,
  target,
  curvature,
  selected,
  onClick
}: {
  source: { x: number; y: number; radius: number }
  target: { x: number; y: number; radius: number }
  curvature: number
  selected?: boolean
  onClick?: () => void
}) {
  const { start, control, end, angle } = bondGeometry(source, target, curvature)

  return (
    <Shape
      listening={Boolean(onClick)}
      hitStrokeWidth={28}
      onClick={(event) => {
        event.cancelBubble = true
        onClick?.()
      }}
      onTap={(event) => {
        event.cancelBubble = true
        onClick?.()
      }}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
        ctx.lineWidth = selected ? 4 : 3
        ctx.strokeStyle = selected ? "#f97316" : "#d5dff5"
        ctx.stroke()

        const arrowSize = 14
        const left = angle + Math.PI * 0.88
        const right = angle - Math.PI * 0.88

        ctx.beginPath()
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x + Math.cos(left) * arrowSize, end.y + Math.sin(left) * arrowSize)
        ctx.lineTo(end.x + Math.cos(right) * arrowSize, end.y + Math.sin(right) * arrowSize)
        ctx.closePath()
        ctx.fillStyle = selected ? "#f97316" : "#d5dff5"
        ctx.fill()

        ctx.fillStrokeShape(shape)
      }}
    />
  )
}

function CollaborativeMarkdownEditor({
  socket,
  document,
  member,
  onMarkdownChange
}: {
  socket: Socket
  document: DocumentInfo
  member: PresenceMember
  onMarkdownChange: (markdown: string) => void
}) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [markdown, setMarkdown] = useState(document.markdown || "")
  const deferredMarkdown = useDeferredValue(markdown)

  useEffect(() => {
    let bridge: DocumentBridge | null = null
    let view: EditorView | null = null

    if (!editorRef.current) {
      return
    }

    bridge = new DocumentBridge(socket, document.id, member, (nextMarkdown) => {
      setMarkdown(nextMarkdown)
      onMarkdownChange(nextMarkdown)
    })

    bridge
      .connect()
      .then(() => {
        if (!editorRef.current || !bridge) {
          return
        }

        view = new EditorView({
          parent: editorRef.current,
          state: EditorState.create({
            doc: "",
            extensions: [
              basicSetup,
              markdownLanguage(),
              EditorView.lineWrapping,
              EditorView.theme({
                "&": {
                  minHeight: "15rem",
                  backgroundColor: "transparent",
                  color: "inherit",
                  fontSize: "0.95rem"
                },
                ".cm-scroller": { overflow: "auto" },
                ".cm-content": { padding: "1rem" },
                ".cm-gutters": {
                  backgroundColor: "rgba(148, 163, 184, 0.08)",
                  color: "rgba(100, 116, 139, 0.9)",
                  border: "none"
                },
                ".cm-activeLine, .cm-activeLineGutter": {
                  backgroundColor: "rgba(59, 130, 246, 0.08)"
                }
              }),
              yCollab(bridge.text, bridge.awareness)
            ]
          })
        })
      })
      .catch(() => {
        setMarkdown(document.markdown || "")
      })

    return () => {
      view?.destroy()
      bridge?.destroy()
    }
  }, [document.id, document.markdown, member, onMarkdownChange, socket])

  const previewHtml = useMemo(() => {
    return DOMPurify.sanitize(String(marked.parse(deferredMarkdown || "")))
  }, [deferredMarkdown])

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-3xl border border-base-300 bg-base-100/70">
        <div ref={editorRef} className="min-h-60" />
      </div>

      <div className="rounded-3xl border border-base-300 bg-base-100/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/50">Preview</p>
        <div
          className="prose prose-sm mt-4 max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    </div>
  )
}

function StratadrawBoard({ payload, socketToken }: { payload: BoardPayload; socketToken: string }) {
  const [atoms, setAtoms] = useState(payload.atoms)
  const [bonds, setBonds] = useState(payload.bonds)
  const [annotations, setAnnotations] = useState(payload.annotations)
  const [presenceMembers, setPresenceMembers] = useState<PresenceMember[]>(payload.members)
  const [tool, setTool] = useState<Tool>("select")
  const [selected, setSelected] = useState<Selection>(null)
  const [editingAtomId, setEditingAtomId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState("")
  const [bondDraft, setBondDraft] = useState<{ sourceAtomId: string; pointer: { x: number; y: number } } | null>(null)
  const [remoteCursors, setRemoteCursors] = useState<Record<string, { point: { x: number; y: number }; tool: Tool }>>({})
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 })
  const [viewport, setViewport] = useState({ width: 1200, height: 800 })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<any>(null)
  const socketRef = useRef<Socket | null>(null)
  const channelRef = useRef<any>(null)
  const cursorSyncRef = useRef(0)

  const atomMap = useMemo(() => new Map(atoms.map((atom) => [atom.id, atom])), [atoms])
  const annotationMap = useMemo(
    () => new Map(annotations.map((annotation) => [annotation.id, annotation])),
    [annotations]
  )
  const bondMap = useMemo(() => new Map(bonds.map((bond) => [bond.id, bond])), [bonds])

  const currentMember =
    presenceMembers.find((member) => member.user_id === payload.current_user.id) ||
    ({ user_id: payload.current_user.id, email: payload.current_user.email, color: "#06b6d4" } as PresenceMember)

  const selectedAtom = selected?.kind === "atom" ? atomMap.get(selected.id) || null : null
  const selectedAnnotation =
    selected?.kind === "annotation" ? annotationMap.get(selected.id) || null : null
  const selectedBond = selected?.kind === "bond" ? bondMap.get(selected.id) || null : null
  const selectedDocument = selectedAtom?.document || selectedAnnotation?.document || null

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      const nextWidth = entry.contentRect.width
      const nextHeight = entry.contentRect.height
      setViewport({ width: nextWidth, height: nextHeight })
    })

    resizeObserver.observe(rootRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const socket = new Socket("/socket", { params: { token: socketToken } })
    socket.connect()

    const channel = socket.channel(`pattern:${payload.pattern.id}`, {})
    const presence = new Presence(channel)

    presence.onSync(() => {
      setPresenceMembers(flattenPresence(presence))
    })

    channel.on("atom:upserted", (atom: AtomShape) => {
      setAtoms((current) => upsertById(current, atom))
    })

    channel.on("atom:deleted", ({ id }: { id: string }) => {
      setAtoms((current) => removeById(current, id))
      setBonds((current) => current.filter((bond) => bond.source_atom_id !== id && bond.target_atom_id !== id))
      setSelected((current) => (current?.id === id ? null : current))
    })

    channel.on("bond:upserted", (bond: BondShape) => {
      setBonds((current) => upsertById(current, bond))
    })

    channel.on("bond:deleted", ({ id }: { id: string }) => {
      setBonds((current) => removeById(current, id))
      setSelected((current) => (current?.id === id ? null : current))
    })

    channel.on("annotation:upserted", (annotation: AnnotationShape) => {
      setAnnotations((current) => upsertById(current, annotation))
    })

    channel.on("annotation:deleted", ({ id }: { id: string }) => {
      setAnnotations((current) => removeById(current, id))
      setSelected((current) => (current?.id === id ? null : current))
    })

    channel.on("cursor:moved", ({ user_id, point, tool: cursorTool }: any) => {
      if (user_id === payload.current_user.id || !point) {
        return
      }

      setRemoteCursors((current) => ({
        ...current,
        [user_id]: { point, tool: cursorTool || "select" }
      }))
    })

    channel.on("document:updated", ({ id, markdown }: { id: string; markdown: string }) => {
      setAtoms((current) =>
        current.map((atom) =>
          atom.document?.id === id ? { ...atom, document: { ...atom.document, markdown } } : atom
        )
      )

      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.document?.id === id
            ? { ...annotation, document: { ...annotation.document, markdown } }
            : annotation
        )
      )
    })

    channel
      .join()
      .receive("ok", () => setPresenceMembers(flattenPresence(presence)))
      .receive("error", () => undefined)

    socketRef.current = socket
    channelRef.current = channel

    return () => {
      channel.leave()
      socket.disconnect()
    }
  }, [payload.current_user.email, payload.current_user.id, payload.pattern.id, socketToken])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRemoteCursors((current) => {
        const next = { ...current }
        return next
      })
    }, 4000)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!editingAtomId) {
      return
    }

    const atom = atomMap.get(editingAtomId)
    if (!atom) {
      setEditingAtomId(null)
      setEditingLabel("")
      return
    }

    setEditingLabel(atom.label)
  }, [atomMap, editingAtomId])

  const sendCursor = (point: { x: number; y: number }) => {
    const channel = channelRef.current
    const now = Date.now()

    if (!channel || now - cursorSyncRef.current < 60) {
      return
    }

    cursorSyncRef.current = now
    channel.push("cursor:move", { point, tool })
  }

  const updateDocumentMarkdown = (documentId: string, markdown: string) => {
    setAtoms((current) =>
      current.map((atom) =>
        atom.document?.id === documentId ? { ...atom, document: { ...atom.document, markdown } } : atom
      )
    )

    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.document?.id === documentId
          ? { ...annotation, document: { ...annotation.document, markdown } }
          : annotation
      )
    )
  }

  const handleStageWheel = (event: any) => {
    event.evt.preventDefault()

    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) {
      return
    }

    const zoomDirection = event.evt.deltaY > 0 ? -1 : 1
    const nextScale = clamp(camera.scale * (zoomDirection > 0 ? 1.08 : 1 / 1.08), 0.4, 2.5)
    const worldPoint = toWorldPoint(pointer, camera)

    setCamera({
      scale: nextScale,
      x: pointer.x - worldPoint.x * nextScale,
      y: pointer.y - worldPoint.y * nextScale
    })
  }

  const handleStageMouseMove = () => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) {
      return
    }

    const worldPoint = toWorldPoint(pointer, camera)
    sendCursor(worldPoint)

    if (bondDraft) {
      setBondDraft({ ...bondDraft, pointer: worldPoint })
    }
  }

  const handleStageMouseDown = async (event: any) => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) {
      return
    }

    const worldPoint = toWorldPoint(pointer, camera)
    const targetName = typeof event.target.name === "function" ? event.target.name() : ""
    const clickedOnEmpty = event.target === stage || targetName === "canvas-background"

    if (!clickedOnEmpty) {
      return
    }

    if (tool === "atom") {
      const response = await pushWithReply(channelRef.current, "atom:create", worldPoint)
      setSelected({ kind: "atom", id: response.id })
      return
    }

    if (tool === "annotation") {
      const response = await pushWithReply(channelRef.current, "annotation:create", worldPoint)
      setSelected({ kind: "annotation", id: response.id })
      return
    }

    if (tool === "bond") {
      setBondDraft(null)
      return
    }

    setSelected(null)
  }

  const commitAtomLabel = async () => {
    if (!editingAtomId) {
      return
    }

    const atom = atomMap.get(editingAtomId)
    if (!atom) {
      setEditingAtomId(null)
      return
    }

    setEditingAtomId(null)
    setAtoms((current) =>
      current.map((item) => (item.id === atom.id ? { ...item, label: editingLabel } : item))
    )

    await pushWithReply(channelRef.current, "atom:update", {
      id: atom.id,
      attrs: { label: editingLabel }
    }).catch(() => undefined)
  }

  const handleAtomClick = async (atom: AtomShape, event: any) => {
    event.cancelBubble = true

    if (tool === "bond") {
      if (!bondDraft) {
        setBondDraft({ sourceAtomId: atom.id, pointer: { x: atom.x, y: atom.y } })
        return
      }

      if (bondDraft.sourceAtomId !== atom.id) {
        await pushWithReply(channelRef.current, "bond:create", {
          source_atom_id: bondDraft.sourceAtomId,
          target_atom_id: atom.id,
          curvature: 0.35,
          label: ""
        }).catch(() => undefined)
      }

      setBondDraft(null)
      setTool("select")
      return
    }

    setSelected({ kind: "atom", id: atom.id })
  }

  const handleAnnotationClick = (annotation: AnnotationShape, event: any) => {
    event.cancelBubble = true
    setSelected({ kind: "annotation", id: annotation.id })
  }

  const handleBondClick = (bond: BondShape) => {
    if (tool !== "select") {
      return
    }

    setSelected({ kind: "bond", id: bond.id })
  }

  const previewSource = bondDraft ? atomMap.get(bondDraft.sourceAtomId) || null : null

  return (
    <div className="stratadraw-board-page">
      <div className="stratadraw-board-canvas" ref={rootRef}>
        <div className="stratadraw-toolbar">
          <div className="rounded-full border border-white/10 bg-slate-950/80 p-2 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-2">
              {TOOL_LABELS.map((option) => (
                <button
                  key={option.tool}
                  type="button"
                  onClick={() => {
                    setTool(option.tool)
                    if (option.tool !== "bond") {
                      setBondDraft(null)
                    }
                  }}
                  className={[
                    "rounded-full px-4 py-2 text-sm font-medium transition",
                    tool === option.tool
                      ? "bg-cyan-400 text-slate-950"
                      : "bg-white/5 text-slate-100 hover:bg-white/10"
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="stratadraw-canvas-surface">
          <Stage
            ref={stageRef}
            width={viewport.width}
            height={viewport.height}
            x={camera.x}
            y={camera.y}
            scaleX={camera.scale}
            scaleY={camera.scale}
            draggable={tool === "pan"}
            onDragMove={(event) => {
              setCamera((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))
            }}
            onWheel={handleStageWheel}
            onMouseMove={handleStageMouseMove}
            onMouseDown={handleStageMouseDown}
            onTap={handleStageMouseDown}
          >
            <Layer>
              <Rect name="canvas-background" x={-200000} y={-200000} width={400000} height={400000} fill="rgba(0,0,0,0)" />

              {bonds.map((bond) => {
                const source = atomMap.get(bond.source_atom_id)
                const target = atomMap.get(bond.target_atom_id)
                if (!source || !target) {
                  return null
                }

                return (
                  <BondPath
                    key={bond.id}
                    source={source}
                    target={target}
                    curvature={bond.curvature}
                    selected={selected?.kind === "bond" && selected.id === bond.id}
                    onClick={() => handleBondClick(bond)}
                  />
                )
              })}

              {previewSource && bondDraft && (
                <BondPath
                  source={previewSource}
                  target={{ ...bondDraft.pointer, radius: 0 }}
                  curvature={0.35}
                />
              )}

              {annotations.map((annotation) => (
                <Group
                  key={annotation.id}
                  x={annotation.x}
                  y={annotation.y}
                  draggable={tool === "select"}
                  onDragMove={(event) => {
                    const position = event.target.position()
                    setAnnotations((current) =>
                      current.map((item) =>
                        item.id === annotation.id ? { ...item, x: position.x, y: position.y } : item
                      )
                    )
                  }}
                  onDragEnd={(event) => {
                    const position = event.target.position()
                    pushWithReply(channelRef.current, "annotation:update", {
                      id: annotation.id,
                      attrs: { x: position.x, y: position.y }
                    }).catch(() => undefined)
                  }}
                  onClick={(event) => handleAnnotationClick(annotation, event)}
                  onTap={(event) => handleAnnotationClick(annotation, event)}
                >
                  <Rect
                    width={annotation.width}
                    height={annotation.height}
                    cornerRadius={24}
                    fill={annotation.fill_color}
                    stroke={selected?.kind === "annotation" && selected.id === annotation.id ? "#0f172a" : "#d6c94d"}
                    strokeWidth={selected?.kind === "annotation" && selected.id === annotation.id ? 3 : 2}
                    shadowColor="rgba(15, 23, 42, 0.22)"
                    shadowBlur={24}
                    shadowOpacity={0.22}
                    shadowOffsetY={14}
                  />
                  <Text
                    x={16}
                    y={16}
                    width={annotation.width - 32}
                    height={annotation.height - 32}
                    fontSize={16}
                    lineHeight={1.4}
                    fill="#2f2a06"
                    text={stripMarkdown(annotation.document?.markdown || "") || "Annotation"}
                  />
                </Group>
              ))}

              {atoms.map((atom) => (
                <Group
                  key={atom.id}
                  x={atom.x}
                  y={atom.y}
                  draggable={tool === "select"}
                  onDragMove={(event) => {
                    const position = event.target.position()
                    setAtoms((current) =>
                      current.map((item) =>
                        item.id === atom.id ? { ...item, x: position.x, y: position.y } : item
                      )
                    )
                  }}
                  onDragEnd={(event) => {
                    const position = event.target.position()
                    pushWithReply(channelRef.current, "atom:update", {
                      id: atom.id,
                      attrs: { x: position.x, y: position.y }
                    }).catch(() => undefined)
                  }}
                  onClick={(event) => handleAtomClick(atom, event)}
                  onTap={(event) => handleAtomClick(atom, event)}
                  onDblClick={(event) => {
                    event.cancelBubble = true
                    if (tool !== "select") {
                      return
                    }

                    setSelected({ kind: "atom", id: atom.id })
                    setEditingAtomId(atom.id)
                  }}
                >
                  <Circle
                    radius={atom.radius}
                    fill={atom.fill_color}
                    stroke={selected?.kind === "atom" && selected.id === atom.id ? "#f97316" : atom.stroke_color}
                    strokeWidth={selected?.kind === "atom" && selected.id === atom.id ? 5 : 3}
                    shadowColor="rgba(15, 23, 42, 0.26)"
                    shadowBlur={32}
                    shadowOpacity={0.24}
                    shadowOffsetY={18}
                  />
                  <Text
                    x={-atom.radius + 12}
                    y={-20}
                    width={atom.radius * 2 - 24}
                    align="center"
                    verticalAlign="middle"
                    fontSize={18}
                    fontStyle="600"
                    fill="#04273c"
                    text={atom.label || "Double click to label"}
                  />
                </Group>
              ))}

              {selectedBond && (() => {
                const source = atomMap.get(selectedBond.source_atom_id)
                const target = atomMap.get(selectedBond.target_atom_id)
                if (!source || !target) {
                  return null
                }

                const geometry = bondGeometry(source, target, selectedBond.curvature)

                return (
                  <Circle
                    x={geometry.control.x}
                    y={geometry.control.y}
                    radius={10}
                    fill="#f97316"
                    stroke="#fff7ed"
                    strokeWidth={3}
                    draggable={tool === "select"}
                    onDragMove={(event) => {
                      const handle = event.target.position()
                      const dx = target.x - source.x
                      const dy = target.y - source.y
                      const length = magnitude(dx, dy)
                      const nx = -dy / length
                      const ny = dx / length
                      const midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
                      const signedDistance = (handle.x - midpoint.x) * nx + (handle.y - midpoint.y) * ny
                      const curvature = clamp(signedDistance / length, -1.5, 1.5)

                      setBonds((current) =>
                        current.map((bond) =>
                          bond.id === selectedBond.id ? { ...bond, curvature } : bond
                        )
                      )
                    }}
                    onDragEnd={(event) => {
                      const handle = event.target.position()
                      const dx = target.x - source.x
                      const dy = target.y - source.y
                      const length = magnitude(dx, dy)
                      const nx = -dy / length
                      const ny = dx / length
                      const midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
                      const signedDistance = (handle.x - midpoint.x) * nx + (handle.y - midpoint.y) * ny
                      const curvature = clamp(signedDistance / length, -1.5, 1.5)

                      pushWithReply(channelRef.current, "bond:update", {
                        id: selectedBond.id,
                        attrs: { curvature }
                      }).catch(() => undefined)
                    }}
                  />
                )
              })()}

              {Object.entries(remoteCursors).map(([userId, cursor]) => (
                <Group key={userId} x={cursor.point.x} y={cursor.point.y} listening={false}>
                  <Circle radius={8} fill={presenceMembers.find((member) => member.user_id === userId)?.color || "#94a3b8"} />
                  <Text
                    x={12}
                    y={-8}
                    fontSize={12}
                    padding={6}
                    fill="#e2e8f0"
                    text={presenceMembers.find((member) => member.user_id === userId)?.email || "Collaborator"}
                  />
                </Group>
              ))}
            </Layer>
          </Stage>

          {editingAtomId && selectedAtom && (() => {
            const center = toScreenPoint({ x: selectedAtom.x, y: selectedAtom.y }, camera)
            const diameter = selectedAtom.radius * 2 * camera.scale

            return (
              <input
                autoFocus
                className="stratadraw-label-editor"
                style={{
                  left: `${center.x - diameter / 2 + 10}px`,
                  top: `${center.y - 20}px`,
                  width: `${Math.max(diameter - 20, 120)}px`
                }}
                value={editingLabel}
                onChange={(event) => setEditingLabel(event.target.value)}
                onBlur={() => void commitAtomLabel()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void commitAtomLabel()
                  }

                  if (event.key === "Escape") {
                    event.preventDefault()
                    setEditingAtomId(null)
                    setEditingLabel(selectedAtom.label)
                  }
                }}
              />
            )
          })()}
        </div>
      </div>

      <aside className="stratadraw-side-panel">
        <div className="rounded-[2rem] border border-base-300 bg-base-100/90 p-6 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/50">
                {payload.pattern.name}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                {selectedAtom
                  ? selectedAtom.label || "Untitled atom"
                  : selectedAnnotation
                    ? "Annotation"
                    : selectedBond
                      ? "Bond"
                      : "Pattern details"}
              </h2>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {presenceMembers.map((member) => (
                <span
                  key={member.user_id}
                  className="inline-flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: member.color }}></span>
                  {member.email}
                </span>
              ))}
            </div>
          </div>

          {selectedBond ? (
            <div className="mt-8 rounded-3xl border border-base-300 bg-base-100/70 p-4">
              <p className="text-sm font-medium">Curvature</p>
              <input
                type="range"
                min={-1.5}
                max={1.5}
                step={0.01}
                value={selectedBond.curvature}
                className="range range-primary mt-4"
                onChange={(event) => {
                  const curvature = Number(event.target.value)

                  setBonds((current) =>
                    current.map((bond) =>
                      bond.id === selectedBond.id ? { ...bond, curvature } : bond
                    )
                  )

                  pushWithReply(channelRef.current, "bond:update", {
                    id: selectedBond.id,
                    attrs: { curvature }
                  }).catch(() => undefined)
                }}
              />
            </div>
          ) : null}

          {selectedDocument && socketRef.current ? (
            <div className="mt-8">
              <CollaborativeMarkdownEditor
                key={selectedDocument.id}
                socket={socketRef.current}
                document={selectedDocument}
                member={currentMember}
                onMarkdownChange={(markdown) => updateDocumentMarkdown(selectedDocument.id, markdown)}
              />
            </div>
          ) : (
            <div className="mt-8 rounded-3xl border border-dashed border-base-300 bg-base-100/60 p-6 text-sm text-base-content/65">
              <p>
                Select an atom to edit its capability documentation, or select an annotation to collaborate on shared notes.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function mountBoard() {
  const element = document.getElementById("stratadraw-board-root") as HTMLDivElement | null

  if (!element) {
    return
  }

  const payload = decodePayload(element.dataset.boardPayload || "")
  const socketToken = element.dataset.socketToken || ""
  createRoot(element).render(<StratadrawBoard payload={payload} socketToken={socketToken} />)
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountBoard)
} else {
  mountBoard()
}
