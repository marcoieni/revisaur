import path from "node:path";
import { execa } from "execa";
import type { Reviewer, ReviewRequest, ReviewResult } from "./reviewer.js";
import type { ReviewComment, ReviewerConfig } from "../types/revisaur.js";
import { stripControlCharacters } from "../utils/sanitizeText.js";

const reviewSeverities = new Set<ReviewComment["severity"]>(["critical", "note", "suggestion", "warning"]);
const reviewerEnvironmentKeys = ["HOME", "KIRO_API_KEY", "PATH"] as const;
const reviewJsonShape = `{
  "summary": "short markdown summary",
  "comments": [
    {
      "path": "file path from the diff",
      "line": 123,
      "side": "right",
      "severity": "critical|warning|suggestion|note",
      "body": "comment body"
    }
  ]
}`;

export class KiroReviewer implements Reviewer {
    private readonly command: string;

    constructor(
        private readonly config: ReviewerConfig,
        commandBaseDir = process.cwd(),
    ) {
        // Resolve relative wrapper commands before running from a PR checkout so
        // attacker-controlled repository files cannot shadow the reviewer binary.
        this.command = resolveReviewerCommand(config.command, commandBaseDir);
    }

    async review(request: ReviewRequest): Promise<ReviewResult> {
        const prompt = buildPrompt(request);
        const rawOutput = await this.runKiro(prompt, request.repositoryPath);
        try {
            return parseReviewOutput(rawOutput);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const repairedOutput = await this.runKiro(buildRepairPrompt(request, rawOutput), request.repositoryPath);
            try {
                return parseReviewOutput(repairedOutput);
            } catch {
                throw new Error(`Reviewer did not produce valid JSON: ${reason}${previewOutput(rawOutput)}`);
            }
        }
    }

    private async runKiro(prompt: string, cwd?: string): Promise<string> {
        const args = ["chat", "--no-interactive", `--trust-tools=${this.config.trustTools}`];
        if (this.config.model !== undefined && this.config.model !== "") {
            args.push("--model", this.config.model);
        }
        args.push(prompt);

        const result = await execa(this.command, args, {
            timeout: this.config.timeoutSeconds * 1000,
            // The reviewer consumes attacker-influenced PR diffs, so do not inherit
            // workflow credentials such as GITHUB_TOKEN.
            env: reviewerEnvironment(),
            ...(cwd === undefined ? {} : { cwd }),
            reject: false,
        });

        const rawOutput = formatReviewerOutput(result.stdout, result.stderr);
        logKiroOutput(result);
        if (result.failed) {
            throw new Error(formatReviewerFailure(result, rawOutput));
        }

        return rawOutput;
    }
}

function resolveReviewerCommand(command: string, baseDir: string): string {
    if (!hasPathSeparator(command) || path.isAbsolute(command)) {
        return command;
    }

    return path.resolve(baseDir, command);
}

function hasPathSeparator(command: string): boolean {
    return command.includes("/") || command.includes("\\");
}

function reviewerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};

    for (const key of reviewerEnvironmentKeys) {
        if (source[key] !== undefined) {
            env[key] = source[key];
        }
    }

    return env;
}

function buildPrompt(request: ReviewRequest): string {
    const configuredInstructions = request.promptInstructions?.trim();
    const additionalInstructions =
        configuredInstructions !== undefined && configuredInstructions !== ""
            ? `\nAdditional instructions:\n${configuredInstructions}\n`
            : "";
    const checkoutInstructions =
        request.repositoryPath === undefined
            ? ""
            : `\nThe repository is checked out at the pull request head commit in your current working directory:\n${request.repositoryPath}\nUse it for extra context when the diff alone is insufficient.\n`;

    return `Review this pull request diff.

Repository: ${request.repositoryUrl}
Pull request: #${request.pullRequest.number.toString()} ${request.pullRequest.title}
Author: ${request.pullRequest.author}
Head commit: ${request.pullRequest.headSha}
${checkoutInstructions}
${additionalInstructions}

Return only valid JSON with this exact shape and no surrounding text:
${reviewJsonShape}

Use "right" for added/new lines and "left" for removed/old lines. Tie all comments to specific diff lines.
Summaries and comment bodies must contain markdown (use backticks for code and to avoid underscore being threated as italic). Use escaped JSON newlines ("\\n") when they improve readability.
If there are no findings, return an empty comments array.
If you cannot complete the review, still return valid JSON with a summary explaining the limitation and an empty comments array.

Diff:
${request.diff}`;
}

function buildRepairPrompt(request: ReviewRequest, previousOutput: string): string {
    return `Convert the previous pull request review output into valid JSON only.

Repository: ${request.repositoryUrl}
Pull request: #${request.pullRequest.number.toString()} ${request.pullRequest.title}
Head commit: ${request.pullRequest.headSha}

Return only JSON with this exact shape and no surrounding markdown, prose, or code fences:
${reviewJsonShape}

Rules:
- Preserve any specific findings from the previous output.
- Preserve useful paragraph breaks or bullet-style lines with escaped JSON newlines ("\\n").
- Tie comments only to specific file paths and line numbers mentioned in the previous output.
- If no specific comments can be recovered, return an empty comments array.
- If the previous output says the review could not be completed, put that limitation in summary and return an empty comments array.

Previous output:
${previousOutput.slice(0, 12000)}`;
}

function formatReviewerOutput(stdout: string, stderr: string): string {
    const parts = [stdout, stderr].filter((part) => part.trim().length > 0);
    return stripControlCharacters(parts.join("\n"));
}

function logKiroOutput(result: { exitCode?: number; stdout: string; stderr: string }): void {
    const stdout = stripControlCharacters(result.stdout).trim();
    const stderr = stripControlCharacters(result.stderr).trim();
    const exitCode = result.exitCode === undefined ? "unknown" : result.exitCode.toString();

    console.log(
        [
            `Kiro exit code: ${exitCode}`,
            `Kiro stdout: ${stdout === "" ? "<empty>" : stdout}`,
            `Kiro stderr: ${stderr === "" ? "<empty>" : stderr}`,
        ].join("\n"),
    );
}

function formatReviewerFailure(
    result: { exitCode?: number; timedOut?: boolean; stdout: string; stderr: string },
    rawOutput: string,
): string {
    const reason =
        result.timedOut === true
            ? "Reviewer command timed out"
            : `Reviewer command exited with code ${(result.exitCode ?? "unknown").toString()}`;
    return `${reason}.${previewOutput(rawOutput)}`;
}

function previewOutput(output: string): string {
    const trimmed = output.trim();
    if (trimmed === "") {
        return " No reviewer output was captured.";
    }

    return ` Output preview: ${trimmed.slice(0, 1000)}`;
}

function parseReviewOutput(stdout: string): ReviewResult {
    const sanitizedOutput = stripControlCharacters(stdout);
    const json = extractJson(sanitizedOutput);
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) {
        throw new Error("Reviewer JSON must be an object.");
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const comments = Array.isArray(parsed.comments) ? parsed.comments.flatMap(parseReviewComment) : [];

    return {
        summary: stripControlCharacters(summary),
        comments,
        rawOutput: sanitizedOutput,
    };
}

function parseReviewComment(value: unknown): ReviewComment[] {
    if (
        !isRecord(value) ||
        typeof value.path !== "string" ||
        typeof value.line !== "number" ||
        !isReviewSide(value.side) ||
        !isReviewSeverity(value.severity)
    ) {
        return [];
    }

    const body = typeof value.body === "string" ? value.body : "";

    return [
        {
            path: value.path,
            line: value.line,
            side: value.side,
            severity: value.severity,
            body: stripControlCharacters(body),
        },
    ];
}

function isReviewSide(value: unknown): value is ReviewComment["side"] {
    return value === "left" || value === "right";
}

function isReviewSeverity(value: unknown): value is ReviewComment["severity"] {
    return typeof value === "string" && reviewSeverities.has(value as ReviewComment["severity"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function extractJson(output: string): string {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
    if (fenced) {
        return fenced[1].trim();
    }

    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start >= 0 && end > start) {
        return output.slice(start, end + 1);
    }

    throw new Error("Reviewer did not return JSON.");
}
