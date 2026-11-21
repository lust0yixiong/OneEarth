import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Frame = { x: number; y: number; width: number; height: number };
type Direction = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const storageKey = "oneearth.chat-frame.v1";
const oldWidthKey = "oneearth.chat-width.v1";
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
function readFrame(): Frame | null {
  try {
    const frame = JSON.parse(localStorage.getItem(storageKey) || "null");
    return frame &&
      [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) &&
      frame.width > 0 &&
      frame.height > 0
      ? frame
      : null;
  } catch {
    return null;
  }
}

export function useChatLayout(open: boolean) {
  const [viewport, setViewport] = useState({
    width: innerWidth,
    height: innerHeight,
  });
  const [custom, setCustom] = useState<Frame | null>(readFrame);
  const [oldWidth, setOldWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(oldWidthKey)) || null;
    } catch {
      return null;
    }
  });
  const [interaction, setInteraction] = useState<Direction | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    frame: Frame;
    direction: Direction;
    last: Frame;
  } | null>(null);
  useEffect(() => {
    const resize = () =>
      setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (interaction)
      document.documentElement.dataset.panelInteraction =
        interaction === "move" ? "move" : "resize";
    return () => {
      delete document.documentElement.dataset.panelInteraction;
    };
  }, [interaction]);
  useEffect(() => {
    if (!open) {
      drag.current = null;
      setInteraction(null);
    }
  }, [open]);

  const navWidth = viewport.width <= 760 ? 48 : 52;
  const headerHeight = viewport.width <= 760 ? 56 : 66;
  const overlay = viewport.width <= 900;
  const available = viewport.width - navWidth;
  const bounds = {
    left: navWidth + 12,
    top: headerHeight + 12,
    right: viewport.width - 12,
    bottom: viewport.height - 12,
  };
  const maxWidth = Math.max(1, bounds.right - bounds.left);
  const maxHeight = Math.max(1, bounds.bottom - bounds.top);
  const minWidth = Math.min(overlay ? 280 : 360, maxWidth);
  const minHeight = Math.min(300, maxHeight);
  const defaultWidth = overlay
    ? Math.min(520, available) - 12
    : clamp(
        oldWidth ?? available * 0.4,
        380,
        Math.max(380, Math.min(760, available - 440)),
      ) - 12;
  const fit = (frame: Frame): Frame => {
    const width = clamp(frame.width, minWidth, maxWidth);
    const height = clamp(frame.height, minHeight, maxHeight);
    return {
      width,
      height,
      x: clamp(frame.x, bounds.left, bounds.right - width),
      y: clamp(frame.y, bounds.top, bounds.bottom - height),
    };
  };
  const defaultFrame = fit({
    x: viewport.width - 12 - defaultWidth,
    y: bounds.top,
    width: defaultWidth,
    height: maxHeight,
  });
  const frame = fit(custom ?? defaultFrame);
  // Freely positioned Chat floats over the map. Only a panel parked at the right
  // edge reserves space for map controls and the globe's visual center.
  const docked = bounds.right - frame.x - frame.width <= 12;
  const reserved =
    open && !overlay && docked
      ? Math.min(viewport.width - frame.x, available - 344)
      : 0;
  const remember = (value: Frame | null) => {
    setCustom(value);
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(oldWidthKey);
      }
    } catch {
      /* Layout still works without browser storage. */
    }
  };
  const reset = () => {
    setOldWidth(null);
    remember(null);
  };
  const alter = (
    start: Frame,
    direction: Direction,
    dx: number,
    dy: number,
  ) => {
    if (direction === "move")
      return fit({ ...start, x: start.x + dx, y: start.y + dy });
    let left = start.x,
      top = start.y,
      right = left + start.width,
      bottom = top + start.height;
    if (direction.includes("w"))
      left = clamp(left + dx, bounds.left, right - minWidth);
    if (direction.includes("e"))
      right = clamp(right + dx, left + minWidth, bounds.right);
    if (direction.includes("n"))
      top = clamp(top + dy, bounds.top, bottom - minHeight);
    if (direction.includes("s"))
      bottom = clamp(bottom + dy, top + minHeight, bounds.bottom);
    return fit({ x: left, y: top, width: right - left, height: bottom - top });
  };
  const finish = (cancelled = false) => {
    if (!drag.current) return;
    remember(cancelled ? drag.current.frame : drag.current.last);
    drag.current = null;
    setInteraction(null);
  };
  const pointerHandlers = (direction: Direction) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        frame,
        last: frame,
        direction,
      };
      setInteraction(direction);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const active = drag.current;
      if (!active || active.direction !== direction) return;
      const next = alter(
        active.frame,
        direction,
        event.clientX - active.x,
        event.clientY - active.y,
      );
      active.last = next;
      setCustom(next);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      finish();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => finish(true),
    onLostPointerCapture: () => finish(),
  });
  const keyboard =
    (direction: Direction) => (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        reset();
        return;
      }
      const step = event.shiftKey ? 8 : 24;
      const dx =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      const dy =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (!dx && !dy) return;
      event.preventDefault();
      remember(alter(frame, direction, dx, dy));
    };
  const style = {
    "--nav-width": `${navWidth}px`,
    "--header-height": `${headerHeight}px`,
    "--chat-width": `${reserved}px`,
    "--chat-pane-width": `${frame.width + 12}px`,
    "--data-dock-right": `${open && !overlay && frame.x - navWidth >= 360 ? viewport.width - frame.x : 0}px`,
  } as CSSProperties;
  return {
    style,
    frame,
    overlay,
    width: frame.width + 12,
    mapInset: reserved ? reserved + 24 : 0,
    resizing: interaction !== null && interaction !== "move",
    moving: interaction === "move",
    minWidth,
    maxWidth,
    reset,
    pointerHandlers,
    keyboard,
    panelStyle: {
      position: "fixed",
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      right: "auto",
      bottom: "auto",
    } as CSSProperties,
    boundaryStyle: {
      left: open ? frame.x - 5 : viewport.width - 10,
      top: frame.y,
      height: frame.height,
      right: "auto",
      bottom: "auto",
    } as CSSProperties,
  };
}
export type ChatLayout = ReturnType<typeof useChatLayout>;

const edges = ["n", "ne", "e", "se", "s", "sw", "nw"] as const;
const labels = {
  n: "上边缘",
  ne: "右上角",
  e: "右边缘",
  se: "右下角",
  s: "下边缘",
  sw: "左下角",
  nw: "左上角",
};
export function ChatResizeHandles({ layout }: { layout: ChatLayout }) {
  return (
    <div className="floating-resize-frame" aria-label="Chat 窗口大小">
      {edges.map((edge) => (
        <button
          key={edge}
          className={"floating-resize-edge edge-" + edge}
          aria-label={"调整 Chat " + labels[edge]}
          title={"拖动" + labels[edge] + "调整大小"}
          {...layout.pointerHandlers(edge)}
          onKeyDown={layout.keyboard(edge)}
        />
      ))}
      <span className="floating-resize-mark" aria-hidden="true" />
    </div>
  );
}

export function ChatBoundary({
  open,
  onToggle,
  layout,
}: {
  open: boolean;
  onToggle: () => void;
  layout: ChatLayout;
}) {
  return (
    <div className="chat-boundary" style={layout.boundaryStyle}>
      {open && (
        <div
          className="chat-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label="调整 Chat 宽度"
          aria-orientation="vertical"
          aria-controls="oneearth-chat-panel"
          aria-valuemin={layout.minWidth}
          aria-valuemax={layout.maxWidth}
          aria-valuenow={Math.round(layout.frame.width)}
          aria-valuetext={`${Math.round(layout.frame.width)} 像素`}
          title="拖动调整 Chat 宽度，双击恢复默认布局"
          {...layout.pointerHandlers("w")}
          onDoubleClick={layout.reset}
          onKeyDown={layout.keyboard("w")}
        />
      )}
      <button
        className="chat-boundary-toggle"
        aria-label={open ? "收起 Chat" : "打开 Chat"}
        aria-expanded={open}
        aria-controls="oneearth-chat-panel"
        title={open ? "收起 Chat" : "展开 Chat"}
        onClick={onToggle}
      >
        {open ? (
          <ChevronRight size={18} />
        ) : (
          <span className="collapsed-chat-name">Chat</span>
        )}
      </button>
    </div>
  );
}
