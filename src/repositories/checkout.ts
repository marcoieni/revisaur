import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { PullRequestSummary, RepositoryConfig } from "../types/revisaur.js";

const githubTokenKey = "GITHUB_TOKEN";
const gitConfigCountKey = "GIT_CONFIG_COUNT";
const gitConfigKeyPrefix = "GIT_CONFIG_KEY_";
const gitConfigValuePrefix = "GIT_CONFIG_VALUE_";
const gitTerminalPromptKey = "GIT_TERMINAL_PROMPT";

interface GitAuth {
    env: Record<string, string>;
}

export interface ReviewCheckout {
    path: string;
    checkoutPullRequest(pullRequest: PullRequestSummary): Promise<void>;
    dispose(): Promise<void>;
}

export async function cloneRepositoryCheckout(repo: RepositoryConfig): Promise<ReviewCheckout> {
    const checkoutPath = await mkdtemp(path.join(tmpdir(), "revisaur-checkout-"));
    const auth = gitAuth(repo);

    try {
        await git(["clone", "--depth", "1", "--no-tags", "--single-branch", repo.url, checkoutPath], undefined, auth);

        return {
            path: checkoutPath,
            checkoutPullRequest: (pullRequest) => checkoutPullRequest(repo, checkoutPath, pullRequest, auth),
            dispose: () => removeCheckout(checkoutPath),
        };
    } catch (error) {
        await removeCheckout(checkoutPath);
        throw new Error(`Could not clone review checkout for ${repo.name}: ${formatCheckoutError(error)}`, {
            cause: error,
        });
    }
}

async function checkoutPullRequest(
    repo: RepositoryConfig,
    checkoutPath: string,
    pullRequest: PullRequestSummary,
    auth: GitAuth | undefined,
): Promise<void> {
    try {
        await git(["reset", "--hard"], checkoutPath);
        await git(["clean", "-fdx"], checkoutPath);
        await git(
            ["fetch", "--depth", "1", "--no-tags", "origin", pullRequestFetchRef(pullRequest)],
            checkoutPath,
            auth,
        );
        await git(["checkout", "--force", "--detach", "FETCH_HEAD"], checkoutPath);

        const head = (await git(["rev-parse", "HEAD"], checkoutPath)).stdout.trim();
        if (head !== pullRequest.headSha) {
            throw new Error(`Expected head ${pullRequest.headSha}, got ${head}.`);
        }
    } catch (error) {
        throw new Error(
            `Could not prepare review checkout for ${repo.name} PR #${pullRequest.number.toString()}: ${formatCheckoutError(error)}`,
            { cause: error },
        );
    }
}

async function git(args: string[], cwd?: string, auth?: GitAuth): Promise<{ stdout: string }> {
    return execa("git", args, {
        ...(cwd === undefined ? {} : { cwd }),
        env: { [gitTerminalPromptKey]: "0", ...auth?.env },
        reject: true,
    });
}

function gitAuth(repo: RepositoryConfig, source: NodeJS.ProcessEnv = process.env): GitAuth | undefined {
    if (repo.provider !== "github") {
        return undefined;
    }

    const token = source[githubTokenKey]?.trim();
    if (token === undefined || token === "") {
        return undefined;
    }

    const header = Buffer.from(`x-access-token:${token}`).toString("base64");

    return {
        env: {
            [gitConfigCountKey]: "1",
            [`${gitConfigKeyPrefix}0`]: "http.https://github.com/.extraheader",
            [`${gitConfigValuePrefix}0`]: `AUTHORIZATION: basic ${header}`,
        },
    };
}

function pullRequestFetchRef(pullRequest: PullRequestSummary): string {
    switch (pullRequest.provider) {
        case "github":
            return `refs/pull/${pullRequest.number.toString()}/head`;
        case "forgejo":
        case "gitlab":
            return pullRequest.headSha;
    }
}

async function removeCheckout(checkoutPath: string): Promise<void> {
    await rm(checkoutPath, { force: true, recursive: true });
}

function formatCheckoutError(error: unknown): string {
    if (isRecord(error)) {
        const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
        if (stderr !== "") {
            return redactCredentials(stderr);
        }

        const shortMessage = typeof error.shortMessage === "string" ? error.shortMessage.trim() : "";
        if (shortMessage !== "") {
            return redactCredentials(shortMessage);
        }
    }

    const message = error instanceof Error ? error.message : String(error);
    return redactCredentials(message);
}

function redactCredentials(message: string): string {
    return message
        .replaceAll(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/g, "$1<redacted>@")
        .replaceAll(/(AUTHORIZATION:\s*(?:basic|bearer)\s+)[^\s]+/gi, "$1<redacted>");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
