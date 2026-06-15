import type { PullRequestSummary, ReviewComment } from "../types/revisaur.js";

export interface ReviewRequest {
    repositoryUrl: string;
    repositoryPath?: string;
    pullRequest: PullRequestSummary;
    diff: string;
    promptInstructions?: string;
}

export interface ReviewResult {
    summary: string;
    comments: ReviewComment[];
    rawOutput: string;
}

export interface Reviewer {
    review(request: ReviewRequest): Promise<ReviewResult>;
}
