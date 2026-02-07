import type { ExpandMode } from "@headless-paint/engine";
import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import type { ToolType } from "./usePointerHandler";

export interface KeyboardShortcutsDeps {
  readonly tool: ToolType;
  readonly setTool: (tool: ToolType) => void;
  readonly sessionRef: MutableRefObject<unknown | null>;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly expandMode: ExpandMode;
  readonly setExpandMode: (mode: ExpandMode) => void;
  readonly expandDivisions: number;
  readonly setExpandDivisions: (n: number) => void;
  readonly lineWidth: number;
  readonly setLineWidth: (w: number) => void;
}

/** hold-switch用の単キーマッピング */
const HOLD_SWITCH_KEYS: Record<string, ToolType> = {
  s: "scroll",
  o: "offset",
  z: "zoom",
  r: "rotate",
};

/** symmetryモード切替サイクル (axialはスキップ) */
const SYMMETRY_CYCLE: Record<string, ExpandMode> = {
  none: "radial",
  axial: "radial",
  radial: "kaleidoscope",
  kaleidoscope: "none",
};

const MIN_DIVISIONS = 2;
const MAX_DIVISIONS = 12;
const MIN_LINE_WIDTH = 1;
const MAX_LINE_WIDTH = 50;

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

/** Space + 修飾キーの組み合わせからツールを解決 */
function resolveSpaceTool(e: KeyboardEvent): ToolType {
  if (e.altKey) return "rotate";
  if (e.metaKey || e.ctrlKey) return "zoom";
  if (e.shiftKey) return "offset";
  return "scroll";
}

export function useKeyboardShortcuts(deps: KeyboardShortcutsDeps): void {
  // ref-sync: 全依存値をrefで追跡し、イベントハンドラを安定させる
  const toolRef = useRef(deps.tool);
  toolRef.current = deps.tool;

  const setToolRef = useRef(deps.setTool);
  setToolRef.current = deps.setTool;

  const sessionRef = deps.sessionRef;

  const onUndoRef = useRef(deps.onUndo);
  onUndoRef.current = deps.onUndo;

  const onRedoRef = useRef(deps.onRedo);
  onRedoRef.current = deps.onRedo;

  const expandModeRef = useRef(deps.expandMode);
  expandModeRef.current = deps.expandMode;

  const setExpandModeRef = useRef(deps.setExpandMode);
  setExpandModeRef.current = deps.setExpandMode;

  const expandDivisionsRef = useRef(deps.expandDivisions);
  expandDivisionsRef.current = deps.expandDivisions;

  const setExpandDivisionsRef = useRef(deps.setExpandDivisions);
  setExpandDivisionsRef.current = deps.setExpandDivisions;

  const lineWidthRef = useRef(deps.lineWidth);
  lineWidthRef.current = deps.lineWidth;

  const setLineWidthRef = useRef(deps.setLineWidth);
  setLineWidthRef.current = deps.setLineWidth;

  // hold-switch内部状態
  const baseToolRef = useRef<ToolType | null>(null);
  const spaceHeldRef = useRef(false);
  const altHeldRef = useRef(false);

  useEffect(() => {
    function activateHoldSwitch(newTool: ToolType): void {
      if (baseToolRef.current === null) {
        baseToolRef.current = toolRef.current;
      }
      setToolRef.current(newTool);
    }

    function deactivateHoldSwitch(): void {
      if (baseToolRef.current !== null) {
        setToolRef.current(baseToolRef.current);
        baseToolRef.current = null;
      }
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (isInputFocused()) return;

      // 1. Cmd/Ctrl+Z → undo/redo (最優先)
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          onRedoRef.current();
        } else {
          onUndoRef.current();
        }
        return;
      }

      // 2. Space押下中に修飾キー → ツール再評価 (isMod委譲より先に処理)
      if (
        spaceHeldRef.current &&
        (e.key === "Shift" ||
          e.key === "Meta" ||
          e.key === "Control" ||
          e.key === "Alt")
      ) {
        setToolRef.current(resolveSpaceTool(e));
        return;
      }

      // Cmd/Ctrl + 他のキーはブラウザに委譲 (Cmd+R, Cmd+Sなど)
      if (isMod) return;

      // 3. トグル/増減ショートカット
      switch (e.key) {
        case "k": {
          if (e.repeat) return;
          e.preventDefault();
          const current = expandModeRef.current;
          setExpandModeRef.current(SYMMETRY_CYCLE[current] ?? "none");
          return;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const next = Math.max(MIN_DIVISIONS, expandDivisionsRef.current - 1);
          setExpandDivisionsRef.current(next);
          return;
        }
        case "ArrowRight": {
          e.preventDefault();
          const next = Math.min(MAX_DIVISIONS, expandDivisionsRef.current + 1);
          setExpandDivisionsRef.current(next);
          return;
        }
        case "ArrowUp": {
          e.preventDefault();
          const next = Math.min(MAX_LINE_WIDTH, lineWidthRef.current + 1);
          setLineWidthRef.current(next);
          return;
        }
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.max(MIN_LINE_WIDTH, lineWidthRef.current - 1);
          setLineWidthRef.current(next);
          return;
        }
      }

      // 4. ストローク中はツール切替を抑止
      if (sessionRef.current !== null) return;

      // 5. リピート無視 (ツール切替系)
      if (e.repeat) return;

      // 6. Space → hold-switch
      if (e.key === " ") {
        e.preventDefault();
        spaceHeldRef.current = true;
        activateHoldSwitch(resolveSpaceTool(e));
        return;
      }

      // 7. Alt単体 → pen/eraser反転 hold-switch
      if (e.key === "Alt" && !spaceHeldRef.current) {
        e.preventDefault();
        altHeldRef.current = true;
        const current = toolRef.current;
        if (current === "pen") {
          activateHoldSwitch("eraser");
        } else if (current === "eraser") {
          activateHoldSwitch("pen");
        }
        return;
      }

      // 8. 単キー hold-switch (s, o, z, r)
      const holdTool = HOLD_SWITCH_KEYS[e.key];
      if (holdTool) {
        e.preventDefault();
        activateHoldSwitch(holdTool);
        return;
      }

      // 9. b → ペンに切替 (ホールド不要)
      if (e.key === "b") {
        e.preventDefault();
        setToolRef.current("pen");
        return;
      }
    }

    function handleKeyUp(e: KeyboardEvent): void {
      // Space解放
      if (e.key === " ") {
        spaceHeldRef.current = false;
        deactivateHoldSwitch();
        return;
      }

      // Space押下中に修飾キー解放 → ツール再評価
      if (
        spaceHeldRef.current &&
        (e.key === "Shift" ||
          e.key === "Meta" ||
          e.key === "Control" ||
          e.key === "Alt")
      ) {
        setToolRef.current(resolveSpaceTool(e));
        return;
      }

      // Alt解放 → pen/eraser hold-switch解除
      if (e.key === "Alt" && altHeldRef.current) {
        altHeldRef.current = false;
        deactivateHoldSwitch();
        return;
      }

      // 単キー hold-switch 解放
      if (e.key in HOLD_SWITCH_KEYS && baseToolRef.current !== null) {
        deactivateHoldSwitch();
        return;
      }
    }

    function handleWindowBlur(): void {
      spaceHeldRef.current = false;
      altHeldRef.current = false;
      deactivateHoldSwitch();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [sessionRef]);
}
