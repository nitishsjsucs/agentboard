export function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span className="live" title={connected ? "Receiving live updates over WebSocket" : "Not connected; the page still refreshes every 5 s"}>
      <span className={`live__dot${connected ? " live__dot--on" : ""}`} />
      {connected ? "live" : "offline"}
    </span>
  );
}
