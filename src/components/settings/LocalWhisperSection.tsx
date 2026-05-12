import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Icon } from "../ui/Icon";
import { useSttStore } from "../../stores/sttStore";
import {
  sttModelDelete,
  sttModelDownload,
  sttModelDownloadAbort,
  sttModelList,
  type SttDownloadProgress,
  type SttGpuStatus,
  type SttModelStatus,
} from "../../lib/tauri";

type DownloadState =
  | { kind: "idle" }
  | { kind: "downloading"; downloaded: number; total: number }
  | { kind: "error"; message: string };

function formatBytesMb(bytes: number, fallbackMb?: number): string {
  if (bytes > 0) {
    const mb = bytes / (1024 * 1024);
    return mb >= 100 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
  }
  return typeof fallbackMb === "number" ? `~${fallbackMb} MB` : "—";
}

function gpuLabel(gpu: SttGpuStatus | null): {
  text: string;
  icon: "check" | "alert-circle" | "dot";
  tone: "ok" | "warn" | "muted";
} {
  if (!gpu) {
    return {
      text: "GPU status will be detected on the first transcribe.",
      icon: "dot",
      tone: "muted",
    };
  }
  if (gpu.useGpu) {
    const backend = gpu.backend.charAt(0).toUpperCase() + gpu.backend.slice(1);
    return {
      text: `Using ${backend} acceleration.`,
      icon: "check",
      tone: "ok",
    };
  }
  return {
    text: "Running on CPU — larger models will be slower.",
    icon: "alert-circle",
    tone: "warn",
  };
}

/**
 * Settings subpanel for the on-device Whisper preset. Renders the curated
 * model picker (download / delete / status), the runtime GPU indicator,
 * and the language selector. Shown only when `presetId === "local-whisper"`.
 */
export function LocalWhisperSection() {
  const settings = useSttStore((s) => s.settings);
  const update = useSttStore((s) => s.updateSettings);

  const [models, setModels] = useState<SttModelStatus[]>([]);
  const [gpu, setGpu] = useState<SttGpuStatus | null>(null);
  const [modelsDir, setModelsDir] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  // Two-step inline delete confirm. Keyed by model id; the second click on
  // the trash icon within 4 s of the first commits the delete. Esc/blur
  // resets. Avoids spawning a modal for a per-row action.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const confirmTimerRef = useRef<number | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await sttModelList();
      setModels(r.models);
      setGpu(r.gpu);
      setModelsDir(r.modelsDir);
      // If the user's stored localModelPath is for a model that's no longer
      // installed (deleted out-of-band), clear it so startListening's guard
      // catches the missing-model case early.
      const current = r.models.find((m) => m.id === settings.localModelId);
      if (current && current.installed && current.path) {
        if (settings.localModelPath !== current.path) {
          void update({ localModelPath: current.path });
        }
      } else if (settings.localModelPath) {
        void update({ localModelPath: "" });
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [settings.localModelId, settings.localModelPath, update]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset the confirm-delete prompt if the user opens it but never confirms.
  useEffect(() => {
    if (!confirmDelete) return;
    confirmTimerRef.current = window.setTimeout(() => {
      setConfirmDelete(null);
    }, 4000);
    return () => {
      if (confirmTimerRef.current !== undefined) {
        window.clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = undefined;
      }
    };
  }, [confirmDelete]);

  const startDownload = useCallback(
    async (id: string) => {
      setDownloads((d) => ({
        ...d,
        [id]: { kind: "downloading", downloaded: 0, total: 0 },
      }));
      const channel = new Channel<SttDownloadProgress>();
      channel.onmessage = (msg) => {
        setDownloads((d) => ({
          ...d,
          [id]: {
            kind: "downloading",
            downloaded: msg.downloaded,
            total: msg.total,
          },
        }));
      };
      try {
        const path = await sttModelDownload(id, channel);
        setDownloads((d) => {
          const next = { ...d };
          delete next[id];
          return next;
        });
        // If this is the currently-selected model, promote it as the active
        // path so the hotkey works immediately without a refresh.
        if (settings.localModelId === id) {
          await update({ localModelPath: path });
        }
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // User-initiated cancel surfaces as "aborted" — treat as a clean
        // reset, not an error to display.
        if (msg.toLowerCase().includes("aborted")) {
          setDownloads((d) => {
            const next = { ...d };
            delete next[id];
            return next;
          });
        } else {
          setDownloads((d) => ({
            ...d,
            [id]: { kind: "error", message: msg },
          }));
        }
      }
    },
    [refresh, settings.localModelId, update],
  );

  const cancelDownload = useCallback(async (id: string) => {
    try {
      await sttModelDownloadAbort(id);
    } catch {
      /* best-effort */
    }
  }, []);

  const requestDelete = useCallback((id: string) => {
    setConfirmDelete((cur) => (cur === id ? cur : id));
  }, []);

  const confirmDeleteNow = useCallback(
    async (id: string) => {
      setConfirmDelete(null);
      try {
        await sttModelDelete(id);
        if (settings.localModelId === id) {
          await update({ localModelPath: "" });
        }
        await refresh();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh, settings.localModelId, update],
  );

  const selectModel = useCallback(
    async (id: string) => {
      const m = models.find((x) => x.id === id);
      await update({
        localModelId: id,
        localModelPath: m?.installed && m.path ? m.path : "",
      });
    },
    [models, update],
  );

  const gpu_ = gpuLabel(gpu);

  return (
    <div className="stt-field">
      <span className="stt-field-label">
        On-device models
        <span className="stt-field-hint">
          {" "}— runs entirely on your machine; no API key or internet needed
        </span>
      </span>
      <div className="stt-local-models">
        {models.length === 0 && !loadError && (
          <div className="stt-local-empty">Loading model catalog…</div>
        )}
        {models.map((m) => {
          const dl = downloads[m.id];
          const isSelected = settings.localModelId === m.id;
          const isDownloading = dl?.kind === "downloading";
          const isError = dl?.kind === "error";
          const pct =
            isDownloading && dl.total > 0
              ? Math.min(100, Math.round((dl.downloaded / dl.total) * 100))
              : 0;
          const askingConfirm = confirmDelete === m.id;
          return (
            <div
              key={m.id}
              className={
                "stt-local-model" + (isSelected ? " is-selected" : "")
              }
            >
              <label className="stt-local-model-main">
                <input
                  type="radio"
                  name="stt-local-model"
                  checked={isSelected}
                  onChange={() => void selectModel(m.id)}
                  disabled={!m.installed}
                />
                <div className="stt-local-model-text">
                  <div className="stt-local-model-title">
                    {m.label}
                    {m.default && (
                      <span className="stt-local-model-tag">default</span>
                    )}
                  </div>
                  <div className="stt-local-model-meta">
                    {m.installed
                      ? `Ready — ${formatBytesMb(m.installedBytes ?? 0, m.sizeMb)}`
                      : isDownloading
                        ? `${formatBytesMb(dl.downloaded)} of ${formatBytesMb(dl.total, m.sizeMb)} · ${pct}%`
                        : isError
                          ? <span className="stt-local-error">{dl.message}</span>
                          : `Not downloaded — ~${m.sizeMb} MB`}
                  </div>
                  {isDownloading && (
                    <div
                      className="stt-local-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      aria-label={`Downloading ${m.label}`}
                    >
                      <div
                        className="stt-local-progress-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </label>
              <div className="stt-local-model-actions">
                {isDownloading ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void cancelDownload(m.id)}
                  >
                    Cancel
                  </button>
                ) : !m.installed ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void startDownload(m.id)}
                  >
                    {isError ? "Retry" : "Download"}
                  </button>
                ) : askingConfirm ? (
                  <div className="stt-local-confirm">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => void confirmDeleteNow(m.id)}
                      autoFocus
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    aria-label={`Delete ${m.label}`}
                    title={`Delete ${m.label} (~${m.sizeMb} MB)`}
                    onClick={() => requestDelete(m.id)}
                  >
                    <Icon name="trash-2" size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {loadError && (
          <div className="stt-local-empty stt-local-error">
            Couldn't load models: {loadError}
          </div>
        )}
      </div>
      <div className={`stt-field-hint stt-local-gpu stt-local-gpu--${gpu_.tone}`}>
        <Icon name={gpu_.icon} size={12} />
        <span>{gpu_.text}</span>
      </div>
      {modelsDir && (
        <div className="stt-field-hint stt-local-dir">
          Stored in <code>{modelsDir}</code>
        </div>
      )}
    </div>
  );
}
