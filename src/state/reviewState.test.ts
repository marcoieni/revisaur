import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readJson } from "fs-extra/esm";
import { describe, expect, it } from "vitest";
import {
    emptyState,
    isReusableReview,
    loadReviewState,
    loadState,
    reviewJsonRelativePath,
    reviewKey,
    saveState,
    writeReviewApi,
    writeReviewFile,
} from "./reviewState.js";
import type {
    PullRequestReview,
    PullRequestSummary,
    ReviewManifest,
    ReviewState,
    SiteRepository,
} from "../types/revisaur.js";

describe("reviewState", () => {
    it("creates an empty versioned state", () => {
        expect(emptyState()).toEqual({ version: 1, reviews: {} });
    });

    it("returns an empty state when no state file exists", async () => {
        const dir = await mkdtemp(join(tmpdir(), "revisaur-state-"));

        await expect(loadState(join(dir, "missing.json"))).resolves.toEqual(emptyState());
    });

    it("saves and loads review state JSON", async () => {
        const dir = await mkdtemp(join(tmpdir(), "revisaur-state-"));
        const path = join(dir, "state.json");
        const state: ReviewState = {
            version: 1,
            reviews: {
                [reviewKey(pullRequest())]: {
                    repoId: "repo",
                    pullRequest: pullRequest(),
                    status: "reviewed",
                    reviewedCommit: "abc",
                    reviewedAt: "2026-01-01T00:00:00.000Z",
                    summary: "Looks good.",
                    rawOutput: "",
                    diff: "",
                    comments: [],
                },
            },
        };

        await saveState(path, state);

        await expect(loadState(path)).resolves.toEqual(state);
    });

    it("keys reviews by provider, repository, pull request number, and head SHA", () => {
        expect(reviewKey(pullRequest())).toBe("github:repo:7:abc");
    });

    it("does not reuse failed reviews from cache", () => {
        expect(isReusableReview(review({ status: "reviewed" }))).toBe(true);
        expect(isReusableReview(review({ status: "skipped" }))).toBe(true);
        expect(isReusableReview(review({ status: "failed" }))).toBe(false);
        expect(isReusableReview(undefined)).toBe(false);
    });

    it("writes review JSON files and an API manifest", async () => {
        const dir = await mkdtemp(join(tmpdir(), "revisaur-state-"));
        const generatedAt = "2026-01-01T00:00:00.000Z";
        const item = review();

        await writeReviewApi(dir, [repository()], [item], generatedAt);

        await expect(readJson(join(dir, ...reviewJsonRelativePath(item).split("/")))).resolves.toEqual(item);
        await expect(readJson(join(dir, "reviews", "index.json")) as Promise<ReviewManifest>).resolves.toMatchObject({
            version: 1,
            generatedAt,
            repositories: [repository()],
            reviews: [
                {
                    author: "alice",
                    headSha: "abc",
                    number: 7,
                    path: "repo/7/abc.json",
                    provider: "github",
                    repoId: "repo",
                    reviewedAt: "2026-01-01T00:00:00.000Z",
                    status: "reviewed",
                    title: "Update dependency",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                    url: "https://github.com/example/repo/pull/7",
                },
            ],
        });
    });

    it("loads review state from committed review files and legacy state JSON", async () => {
        const dir = await mkdtemp(join(tmpdir(), "revisaur-state-"));
        const legacyReview = review({ summary: "Legacy cache entry." });
        const fileReview = review({ summary: "Committed review file." });

        await saveState(join(dir, "state.json"), {
            version: 1,
            reviews: { [reviewKey(legacyReview.pullRequest)]: legacyReview },
        });
        await writeReviewFile(dir, fileReview);

        await expect(loadReviewState(dir)).resolves.toEqual({
            version: 1,
            reviews: { [reviewKey(fileReview.pullRequest)]: fileReview },
        });
    });
});

function repository(overrides: Partial<SiteRepository> = {}): SiteRepository {
    return {
        id: "repo",
        name: "example/repo",
        owner: "example",
        provider: "github",
        repo: "repo",
        url: "https://github.com/example/repo",
        ...overrides,
    };
}

function pullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
    return {
        provider: "github",
        repoId: "repo",
        number: 7,
        reviewState: "ready",
        title: "Update dependency",
        url: "https://github.com/example/repo/pull/7",
        author: "alice",
        headSha: "abc",
        baseSha: "def",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function review(overrides: Partial<PullRequestReview> = {}): PullRequestReview {
    return {
        repoId: "repo",
        pullRequest: pullRequest(),
        status: "reviewed",
        reviewedCommit: "abc",
        reviewedAt: "2026-01-01T00:00:00.000Z",
        summary: "Looks good.",
        rawOutput: "",
        diff: "",
        comments: [],
        ...overrides,
    };
}
