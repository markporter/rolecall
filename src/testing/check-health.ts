// Probe the offline simulated-target FARM's aggregated health endpoint.
//
// Invoked by scripts/sims/health.sh. Exits 0 when every sim reports healthy,
// otherwise prints the failing services and exits non-zero. The farm's
// /health endpoint exercises EACH sim's own health routine in-process, so this
// single probe covers all three targets without requiring docker/lxc/podman.
//
// Runnable directly (`bun run src/testing/check-health.ts`) or via `bun -e`.
const CONTROL_URL = process.env.SIM_FARM_CONTROL ?? "http://127.0.0.1:39530/health";

async function check(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(CONTROL_URL, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    console.error(`check-health: cannot reach farm at ${CONTROL_URL} (${err instanceof Error ? err.message : String(err)})`);
    process.exitCode = 1;
    return;
  }

  let data: { ok?: boolean; services?: Array<{ name: string; healthy: boolean }> };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    console.error(`check-health: non-JSON response from farm (${res.status})`);
    process.exitCode = 1;
    return;
  }

  const services = data.services ?? [];
  for (const s of services) {
    console.log(s.healthy ? `[OK]     ${s.name}` : `[DOWN]   ${s.name}`);
  }

  if (res.ok === false || data.ok !== true) {
    console.error(`check-health: farm reported UNHEALTHY (status=${res.status}, ok=${String(data.ok)})`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-health: ALL SIMS HEALTHY via ${CONTROL_URL}`);
  process.exitCode = 0;
}

if (import.meta.main) {
  void check();
}

export { check };
