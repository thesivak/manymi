import { afterEach, describe, expect, it } from "vitest";
import { getAllowedEmails, isEmailAllowed } from "@/lib/access";

describe("access allowlist", () => {
  const original = process.env.ALLOWED_EMAILS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ALLOWED_EMAILS;
    } else {
      process.env.ALLOWED_EMAILS = original;
    }
  });

  it("povoluje ve výchozím nastavení pouze mirek@sivak.ai", () => {
    delete process.env.ALLOWED_EMAILS;
    expect(getAllowedEmails()).toEqual(["mirek@sivak.ai"]);
    expect(isEmailAllowed("mirek@sivak.ai")).toBe(true);
    expect(isEmailAllowed("  MIREK@SIVAK.AI ")).toBe(true);
    expect(isEmailAllowed("nekdo@example.com")).toBe(false);
    expect(isEmailAllowed("")).toBe(false);
    expect(isEmailAllowed(null)).toBe(false);
  });

  it("respektuje vlastní seznam v ALLOWED_EMAILS", () => {
    process.env.ALLOWED_EMAILS = "Mirek@Sivak.ai, ucetni@firma.cz";
    expect(isEmailAllowed("mirek@sivak.ai")).toBe(true);
    expect(isEmailAllowed("ucetni@firma.cz")).toBe(true);
    expect(isEmailAllowed("jiny@firma.cz")).toBe(false);
  });
});
