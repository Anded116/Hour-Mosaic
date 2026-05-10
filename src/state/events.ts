import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Category } from "../types";

export interface TickEvent {
  date_key: string;
  minute_of_day: number;
  category: Category;
  source_key: string | null;
  source_title: string | null;
}

export interface CurrentActivityEvent {
  process: string | null;
  title: string | null;
  category: Category;
  source_key: string;
  idle_ms: number;
  paused: boolean;
}

export function onTick(handler: (e: TickEvent) => void): Promise<UnlistenFn> {
  return listen<TickEvent>("hm:tick", (event) => handler(event.payload));
}

export function onCurrentActivity(
  handler: (e: CurrentActivityEvent) => void,
): Promise<UnlistenFn> {
  return listen<CurrentActivityEvent>("hm:current-activity", (event) => handler(event.payload));
}
