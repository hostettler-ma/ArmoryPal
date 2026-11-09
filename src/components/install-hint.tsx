"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "armorypal:install-hint-dismissed";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * "Add to Home Screen" hint. Android/Chrome: a real Install button (via
 * beforeinstallprompt). iOS Safari, which has no install API: short
 * Share → Add to Home Screen instructions. Hidden once installed or dismissed.
 */
export function InstallHint() {
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // storage blocked: just show the hint
    }
    if (standalone || dismissed) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so our button can trigger the install dialog
      setDeferred(e as BeforeInstallPromptEvent);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const ua = navigator.userAgent;
    const iosSafari = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (iosSafari) setMode("ios");

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (mode === "hidden") return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setMode("hidden");
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setMode("hidden");
  }

  return (
    <div className="card space-y-3">
      <p className="text-heading-02">Put ArmoryPal on your home screen</p>
      <p className="text-body-compact text-muted">
        {mode === "ios" ? (
          <>
            In Safari, tap <span className="font-semibold text-foreground">Share</span> then{" "}
            <span className="font-semibold text-foreground">Add to Home Screen</span>. It opens like an app at the store.
          </>
        ) : (
          "Install it to open it like an app at the store."
        )}
      </p>
      <div className={mode === "prompt" ? "grid grid-cols-2 gap-2" : ""}>
        <button className="btn btn-secondary" onClick={dismiss}>
          Not now
        </button>
        {mode === "prompt" && (
          <button className="btn btn-primary" onClick={install}>
            Install
          </button>
        )}
      </div>
    </div>
  );
}
