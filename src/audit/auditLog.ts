import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function writeAuditEvent(
  auditLogPath: string | undefined,
  event: { type: string; runId?: string; data?: Record<string, unknown> }
): Promise<void> {
  if (!auditLogPath) {
    return;
  }

  await mkdir(path.dirname(auditLogPath), { recursive: true });
  const line = {
    type: event.type,
    runId: event.runId,
    data: event.data ?? {},
    createdAt: new Date().toISOString()
  };
  await appendFile(auditLogPath, `${JSON.stringify(line)}\n`, "utf8");
}
