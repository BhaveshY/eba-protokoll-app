import { describe, expect, it } from "vitest";
import {
  mergeGlobalGlossaryTerms,
  mergeGlossaryTerms,
  parseGlossaryTerms,
} from "../src/lib/glossary";

describe("parseGlossaryTerms", () => {
  it("splits pasted lists on lines, commas, and semicolons", () => {
    expect(
      parseGlossaryTerms("Rohbau\nBeton, Stahlbeton; Tragwerk")
    ).toEqual(["Rohbau", "Beton", "Stahlbeton", "Tragwerk"]);
  });

  it("keeps multi-word technical terms intact", () => {
    expect(parseGlossaryTerms("baulicher Brandschutz\nabgehängte Decke")).toEqual([
      "baulicher Brandschutz",
      "abgehängte Decke",
    ]);
  });

  it("deduplicates case-insensitively and strips simple list markers", () => {
    expect(parseGlossaryTerms("- Rohbau\n1. rohbau\n2) Fassade")).toEqual([
      "Rohbau",
      "Fassade",
    ]);
  });
});

describe("mergeGlossaryTerms", () => {
  it("adds only new terms without changing existing casing", () => {
    expect(
      mergeGlossaryTerms(["Rohbau"], ["rohbau", "Beton", "Tragwerk"])
    ).toEqual({
      terms: ["Rohbau", "Beton", "Tragwerk"],
      added: 2,
    });
  });
});

describe("mergeGlobalGlossaryTerms", () => {
  it("combines global EBA terms with the active profile for transcription", () => {
    expect(
      mergeGlobalGlossaryTerms(["EB&A", "Rohbau"], ["rohbau", "Pflasterprotokoll"])
    ).toEqual(["EB&A", "Rohbau", "Pflasterprotokoll"]);
  });
});
