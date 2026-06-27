import { describe, expect, it } from "vitest";
import { bestFuzzyScore, fuzzyScore } from "./search.js";

describe("fuzzyScore", () => {
    it("matches exact, prefix, substring, and fuzzy queries", () => {
        expect(fuzzyScore("Cache project activity summaries", "Cache project activity summaries")).toBe(0);
        expect(fuzzyScore("Cache project activity summaries", "project")).toBeLessThan(
            fuzzyScore("Cache project activity summaries", "activity"),
        );
        expect(fuzzyScore("Cache project activity summaries", "proj")).toBeLessThan(
            fuzzyScore("Cache project activity summaries", "ject"),
        );
        expect(Number.isFinite(fuzzyScore("Cache project activity summaries", "cpa"))).toBe(true);
    });

    it("returns infinity when query characters are missing", () => {
        expect(fuzzyScore("Cache project activity summaries", "xyz")).toBe(Number.POSITIVE_INFINITY);
    });

    it("can score the best matching field instead of one concatenated value", () => {
        expect(Number.isFinite(bestFuzzyScore(["#184", "Cache project activity summaries", "riley"], "cpa"))).toBe(
            true,
        );
        expect(bestFuzzyScore(["#176", "Add bulk invitation endpoint", "sam", "example/octoflow-api"], "cpa")).toBe(
            Number.POSITIVE_INFINITY,
        );
    });
});
