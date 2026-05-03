import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill, SkillParameter } from "../../types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  nextUpdatedAt: vi.fn(),
  insertTombstone: vi.fn(),
  parseJSON: vi.fn((str: string | null | undefined, fallback: unknown) => {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }),
}));

vi.mock("../db-core", () => coreMocks);

const { getSkills, insertSkill, upsertSkill, updateSkill, deleteSkill } = await import(
  "../skill-queries"
);

const sampleSkill: Skill = {
  id: "skill-1",
  name: "Summarizer",
  description: "Summarizes book content",
  icon: "📝",
  enabled: true,
  parameters: [
    { name: "length", type: "string", description: "Summary length", required: false },
  ] satisfies SkillParameter[],
  prompt: "Summarize the following text: {{text}}",
  builtIn: false,
  createdAt: 1000,
  updatedAt: 1000,
};

describe("skill-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
    coreMocks.nextUpdatedAt.mockResolvedValue(2000);
    coreMocks.insertTombstone.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getSkills", () => {
    it("returns mapped skills from database", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "skill-1",
          name: "Summarizer",
          description: "Summarizes book content",
          icon: "📝",
          enabled: 1,
          parameters: '[{"name":"length","type":"string"}]',
          prompt: "Summarize: {{text}}",
          built_in: 0,
          created_at: 1000,
          updated_at: 1000,
        },
      ]);

      const skills = await getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("skill-1");
      expect(skills[0].name).toBe("Summarizer");
      expect(skills[0].enabled).toBe(true);
      expect(skills[0].builtIn).toBe(false);
      expect(skills[0].parameters).toEqual([{ name: "length", type: "string" }]);
      expect(mockSelect).toHaveBeenCalledWith("SELECT * FROM skills ORDER BY created_at ASC");
    });

    it("handles null icon", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "skill-2",
          name: "Test",
          description: "Test skill",
          icon: null,
          enabled: 0,
          parameters: "[]",
          prompt: "Test prompt",
          built_in: 1,
          created_at: 2000,
          updated_at: 2000,
        },
      ]);

      const skills = await getSkills();
      expect(skills[0].icon).toBeUndefined();
      expect(skills[0].enabled).toBe(false);
      expect(skills[0].builtIn).toBe(true);
    });
  });

  describe("insertSkill", () => {
    it("inserts skill with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertSkill(sampleSkill);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "skills");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO skills");
      expect(params[0]).toBe("skill-1");
      expect(params[1]).toBe("Summarizer");
      expect(params[4]).toBe(1); // enabled = true → 1
      expect(params[7]).toBe(0); // builtIn = false → 0
    });

    it("serializes parameters as JSON", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertSkill(sampleSkill);
      const [, params] = mockExecute.mock.calls[0];
      // parameters should be JSON stringified
      expect(typeof params[5]).toBe("string");
      expect(JSON.parse(params[5] as string)).toEqual(sampleSkill.parameters);
    });
  });

  describe("upsertSkill", () => {
    it("inserts or updates skill with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await upsertSkill({ ...sampleSkill, enabled: false, updatedAt: 3000 });
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "skills");
      expect(coreMocks.nextUpdatedAt).toHaveBeenCalledWith(mockDb, "skills", "skill-1");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO skills");
      expect(sql).toContain("ON CONFLICT(id) DO UPDATE SET");
      expect(params[0]).toBe("skill-1");
      expect(params[4]).toBe(0);
      expect(params[9]).toBe(3000);
      expect(params[11]).toBe("device-1");
    });

    it("keeps updated_at monotonic when current row is newer", async () => {
      mockExecute.mockResolvedValue(undefined);
      coreMocks.nextUpdatedAt.mockResolvedValue(4000);

      await upsertSkill({ ...sampleSkill, updatedAt: 3000 });
      const [, params] = mockExecute.mock.calls[0];
      expect(params[9]).toBe(4000);
    });
  });

  describe("updateSkill", () => {
    it("updates name with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSkill("skill-1", { name: "New Name" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE skills SET");
      expect(sql).toContain("name = ?");
      expect(params).toContain("New Name");
    });

    it("updates enabled state", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSkill("skill-1", { enabled: false });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("enabled = ?");
      expect(params).toContain(0); // false → 0
    });

    it("serializes parameters update as JSON", async () => {
      mockExecute.mockResolvedValue(undefined);

      const newParams: SkillParameter[] = [
        { name: "style", type: "string", description: "Writing style", required: false },
      ];
      await updateSkill("skill-1", { parameters: newParams });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("parameters = ?");
      expect(params).toContain(JSON.stringify(newParams));
    });

    it("updates prompt", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSkill("skill-1", { prompt: "New prompt: {{input}}" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("prompt = ?");
      expect(params).toContain("New prompt: {{input}}");
    });

    it("always includes sync tracking fields", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSkill("skill-1", { name: "Test" });
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("updated_at = ?");
      expect(sql).toContain("sync_version = ?");
      expect(sql).toContain("last_modified_by = ?");
    });
  });

  describe("deleteSkill", () => {
    it("deletes skill and creates tombstone", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteSkill("skill-1");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "skill-1", "skills");
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM skills WHERE id = ?", ["skill-1"]);
    });
  });
});
