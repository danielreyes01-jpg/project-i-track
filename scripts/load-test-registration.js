const baseUrl = String(process.env.LOAD_TEST_BASE_URL || "http://127.0.0.1:3305").replace(/\/$/, "");
const total = Math.max(1, Number(process.env.LOAD_TEST_USERS || 500));

if (String(process.env.LOAD_TEST_ALLOW_WRITES || "").toLowerCase() !== "true") {
  console.error("Set LOAD_TEST_ALLOW_WRITES=true to confirm that test accounts may be created.");
  process.exit(2);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

(async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const results = await Promise.all(Array.from({ length: total }, async (_, index) => {
    const requestStartedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.20.${Math.floor(index / 250)}.${(index % 250) + 1}` },
        body: JSON.stringify({
          accountType: "school",
          position: "teacher",
          firstname: "Load",
          lastname: `User ${index + 1}`,
          middlename: "Test",
          district: "Load Test District",
          school: "Load Test School",
          schoolId: `LT-${String(index + 1).padStart(6, "0")}`,
          username: `load-${runId}-${index + 1}`,
          email: `load-${runId}-${index + 1}@example.invalid`,
          password: "Load@Test123!",
          confirmPassword: "Load@Test123!"
        })
      });
      return { status: response.status, duration: Date.now() - requestStartedAt };
    } catch (error) {
      return { status: 0, duration: Date.now() - requestStartedAt, error: error.message };
    }
  }));
  const durations = results.map((result) => result.duration);
  const statusCounts = results.reduce((counts, result) => {
    counts[result.status] = Number(counts[result.status] || 0) + 1;
    return counts;
  }, {});
  const succeeded = Number(statusCounts[200] || statusCounts[201] || 0);
  const report = {
    target: baseUrl,
    requested: total,
    succeeded,
    failed: total - succeeded,
    status_counts: statusCounts,
    elapsed_ms: Date.now() - startedAt,
    latency_ms: { p50: percentile(durations, 0.50), p95: percentile(durations, 0.95), max: Math.max(...durations) }
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(succeeded === total ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
