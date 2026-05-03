import type { Skill } from "../types";
import {
  getDB,
  getDeviceId,
  insertTombstone,
  nextSyncVersion,
  nextUpdatedAt,
  parseJSON,
} from "./db-core";

export async function getSkills(): Promise<Skill[]> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    name: string;
    description: string;
    icon: string | null;
    enabled: number;
    parameters: string;
    prompt: string;
    built_in: number;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM skills ORDER BY created_at ASC");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    icon: r.icon || undefined,
    enabled: r.enabled === 1,
    parameters: parseJSON(r.parameters, []),
    prompt: r.prompt,
    builtIn: r.built_in === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function insertSkill(skill: Skill): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "skills");
  await database.execute(
    "INSERT INTO skills (id, name, description, icon, enabled, parameters, prompt, built_in, created_at, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      skill.id,
      skill.name,
      skill.description,
      skill.icon || null,
      skill.enabled ? 1 : 0,
      JSON.stringify(skill.parameters),
      skill.prompt,
      skill.builtIn ? 1 : 0,
      skill.createdAt,
      skill.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function upsertSkill(skill: Skill): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "skills");
  const updatedAt = Math.max(skill.updatedAt, await nextUpdatedAt(database, "skills", skill.id));
  await database.execute(
    `INSERT INTO skills (id, name, description, icon, enabled, parameters, prompt, built_in, created_at, updated_at, sync_version, last_modified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       icon = excluded.icon,
       enabled = excluded.enabled,
       parameters = excluded.parameters,
       prompt = excluded.prompt,
       built_in = excluded.built_in,
       updated_at = excluded.updated_at,
       sync_version = excluded.sync_version,
       last_modified_by = excluded.last_modified_by`,
    [
      skill.id,
      skill.name,
      skill.description,
      skill.icon || null,
      skill.enabled ? 1 : 0,
      JSON.stringify(skill.parameters),
      skill.prompt,
      skill.builtIn ? 1 : 0,
      skill.createdAt,
      updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function updateSkill(id: string, updates: Partial<Skill>): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    values.push(updates.description);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.parameters !== undefined) {
    sets.push("parameters = ?");
    values.push(JSON.stringify(updates.parameters));
  }
  if (updates.prompt !== undefined) {
    sets.push("prompt = ?");
    values.push(updates.prompt);
  }
  // Add sync tracking
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "skills");
  const updatedAt = await nextUpdatedAt(database, "skills", id);
  sets.push("updated_at = ?");
  values.push(updatedAt);
  sets.push("sync_version = ?");
  values.push(syncVersion);
  sets.push("last_modified_by = ?");
  values.push(deviceId);

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE skills SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteSkill(id: string): Promise<void> {
  const database = await getDB();
  await insertTombstone(database, id, "skills");
  await database.execute("DELETE FROM skills WHERE id = ?", [id]);
}
