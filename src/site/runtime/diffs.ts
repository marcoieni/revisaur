import {
    DIFFS_TAG_NAME,
    FileDiff,
    parsePatchFiles,
    type BaseDiffOptions,
    type DiffLineAnnotation,
    type FileDiffMetadata,
    type ThemeTypes,
} from "@pierre/diffs";
import { commentAddressedKey, loadAddressedState, setAddressedValue, type AddressedComment } from "./addressed.js";
import { collapseChevronSvg } from "./icons.js";

const diffs: FileDiff<ReviewAnnotation>[] = [];
const diffRenderState = new Map<
    FileDiff<ReviewAnnotation>,
    {
        container: HTMLElement;
        fileDiff: FileDiffMetadata;
        lineAnnotations: DiffLineAnnotation<ReviewAnnotation>[];
    }
>();
const currentTheme = getCurrentTheme();
let currentOverflow = getCurrentOverflow();
let currentDiffStyle = getCurrentDiffStyle();
const copyFileNameLabel = "Copy file name to clipboard";
let addressedState = loadAddressedState();

document.addEventListener("theme:selected", (event) => {
    const selectedTheme = getCustomEventValue(event, "theme");
    const theme = isThemeType(selectedTheme) ? selectedTheme : getCurrentTheme();
    for (const diff of diffs) {
        diff.setThemeType(theme);
    }
});

document.addEventListener("diff-overflow:selected", (event) => {
    const selectedOverflow = getCustomEventValue(event, "overflow");
    const overflow = isDiffOverflow(selectedOverflow) ? selectedOverflow : getCurrentOverflow();
    currentOverflow = overflow;
    updateRenderedDiffOptions({ overflow });
});

document.addEventListener("diff-layout:selected", (event) => {
    const selectedLayout = getCustomEventValue(event, "layout");
    const diffStyle = isDiffLayout(selectedLayout) ? getDiffStyleForLayout(selectedLayout) : getCurrentDiffStyle();
    currentDiffStyle = diffStyle;
    updateRenderedDiffOptions({ diffStyle });
});

function updateRenderedDiffOptions(options: {
    diffStyle?: NonNullable<BaseDiffOptions["diffStyle"]>;
    overflow?: NonNullable<BaseDiffOptions["overflow"]>;
}): void {
    for (const diff of diffs) {
        diff.setOptions({ ...diff.options, ...options });
        rerenderDiff(diff);
    }
}

for (const container of document.querySelectorAll<HTMLElement>(".diff-view")) {
    const reviewKey = container.dataset.reviewKey ?? "unknown-review";
    const patch = decodeURIComponent(container.dataset.patch ?? "");
    const comments = parseReviewComments(decodeURIComponent(container.dataset.comments ?? "[]"));

    const parsed = parsePatchFiles(patch);
    const fragment = document.createDocumentFragment();

    for (const patchSet of parsed) {
        for (const fileDiff of patchSet.files) {
            const element = document.createElement(DIFFS_TAG_NAME);
            const lineAnnotations: DiffLineAnnotation<ReviewAnnotation>[] = comments
                .map((comment, index) => ({ comment, index }))
                .filter(({ comment }) => comment.path === fileDiff.name || comment.path === fileDiff.prevName)
                .map(({ comment, index }) => ({
                    lineNumber: comment.line,
                    side: comment.side === "right" ? ("additions" as const) : ("deletions" as const),
                    metadata: {
                        addressedKey: commentAddressedKey(reviewKey, comment, index),
                        path: comment.path,
                        line: comment.line,
                        side: comment.side,
                        severity: comment.severity,
                        body: comment.body,
                    },
                }));
            const collapsed = shouldCollapseFile(lineAnnotations);
            element.toggleAttribute("data-collapsed", collapsed);

            const diff = new FileDiff<ReviewAnnotation>({
                collapsed,
                diffStyle: currentDiffStyle,
                overflow: currentOverflow,
                theme: {
                    light: "pierre-light",
                    dark: "pierre-dark",
                },
                themeType: currentTheme,
                unsafeCSS: "::slotted([data-annotation-slot]) { color: #171717; }",
                renderHeaderPrefix(): HTMLButtonElement {
                    return createCollapseButton({
                        container: element,
                        diff,
                    });
                },
                renderAnnotation(annotation) {
                    const comment = annotation.metadata;
                    const location = `${comment.path}:${comment.line.toString()}`;
                    const addressed = addressedState[comment.addressedKey] ?? false;
                    const node = document.createElement("div");
                    node.className = `review-comment ${comment.severity}`;
                    node.toggleAttribute("data-addressed", addressed);
                    node.style.color = "#171717";
                    node.innerHTML = `<div class="review-comment-header"><label class="addressed-toggle review-comment-addressed"><input type="checkbox" data-addressed-toggle data-addressed-key="${escapeAttribute(comment.addressedKey)}"${addressed ? " checked" : ""} aria-label="Addressed" /></label><strong>${escapeHtml(comment.severity)}</strong><button class="copy-location-button" type="button" data-location="${escapeAttribute(location)}" data-tooltip="${copyFileNameLabel}" aria-label="${copyFileNameLabel}"><span class="copy-location-icon" aria-hidden="true"></span><span class="sr-only">${copyFileNameLabel}</span></button></div>`;
                    renderMarkdownSource(node, comment.body, comment.addressedKey);
                    const addressedToggle = node.querySelector<HTMLInputElement>("[data-addressed-toggle]");
                    addressedToggle?.addEventListener("change", () => {
                        addressedState = setAddressedValue(
                            addressedState,
                            comment.addressedKey,
                            addressedToggle.checked,
                        );
                        node.toggleAttribute("data-addressed", addressedToggle.checked);
                        if (addressedToggle.checked && shouldCollapseFile(lineAnnotations)) {
                            setDiffCollapsed(diff, true);
                        }
                    });
                    const button = node.querySelector<HTMLButtonElement>(".copy-location-button");
                    button?.addEventListener("click", () => {
                        void copyLocation(button, location);
                    });
                    return node;
                },
            });
            diffs.push(diff);
            diffRenderState.set(diff, {
                container: element,
                fileDiff,
                lineAnnotations,
            });

            diff.render({
                fileDiff,
                fileContainer: element,
                lineAnnotations,
            });
            fragment.append(element);
        }
    }

    container.replaceChildren(fragment);
}

function getCurrentTheme(): ThemeTypes {
    const theme = document.documentElement.dataset.theme;
    if (isThemeType(theme)) {
        return theme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getCurrentOverflow(): NonNullable<BaseDiffOptions["overflow"]> {
    return isDiffOverflow(document.documentElement.dataset.diffOverflow)
        ? document.documentElement.dataset.diffOverflow
        : "scroll";
}

function getCurrentDiffStyle(): NonNullable<BaseDiffOptions["diffStyle"]> {
    const layout = document.documentElement.dataset.diffLayout ?? localStorage.getItem("revisaur:diff-layout");
    return isDiffLayout(layout) ? getDiffStyleForLayout(layout) : "split";
}

function isThemeType(value: unknown): value is ThemeTypes {
    return value === "light" || value === "dark";
}

function isDiffOverflow(value: unknown): value is NonNullable<BaseDiffOptions["overflow"]> {
    return value === "scroll" || value === "wrap";
}

function isDiffLayout(value: unknown): value is "split" | "stacked" {
    return value === "split" || value === "stacked";
}

function getDiffStyleForLayout(layout: "split" | "stacked"): NonNullable<BaseDiffOptions["diffStyle"]> {
    return layout === "stacked" ? "unified" : "split";
}

function escapeHtml(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
    return escapeHtml(value).replaceAll('"', "&quot;");
}

function renderMarkdownSource(container: HTMLElement, markdownSource: string, sourceKey: string): void {
    const rendered = getRenderedMarkdownSource(sourceKey);
    if (rendered) {
        container.append(rendered);
        return;
    }

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-source";
    code.textContent = markdownSource;
    pre.append(code);
    wrapper.append(pre);
    container.append(wrapper);
}

function getRenderedMarkdownSource(sourceKey: string): DocumentFragment | undefined {
    for (const template of document.querySelectorAll<HTMLTemplateElement>("template[data-markdown-source-key]")) {
        if (template.dataset.markdownSourceKey === sourceKey) {
            return template.content.cloneNode(true) as DocumentFragment;
        }
    }

    return undefined;
}

async function copyLocation(button: HTMLButtonElement, location: string): Promise<void> {
    try {
        if ("clipboard" in navigator) {
            await navigator.clipboard.writeText(location);
        } else {
            throw new Error("Clipboard unavailable");
        }
        setCopyButtonState(button, "Copied!");
    } catch {
        setCopyButtonState(button, "Copy failed");
    }
}

function setCopyButtonState(button: HTMLButtonElement, status: string): void {
    const originalLabel = button.dataset.copyLabel ?? button.getAttribute("aria-label") ?? copyFileNameLabel;
    button.dataset.copyLabel = originalLabel;
    button.setAttribute("aria-label", status);
    button.dataset.tooltip = status;
    button.dataset.copied = status === "Copied!" ? "true" : "false";

    window.setTimeout(() => {
        button.setAttribute("aria-label", originalLabel);
        button.dataset.tooltip = originalLabel;
        delete button.dataset.copied;
    }, 1400);
}

function createCollapseButton({
    container,
    diff,
}: {
    container: HTMLElement;
    diff: FileDiff<ReviewAnnotation>;
}): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "diff-collapse-toggle";
    button.type = "button";
    updateCollapseButtonState(button, container.hasAttribute("data-collapsed"));
    button.innerHTML = collapseChevronSvg;

    button.addEventListener("click", () => {
        const collapsed = !container.hasAttribute("data-collapsed");
        setDiffCollapsed(diff, collapsed);
    });

    return button;
}

function shouldCollapseFile(lineAnnotations: DiffLineAnnotation<ReviewAnnotation>[]): boolean {
    return (
        lineAnnotations.length === 0 ||
        lineAnnotations.every((annotation) => addressedState[annotation.metadata.addressedKey] ?? false)
    );
}

function setDiffCollapsed(diff: FileDiff<ReviewAnnotation>, collapsed: boolean): void {
    const renderState = diffRenderState.get(diff);
    if (!renderState) {
        return;
    }

    renderState.container.toggleAttribute("data-collapsed", collapsed);
    const button = renderState.container.querySelector<HTMLButtonElement>(".diff-collapse-toggle");
    if (button) {
        updateCollapseButtonState(button, collapsed);
    }
    diff.setOptions({ ...diff.options, collapsed });
    rerenderDiff(diff);
}

function rerenderDiff(diff: FileDiff<ReviewAnnotation>): void {
    const renderState = diffRenderState.get(diff);
    if (!renderState) {
        return;
    }

    diff.render({
        fileDiff: renderState.fileDiff,
        fileContainer: renderState.container,
        forceRender: true,
        lineAnnotations: renderState.lineAnnotations,
    });
}

function updateCollapseButtonState(button: HTMLButtonElement, collapsed: boolean): void {
    button.title = collapsed ? "Expand file" : "Collapse file";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-expanded", String(!collapsed));
}

interface ReviewAnnotation extends ReviewCommentData {
    addressedKey: string;
}

interface ReviewCommentData extends AddressedComment {
    severity: string;
}

function getCustomEventValue(event: Event, key: string): unknown {
    if (!(event instanceof CustomEvent) || !isRecord(event.detail)) {
        return undefined;
    }

    return event.detail[key];
}

function parseReviewComments(value: string): ReviewCommentData[] {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed.filter(isReviewCommentData);
}

function isReviewCommentData(value: unknown): value is ReviewCommentData {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.path === "string" &&
        typeof value.line === "number" &&
        (value.side === "left" || value.side === "right") &&
        typeof value.severity === "string" &&
        typeof value.body === "string"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
