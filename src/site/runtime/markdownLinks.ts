export interface MarkdownLinkToken {
    destination: string;
    href: string;
    kind: "link";
    label: string;
}

export interface MarkdownTextToken {
    kind: "text";
    text: string;
}

export type MarkdownSourceToken = MarkdownLinkToken | MarkdownTextToken;

const allowedLinkProtocols = new Set(["http:", "https:"]);

interface ParsedMarkdownLink {
    destination: string;
    end: number;
    label: string;
}

export function tokenizeMarkdownSource(source: string): MarkdownSourceToken[] {
    const tokens: MarkdownSourceToken[] = [];
    let cursor = 0;

    while (cursor < source.length) {
        const linkStart = source.indexOf("[", cursor);
        if (linkStart === -1) {
            appendTextToken(tokens, source.slice(cursor));
            break;
        }

        appendTextToken(tokens, source.slice(cursor, linkStart));

        const link = readMarkdownLink(source, linkStart);
        if (link === undefined) {
            appendTextToken(tokens, source.slice(linkStart, linkStart + 1));
            cursor = linkStart + 1;
            continue;
        }

        const href = markdownDestinationHref(link.destination);
        if (href === undefined) {
            appendTextToken(tokens, source.slice(linkStart, link.end));
            cursor = link.end;
            continue;
        }

        tokens.push({
            destination: link.destination,
            href,
            kind: "link",
            label: link.label,
        });
        cursor = link.end;
    }

    return tokens;
}

export function markdownDestinationHref(destination: string): string | undefined {
    const href = destination.trim();
    if (href.length === 0 || hasUnsafeHrefCharacter(href)) {
        return undefined;
    }

    try {
        const url = new URL(href);
        return allowedLinkProtocols.has(url.protocol) ? url.href : undefined;
    } catch {
        return undefined;
    }
}

function readMarkdownLink(source: string, openingBracket: number): ParsedMarkdownLink | undefined {
    if (openingBracket > 0 && source[openingBracket - 1] === "!") {
        return undefined;
    }

    const closingBracket = findUnescapedCharacter(source, "]", openingBracket + 1);
    if (closingBracket === -1 || source[closingBracket + 1] !== "(") {
        return undefined;
    }

    const closingParenthesis = findClosingParenthesis(source, closingBracket + 2);
    if (closingParenthesis === -1) {
        return undefined;
    }

    const label = source.slice(openingBracket + 1, closingBracket);
    const destination = source.slice(closingBracket + 2, closingParenthesis);
    if (label.length === 0 || destination.trim().length === 0) {
        return undefined;
    }

    return {
        destination,
        end: closingParenthesis + 1,
        label,
    };
}

function findUnescapedCharacter(source: string, character: string, start: number): number {
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === character && !isEscaped(source, index)) {
            return index;
        }
    }

    return -1;
}

function findClosingParenthesis(source: string, start: number): number {
    let depth = 0;

    for (let index = start; index < source.length; index += 1) {
        if (isEscaped(source, index)) {
            continue;
        }

        if (source[index] === "(") {
            depth += 1;
        } else if (source[index] === ")") {
            if (depth === 0) {
                return index;
            }

            depth -= 1;
        }
    }

    return -1;
}

function isEscaped(source: string, index: number): boolean {
    let slashCount = 0;
    let cursor = index - 1;

    while (cursor >= 0 && source[cursor] === "\\") {
        slashCount += 1;
        cursor -= 1;
    }

    return slashCount % 2 === 1;
}

function hasUnsafeHrefCharacter(href: string): boolean {
    for (let index = 0; index < href.length; index += 1) {
        const character = href[index];
        const characterCode = href.charCodeAt(index);
        if (characterCode <= 0x1f || characterCode === 0x7f || character.trim().length === 0) {
            return true;
        }
    }

    return false;
}

function appendTextToken(tokens: MarkdownSourceToken[], text: string): void {
    if (text.length === 0) {
        return;
    }

    if (tokens.length > 0) {
        const previousToken = tokens[tokens.length - 1];
        if (previousToken.kind === "text") {
            previousToken.text += text;
            return;
        }
    }

    tokens.push({ kind: "text", text });
}
