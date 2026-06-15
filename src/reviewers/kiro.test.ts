import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { KiroReviewer } from "./kiro.js";
import type { ReviewerConfig } from "../types/revisaur.js";

vi.mock("execa", () => ({
    execa: vi.fn(() =>
        Promise.resolve({
            failed: false,
            stdout: JSON.stringify({
                summary: "Looks good.",
                comments: [],
            }),
            stderr: "",
        }),
    ),
}));

const request = {
    repositoryUrl: "https://github.com/example/project",
    pullRequest: {
        provider: "github" as const,
        repoId: "github-example-project",
        number: 123,
        reviewState: "ready" as const,
        title: "Improve widget",
        url: "https://github.com/example/project/pull/123",
        author: "dev",
        headSha: "abc123",
        baseSha: "def456",
        updatedAt: "2026-05-13T00:00:00.000Z",
    },
    diff: "diff --git a/widget.ts b/widget.ts",
};
const restoredEnvKeys = ["GITHUB_TOKEN", "HOME", "KIRO_API_KEY", "PATH", "UNRELATED_SECRET"] as const;
const originalEnv = Object.fromEntries(restoredEnvKeys.map((key) => [key, process.env[key]]));

function config(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
    return {
        kind: "kiro",
        command: "kiro-cli",
        trustTools: "read,grep",
        timeoutSeconds: 900,
        ...overrides,
    };
}

describe("KiroReviewer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        for (const key of restoredEnvKeys) {
            const value = originalEnv[key];
            if (value === undefined) {
                Reflect.deleteProperty(process.env, key);
            } else {
                process.env[key] = value;
            }
        }
    });

    it("runs Kiro without a model flag by default", async () => {
        await new KiroReviewer(config()).review(request);

        expect(execa).toHaveBeenCalledWith(
            "kiro-cli",
            expect.arrayContaining(["chat", "--no-interactive", "--trust-tools=read,grep"]),
            expect.objectContaining({ reject: false, timeout: 900_000 }),
        );
        expect(execa).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining(["--model"]),
            expect.anything(),
        );
    });

    it("passes the configured model to Kiro", async () => {
        await new KiroReviewer(config({ model: "claude-sonnet-4.5" })).review(request);

        expect(execa).toHaveBeenCalledWith(
            "kiro-cli",
            expect.arrayContaining(["--model", "claude-sonnet-4.5"]),
            expect.objectContaining({ timeout: 900_000 }),
        );
    });

    it("passes only the environment Kiro needs", async () => {
        process.env.GITHUB_TOKEN = "github-token";
        process.env.HOME = "/home/revisaur";
        process.env.KIRO_API_KEY = "kiro-api-key";
        process.env.PATH = "/usr/bin";
        process.env.UNRELATED_SECRET = "another-secret";

        await new KiroReviewer(config()).review(request);

        const expectedEnv = Object.fromEntries([
            ["HOME", "/home/revisaur"],
            ["KIRO_API_KEY", "kiro-api-key"],
            ["PATH", "/usr/bin"],
        ]);
        expect(execa).toHaveBeenCalledWith(
            "kiro-cli",
            expect.any(Array),
            expect.objectContaining({ env: expectedEnv }),
        );
    });

    it("includes configured prompt instructions in the review prompt", async () => {
        await new KiroReviewer(config()).review({
            ...request,
            promptInstructions: "Prioritize compatibility issues.",
        });

        expect(vi.mocked(execa).mock.calls[0]?.[1]).toEqual(
            expect.arrayContaining([
                expect.stringContaining("Additional instructions:\nPrioritize compatibility issues."),
            ]),
        );
    });

    it("includes captured output when Kiro exits unsuccessfully", async () => {
        vi.mocked(execa).mockResolvedValueOnce({
            failed: true,
            exitCode: 1,
            timedOut: false,
            stdout: "Unable to continue",
            stderr: "missing permission",
        } as Awaited<ReturnType<typeof execa>>);

        await expect(new KiroReviewer(config()).review(request)).rejects.toThrow(
            "Reviewer command exited with code 1. Output preview: Unable to continue\nmissing permission",
        );
    });

    it("repairs invalid JSON responses with a second Kiro pass", async () => {
        vi.mocked(execa).mockResolvedValueOnce({
            failed: false,
            stdout: "I reviewed the diff and found no issues.",
            stderr: "",
        } as Awaited<ReturnType<typeof execa>>);

        await expect(new KiroReviewer(config()).review(request)).resolves.toMatchObject({
            summary: "Looks good.",
            comments: [],
        });

        expect(execa).toHaveBeenCalledTimes(2);
        expect(vi.mocked(execa).mock.calls[1]?.[1]).toEqual(
            expect.arrayContaining([expect.stringContaining("Convert the previous pull request review output")]),
        );
    });

    it("explains invalid JSON responses when repair also fails", async () => {
        vi.mocked(execa)
            .mockResolvedValueOnce({
                failed: false,
                stdout: "I reviewed the diff and found no issues.",
                stderr: "",
            } as Awaited<ReturnType<typeof execa>>)
            .mockResolvedValueOnce({
                failed: false,
                stdout: "Still not JSON.",
                stderr: "",
            } as Awaited<ReturnType<typeof execa>>);

        await expect(new KiroReviewer(config()).review(request)).rejects.toThrow(
            "Reviewer did not produce valid JSON: Reviewer did not return JSON. Output preview: I reviewed the diff and found no issues.",
        );
    });
});
