import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./loadConfig.js";

async function writeConfig(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "revisaur-config-"));
    const path = join(dir, "revisaur.toml");
    await writeFile(path, source);
    return path;
}

describe("loadConfig", () => {
    it("loads defaults and derives repository metadata from GitHub URLs", async () => {
        const path = await writeConfig(`
repositories = [
  { url = "https://github.com/Org/Repo.git" }
]
`);

        await expect(loadConfig(path)).resolves.toMatchObject({
            outputDir: "site-dist",
            dataDir: ".revisaur/data",
            maxPullRequests: 10,
            includedAuthors: [],
            includedAssignees: [],
            skippedAuthors: ["renovate", "renovate[bot]", "dependabot", "dependabot[bot]"],
            reviewer: {
                kind: "kiro",
                command: "kiro-cli",
                trustTools: "read,grep",
                timeoutSeconds: 900,
            },
            repositories: [
                {
                    id: "github-org-repo",
                    name: "Org/Repo",
                    provider: "github",
                    url: "https://github.com/Org/Repo.git",
                    owner: "Org",
                    repo: "Repo",
                    maxPullRequests: 10,
                    includedAuthors: [],
                    includedAssignees: [],
                    skippedAuthors: ["renovate", "renovate[bot]", "dependabot", "dependabot[bot]"],
                },
            ],
        });
    });

    it("lets repository settings override global settings", async () => {
        const path = await writeConfig(`
max_pull_requests = 25
skipped_authors = ["bot"]
prompt_instructions = "Focus on correctness and security."

[reviewer]
kind = "codex"
command = "codex"
model = "claude-sonnet-4.5"
trust_tools = "read"
timeout_seconds = 120

[[repositories]]
id = "custom"
name = "Display Name"
url = "https://github.com/example/project"
max_pull_requests = 3
skipped_authors = ["repo-bot"]
prompt_instructions = "Focus on API compatibility."
branch = "main"
`);

        await expect(loadConfig(path)).resolves.toMatchObject({
            maxPullRequests: 25,
            skippedAuthors: ["bot"],
            promptInstructions: "Focus on correctness and security.",
            reviewer: {
                kind: "codex",
                command: "codex",
                model: "claude-sonnet-4.5",
                trustTools: "read",
                timeoutSeconds: 120,
            },
            repositories: [
                {
                    id: "custom",
                    name: "Display Name",
                    owner: "example",
                    repo: "project",
                    branch: "main",
                    maxPullRequests: 3,
                    skippedAuthors: ["bot", "repo-bot"],
                    promptInstructions: "Focus on API compatibility.",
                },
            ],
        });
    });

    it("merges global and repository pull request filters", async () => {
        const path = await writeConfig(`
included_authors = ["alice"]
included_assignees = ["bob"]
skipped_authors = ["bot"]

[[repositories]]
url = "https://github.com/example/project"
included_authors = ["carol"]
included_assignees = ["dave"]
skipped_authors = ["repo-bot"]
`);

        await expect(loadConfig(path)).resolves.toMatchObject({
            includedAuthors: ["alice"],
            includedAssignees: ["bob"],
            skippedAuthors: ["bot"],
            repositories: [
                {
                    includedAuthors: ["alice", "carol"],
                    includedAssignees: ["bob", "dave"],
                    skippedAuthors: ["bot", "repo-bot"],
                },
            ],
        });
    });

    it("uses global prompt instructions when repositories do not override them", async () => {
        const path = await writeConfig(`
prompt_instructions = "Prefer actionable comments."

[[repositories]]
url = "https://github.com/example/project"
`);

        await expect(loadConfig(path)).resolves.toMatchObject({
            repositories: [
                {
                    promptInstructions: "Prefer actionable comments.",
                },
            ],
        });
    });

    it("rejects non-GitHub repository URLs", async () => {
        const path = await writeConfig(`
repositories = [
  { url = "https://gitlab.com/example/project" }
]
`);

        await expect(loadConfig(path)).rejects.toThrow("Only GitHub repository URLs are supported today");
    });
});
