import { useSyncExternalStore } from "react";

const KEY = "jarvys_active_vehicle_id";

let current: string | null = null;
const listeners = new Set<() => void>();

function readInitial(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

current = readInitial();

function emit() {
  for (const l of listeners) l();
}

export function getActiveVehicleId(): string | null {
  return current;
}

export function setActiveVehicleId(id: string | null) {
  if (current === id) return;
  current = id;
  if (typeof window !== "undefined") {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useActiveVehicleId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
