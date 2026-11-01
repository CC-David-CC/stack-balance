import type { Host } from "./view/desktop.js";

export interface MountResult {
  element: HTMLElement;
  dispose(): void;
}

export function mount(host: Host): MountResult {
  const body = host.ui.make("div", "window-content stack-app");
  const status = host.ui.make("div", "app-status", "Loading Stack & Balance…");
  body.append(status);
  const controller = new AbortController();
  const abort = () => controller.abort(host.signal?.reason || "View removed");
  host.signal?.addEventListener("abort", abort, {once: true});
  if (host.signal?.aborted) abort();
  let disposed = false;
  let view: {element: HTMLElement; dispose(): void} | null = null;

  queueMicrotask(() => {
    void import("./view/desktop.js").then(async ({startView}) => {
      if (disposed || controller.signal.aborted) return;
      const candidate = await startView(host, controller.signal);
      if (disposed) {
        candidate.dispose();
        return;
      }
      view = candidate;
      body.replaceChildren(view.element);
    }).catch(error => {
      if (!disposed && body.isConnected) {
        status.textContent = "Could not start Stack & Balance: " +
          (error instanceof Error ? error.message : "unknown error");
      }
    });
  });

  return {
    element: body,
    dispose() {
      if (disposed) return;
      disposed = true;
      host.signal?.removeEventListener("abort", abort);
      controller.abort("View removed");
      view?.dispose();
      view = null;
    },
  };
}
