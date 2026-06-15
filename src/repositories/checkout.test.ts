import { access } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { cloneRepositoryCheckout } from "./checkout.js";
import type { PullRequestSummary, RepositoryConfig } from "../types/revisaur.js";

vi.mock("execa", () => ({
    execa: vi.fn((command: string, args: string[]) => {
        if (command === "git" && args[0] === "rev-parse") {
            return Promise.resolve({ stdout: currentHeadSha });
        }

        if (command === "git" && args[0] === "fetch") {
            const ref = args[args.length - 1];
            currentHeadSha = ref === "refs/pull/124/head" ? secondPullRequest.headSha : pullRequest.headSha;
        }

        return Promise.resolve({ stdout: "" });
    }),
}));

let currentHeadSha = "";

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

const secondPullRequest: PullRequestSummary = {
    ...pullRequest,
    number: 124,
    url: "https://github.com/example/project/pull/124",
    headSha: "def789",
};

describe("cloneRepositoryCheckout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        currentHeadSha = pullRequest.headSha;
    });

    it("clones once and checks out pull request heads in the same repository", async () => {
        const checkout = await cloneRepositoryCheckout(repository);

        expect(execa).toHaveBeenCalledWith(
            "git",
            ["clone", "--depth", "1", "--no-tags", "--single-branch", repository.url, checkout.path],
            expect.objectContaining({ reject: true }),
        );

        await checkout.checkoutPullRequest(pullRequest);
        await checkout.checkoutPullRequest(secondPullRequest);

        expect(execa).toHaveBeenCalledWith(
            "git",
            ["fetch", "--depth", "1", "--no-tags", "origin", "refs/pull/123/head"],
            expect.objectContaining({ cwd: checkout.path, reject: true }),
        );
        expect(execa).toHaveBeenCalledWith(
            "git",
            ["fetch", "--depth", "1", "--no-tags", "origin", "refs/pull/124/head"],
            expect.objectContaining({ cwd: checkout.path, reject: true }),
        );
        expect(execa).toHaveBeenCalledWith(
            "git",
            ["checkout", "--force", "--detach", "FETCH_HEAD"],
            expect.objectContaining({ cwd: checkout.path, reject: true }),
        );
        expect(gitSubcommandCallCount("clone")).toBe(1);

        await checkout.dispose();
        await expect(access(checkout.path)).rejects.toThrow();
    });

    it("reports clone failures", async () => {
        vi.mocked(execa).mockRejectedValueOnce({ stderr: "fatal: repository not found" });

        await expect(cloneRepositoryCheckout(repository)).rejects.toThrow(
            "Could not clone review checkout for example/project: fatal: repository not found",
        );
    });

    it("reports pull request checkout failures", async () => {
        const checkout = await cloneRepositoryCheckout(repository);

        try {
            vi.mocked(execa).mockRejectedValueOnce({ stderr: "fatal: couldn't find remote ref" });

            await expect(checkout.checkoutPullRequest(pullRequest)).rejects.toThrow(
                "Could not prepare review checkout for example/project PR #123: fatal: couldn't find remote ref",
            );
        } finally {
            await checkout.dispose();
        }
    });
});

function gitSubcommandCallCount(subcommand: string): number {
    return vi.mocked(execa).mock.calls.filter((call) => call[1][0] === subcommand).length;
}
