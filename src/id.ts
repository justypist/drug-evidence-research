import { randomUUID } from "node:crypto";

export function createTaskId(): string {
  return randomUUID();
}
