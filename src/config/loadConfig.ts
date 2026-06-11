import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { z } from "zod";
import type { RepositoryConfig, RevisaurConfig } from "../types/revisaur.js";

const dataDirKey = "data_dir";
const includedAssigneesKey = "included_assignees";
const includedAuthorsKey = "included_authors";
const maxPullRequestsKey = "max_pull_requests";
const outputDirKey = "output_dir";
const promptInstructionsKey = "prompt_instructions";
const skippedAuthorsKey = "skipped_authors";
const timeoutSecondsKey = "timeout_seconds";
const trustToolsKey = "trust_tools";

const repositorySchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    provider: z.enum(["github", "gitlab", "forgejo"]).default("github"),
    url: z.url(),
    [maxPullRequestsKey]: z.number().int().positive().optional(),
    [includedAuthorsKey]: z.array(z.string()).optional(),
    [includedAssigneesKey]: z.array(z.string()).optional(),
    [skippedAuthorsKey]: z.array(z.string()).optional(),
    [promptInstructionsKey]: z.string().trim().min(1).optional(),
    branch: z.string().optional(),
});

const configSchema = z.object({
    [outputDirKey]: z.string().default("site-dist"),
    [dataDirKey]: z.string().default(".revisaur/data"),
    [maxPullRequestsKey]: z.number().int().positive().default(10),
    [includedAuthorsKey]: z.array(z.string()).default([]),
    [includedAssigneesKey]: z.array(z.string()).default([]),
    [skippedAuthorsKey]: z.array(z.string()).default(["renovate", "renovate[bot]", "dependabot", "dependabot[bot]"]),
    [promptInstructionsKey]: z.string().trim().min(1).optional(),
    reviewer: z
        .object({
            kind: z.enum(["kiro", "codex"]).default("kiro"),
            command: z.string().default("kiro-cli"),
            model: z.string().trim().min(1).optional(),
            [trustToolsKey]: z.string().default("read,grep"),
            [timeoutSecondsKey]: z.number().int().positive().default(900),
        })
        .prefault({}),
    repositories: z.array(repositorySchema).min(1),
});

export async function loadConfig(path: string): Promise<RevisaurConfig> {
    const source = await readFile(path, "utf8");
    const parsed = configSchema.parse(parse(source));
    const repositories = parsed.repositories.map((repo): RepositoryConfig => {
        const github = parseGitHubUrl(repo.url);
        const id = repo.id ?? `${repo.provider}-${github.owner}-${github.repo}`.toLowerCase();

        return {
            id,
            name: repo.name ?? `${github.owner}/${github.repo}`,
            provider: repo.provider,
            url: repo.url,
            owner: github.owner,
            repo: github.repo,
            branch: repo.branch,
            maxPullRequests: repo.max_pull_requests ?? parsed.max_pull_requests,
            includedAuthors: mergeUsers(parsed.included_authors, repo.included_authors),
            includedAssignees: mergeUsers(parsed.included_assignees, repo.included_assignees),
            skippedAuthors: mergeUsers(parsed.skipped_authors, repo.skipped_authors),
            promptInstructions: repo.prompt_instructions ?? parsed.prompt_instructions,
        };
    });

    return {
        outputDir: parsed.output_dir,
        dataDir: parsed.data_dir,
        maxPullRequests: parsed.max_pull_requests,
        includedAuthors: parsed.included_authors,
        includedAssignees: parsed.included_assignees,
        skippedAuthors: parsed.skipped_authors,
        promptInstructions: parsed.prompt_instructions,
        reviewer: {
            kind: parsed.reviewer.kind,
            command: parsed.reviewer.command,
            model: parsed.reviewer.model,
            trustTools: parsed.reviewer.trust_tools,
            timeoutSeconds: parsed.reviewer.timeout_seconds,
        },
        repositories,
    };
}

function mergeUsers(globalUsers: string[], repositoryUsers: string[] | undefined): string[] {
    return [...new Set([...globalUsers, ...(repositoryUsers ?? [])])];
}

function parseGitHubUrl(url: string): { owner: string; repo: string } {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/.exec(url);
    if (!match) {
        throw new Error(`Only GitHub repository URLs are supported today: ${url}`);
    }

    return { owner: match[1], repo: match[2] };
}
