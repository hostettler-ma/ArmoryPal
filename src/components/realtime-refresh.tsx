"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const DEBOUNCE_MS = 300;

/**
 * Re-renders the current page (router.refresh) when a broadcast arrives on a
 * private Realtime topic. Broadcasts are at-most-once, so it also refreshes
 * after a reconnect and when the tab/phone becomes visible again, to catch
 * anything missed meanwhile.
 */
export function RealtimeRefresh({ topic, event }: { topic: string; event: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscribedBefore = false;
    let cancelled = false;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), DEBOUNCE_MS);
    };

    const channel = supabase.channel(topic, { config: { private: true } }).on("broadcast", { event }, refresh);

    // Private channels need the user's access token before subscribing.
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (subscribedBefore) refresh(); // reconnected: we may have missed messages
        subscribedBefore = true;
      });
    });

    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [topic, event, router]);

  return null;
}
