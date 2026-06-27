import { access } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const gitConfigCountKey = "GIT_CONFIG_COUNT";
const gitConfigKey0 = "GIT_CONFIG_KEY_0";
const gitConfigValue0 = "GIT_CONFIG_VALUE_0";
const gitTerminalPromptKey = "GIT_TERMINAL_PROMPT";
const originalGitHubToken = process.env.GITHUB_TOKEN;

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
        Reflect.deleteProperty(process.env, "GITHUB_TOKEN");
    });

    afterEach(() => {
        if (originalGitHubToken === undefined) {
            Reflect.deleteProperty(process.env, "GITHUB_TOKEN");
        } else {
            process.env.GITHUB_TOKEN = originalGitHubToken;
        }
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

    it("authenticates GitHub clone and fetch commands with GITHUB_TOKEN", async () => {
        process.env.GITHUB_TOKEN = "github-token";
        const checkout = await cloneRepositoryCheckout(repository);

        try {
            await checkout.checkoutPullRequest(pullRequest);

            const expectedAuthEnv: Record<string, string> = {
                [gitConfigCountKey]: "1",
                [gitConfigKey0]: "http.https://github.com/.extraheader",
                [gitConfigValue0]: `AUTHORIZATION: basic ${Buffer.from("x-access-token:github-token").toString("base64")}`,
                [gitTerminalPromptKey]: "0",
            };

            expect(execa).toHaveBeenCalledWith(
                "git",
                ["clone", "--depth", "1", "--no-tags", "--single-branch", repository.url, checkout.path],
                expect.objectContaining({ reject: true }),
            );
            expect(gitSubcommandOptions("clone").env).toMatchObject(expectedAuthEnv);
            expect(execa).toHaveBeenCalledWith(
                "git",
                ["fetch", "--depth", "1", "--no-tags", "origin", "refs/pull/123/head"],
                expect.objectContaining({ cwd: checkout.path, reject: true }),
            );
            expect(gitSubcommandOptions("fetch").env).toMatchObject(expectedAuthEnv);
        } finally {
            await checkout.dispose();
        }
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

function gitSubcommandOptions(subcommand: string): { cwd?: string; env?: NodeJS.ProcessEnv; reject?: boolean } {
    const call = vi.mocked(execa).mock.calls.find((mockCall) => mockCall[1][0] === subcommand);
    if (call === undefined) {
        throw new Error(`Expected git ${subcommand} to be called.`);
    }

    return call[2] as { cwd?: string; env?: NodeJS.ProcessEnv; reject?: boolean };
}
