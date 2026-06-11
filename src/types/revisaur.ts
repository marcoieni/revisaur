export type ProviderKind = "forgejo" | "github" | "gitlab";

export type ReviewStatus = "failed" | "reviewed" | "skipped";
export type PullRequestReviewState = "approved" | "draft" | "ready";

export interface RevisaurConfig {
    outputDir: string;
    dataDir: string;
    maxPullRequests: number;
    includedAuthors: string[];
    includedAssignees: string[];
    skippedAuthors: string[];
    promptInstructions?: string;
    reviewer: ReviewerConfig;
    repositories: RepositoryConfig[];
}

export interface ReviewerConfig {
    kind: "codex" | "kiro";
    command: string;
    model?: string;
    trustTools: string;
    timeoutSeconds: number;
}

export interface RepositoryConfig {
    id: string;
    name: string;
    provider: ProviderKind;
    url: string;
    owner: string;
    repo: string;
    branch?: string;
    maxPullRequests: number;
    includedAuthors: string[];
    includedAssignees: string[];
    skippedAuthors: string[];
    promptInstructions?: string;
}

export interface PullRequestSummary {
    provider: ProviderKind;
    repoId: string;
    number: number;
    reviewState: PullRequestReviewState;
    title: string;
    url: string;
    author: string;
    assignees?: string[];
    headSha: string;
    baseSha: string;
    updatedAt: string;
    mergedAt?: string | null;
}

export interface ReviewComment {
    path: string;
    line: number;
    side: "left" | "right";
    severity: "critical" | "note" | "suggestion" | "warning";
    body: string;
}

export interface PullRequestReview {
    repoId: string;
    pullRequest: PullRequestSummary;
    status: ReviewStatus;
    reviewedCommit: string;
    reviewedAt: string;
    summary: string;
    rawOutput: string;
    diff: string;
    comments: ReviewComment[];
    error?: string;
}

export interface ReviewState {
    version: 1;
    reviews: Record<string, PullRequestReview>;
}
