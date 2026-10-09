import { useAgent } from "agents/react";
import { useState } from "react";
import type { RunSnapshot } from "../../shared/api-types.ts";

/**
 * Live run snapshot over the coordinator's read-only WebSocket (Agents SDK
 * state sync). The browser's dev cookie or Access session authenticates the upgrade.
 */
export function useRunLive(runId: string): { snapshot: RunSnapshot | null; connected: boolean } {
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  useAgent<RunSnapshot>({
    agent: "RunCoordinator",
    name: runId,
    onStateUpdate: (state) => setSnapshot(state),
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
    onError: () => setConnected(false),
  });
  return { snapshot: snapshot && snapshot.runId === runId ? snapshot : null, connected };
}
