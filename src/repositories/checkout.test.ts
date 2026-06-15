import { access } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { clonePullRequestCheckout } from "./checkout.js";
import type { PullRequestSummary, RepositoryConfig } from "../types/revisaur.js";

vi.mock("execa", () => ({
    execa: vi.fn((command: string, args: string[]) => {
        if (command === "git" && args[0] === "rev-parse") {
            return Promise.resolve({ stdout: pullRequest.headSha });
        }

        return Promise.resolve({ stdout: "" });
    }),
}));

const repository: RepositoryConfig = {
    id: "github-example-project",
    name: "example/project",
    provider: "github",
    url: "https://github.com/example/project",
    owner: "example",
    repo: "project",
    maxPullRequests: 10,
    includedAuthors: [],
    includedAssignees: [],
    skippedAuthors: [],
};

const pullRequest: PullRequestSummary = {
    provider: "github",
    repoId: "github-example-project",
    number: 123,
    reviewState: "ready",
    title: "Improve widget",
    url: "https://github.com/example/project/pull/123",
    author: "dev",
    headSha: "abc123",
    baseSha: "def456",
    updatedAt: "2026-05-13T00:00:00.000Z",
};

describe("clonePullRequestCheckout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("creates a shallow checkout at the pull request head", async () => {
        const checkout = await clonePullRequestCheckout(repository, pullRequest);

        expect(execa).toHaveBeenCalledWith(
            "git",
            ["clone", "--depth", "1", "--no-tags", "--single-branch", repository.url, checkout.path],
            expect.objectContaining({ reject: true }),
        );
        expect(execa).toHaveBeenCalledWith(
            "git",
            ["fetch", "--depth", "1", "--no-tags", "origin", "refs/pull/123/head"],
            expect.objectContaining({ cwd: checkout.path, reject: true }),
        );
        expect(execa).toHaveBeenCalledWith(
            "git",
            ["checkout", "--detach", "FETCH_HEAD"],
            expect.objectContaining({ cwd: checkout.path, reject: true }),
        );

        await checkout.dispose();
        await expect(access(checkout.path)).rejects.toThrow();
    });

    it("reports checkout preparation failures", async () => {
        vi.mocked(execa).mockRejectedValueOnce({ stderr: "fatal: repository not found" });

        await expect(clonePullRequestCheckout(repository, pullRequest)).rejects.toThrow(
            "Could not prepare review checkout for example/project PR #123: fatal: repository not found",
        );
    });
});
