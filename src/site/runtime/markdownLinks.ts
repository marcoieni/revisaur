export interface MarkdownLinkToken {
    code?: boolean;
    destination: string;
    emphasis?: boolean;
    href: string;
    kind: "link";
    label: string;
    strong?: boolean;
}

export interface MarkdownTextToken {
    code?: boolean;
    emphasis?: boolean;
    kind: "text";
    strong?: boolean;
    text: string;
}

export type MarkdownSourceToken = MarkdownLinkToken | MarkdownTextToken;

const allowedLinkProtocols = new Set(["http:", "https:"]);

interface MarkdownTokenStyle {
    code?: boolean;
    emphasis?: boolean;
    strong?: boolean;
}

interface ParsedMarkdownLink {
    destination: string;
    end: number;
    label: string;
}

interface ParsedMarkdownSpan {
    close: string;
    contentEnd: number;
    contentStart: number;
    end: number;
    open: string;
    style: MarkdownTokenStyle;
}

export function tokenizeMarkdownSource(source: string): MarkdownSourceToken[] {
    return tokenizeMarkdownSourceWithStyle(source, {});
}

export function markdownSourceTokenClassNames(token: MarkdownSourceToken): string[] {
    return [
        token.strong === true ? "markdown-source-strong" : "",
        token.emphasis === true ? "markdown-source-emphasis" : "",
        token.code === true ? "markdown-source-code" : "",
    ].filter((className) => className.length > 0);
}

function tokenizeMarkdownSourceWithStyle(source: string, style: MarkdownTokenStyle): MarkdownSourceToken[] {
    const tokens: MarkdownSourceToken[] = [];
    let cursor = 0;

    while (cursor < source.length) {
        const tokenStart = findNextMarkdownTokenStart(source, cursor);
        if (tokenStart === -1) {
            appendTextToken(tokens, source.slice(cursor), style);
            break;
        }

        appendTextToken(tokens, source.slice(cursor, tokenStart), style);

        const span = readMarkdownSpan(source, tokenStart);
        if (span !== undefined) {
            const spanStyle = { ...style, ...span.style };
            appendTextToken(tokens, span.open, spanStyle);
            appendTokens(
                tokens,
                tokenizeMarkdownSourceWithStyle(source.slice(span.contentStart, span.contentEnd), spanStyle),
            );
            appendTextToken(tokens, span.close, spanStyle);
            cursor = span.end;
            continue;
        }

        if (source[tokenStart] === "[") {
            const link = readMarkdownLink(source, tokenStart);
            if (link === undefined) {
                appendTextToken(tokens, source.slice(tokenStart, tokenStart + 1), style);
                cursor = tokenStart + 1;
                continue;
            }

            const href = markdownDestinationHref(link.destination);
            if (href === undefined) {
                appendTextToken(tokens, source.slice(tokenStart, link.end), style);
                cursor = link.end;
                continue;
            }

            tokens.push({
                ...style,
                destination: link.destination,
                href,
                kind: "link",
                label: link.label,
            });
            cursor = link.end;
            continue;
        }

        appendTextToken(tokens, source.slice(tokenStart, tokenStart + 1), style);
        cursor = tokenStart + 1;
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

function findNextMarkdownTokenStart(source: string, start: number): number {
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === "[" || source[index] === "`" || source[index] === "*" || source[index] === "_") {
            return index;
        }
    }

    return -1;
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

function readMarkdownSpan(source: string, start: number): ParsedMarkdownSpan | undefined {
    if (source[start] === "`") {
        return readMarkdownCodeSpan(source, start);
    }

    if (source[start] === "*" || source[start] === "_") {
        return readMarkdownEmphasisSpan(source, start);
    }

    return undefined;
}

function readMarkdownCodeSpan(source: string, start: number): ParsedMarkdownSpan | undefined {
    if (isEscaped(source, start)) {
        return undefined;
    }

    const tickCount = countRepeatedCharacter(source, "`", start);
    const marker = "`".repeat(tickCount);
    const closingStart = source.indexOf(marker, start + tickCount);
    if (closingStart === -1) {
        return undefined;
    }

    return {
        close: marker,
        contentEnd: closingStart,
        contentStart: start + tickCount,
        end: closingStart + tickCount,
        open: marker,
        style: { code: true },
    };
}

function readMarkdownEmphasisSpan(source: string, start: number): ParsedMarkdownSpan | undefined {
    if (isEscaped(source, start)) {
        return undefined;
    }

    const markerCharacter = source[start];
    const markerLength = source[start + 1] === markerCharacter ? 2 : 1;
    if (!canOpenEmphasis(source, start, markerLength)) {
        return undefined;
    }

    const marker = markerCharacter.repeat(markerLength);
    const contentStart = start + markerLength;
    const closingStart = findClosingEmphasis(source, marker, contentStart);
    if (closingStart === -1 || closingStart === contentStart) {
        return undefined;
    }

    return {
        close: marker,
        contentEnd: closingStart,
        contentStart,
        end: closingStart + markerLength,
        open: marker,
        style: markerLength === 2 ? { strong: true } : { emphasis: true },
    };
}

function findClosingEmphasis(source: string, marker: string, start: number): number {
    for (let index = start; index < source.length; index += 1) {
        if (
            source.startsWith(marker, index) &&
            !isEscaped(source, index) &&
            canCloseEmphasis(source, index, marker.length)
        ) {
            return index;
        }
    }

    return -1;
}

function canOpenEmphasis(source: string, start: number, markerLength: number): boolean {
    const next = source.charAt(start + markerLength);
    if (next.length === 0 || isWhitespace(next)) {
        return false;
    }

    return !isIntrawordUnderscore(source, start, markerLength);
}

function canCloseEmphasis(source: string, start: number, markerLength: number): boolean {
    const previous = source.charAt(start - 1);
    if (previous.length === 0 || isWhitespace(previous)) {
        return false;
    }

    return !isIntrawordUnderscore(source, start, markerLength);
}

function isIntrawordUnderscore(source: string, start: number, markerLength: number): boolean {
    if (source[start] !== "_") {
        return false;
    }

    const previous = source[start - 1];
    const next = source[start + markerLength];
    return isWordCharacter(previous) && isWordCharacter(next);
}

function countRepeatedCharacter(source: string, character: string, start: number): number {
    let count = 0;
    while (source[start + count] === character) {
        count += 1;
    }

    return count;
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

function isWhitespace(character: string): boolean {
    return character.trim().length === 0;
}

function isWordCharacter(character: string | undefined): boolean {
    return character !== undefined && /[0-9A-Za-z]/.test(character);
}

function appendTokens(tokens: MarkdownSourceToken[], addedTokens: MarkdownSourceToken[]): void {
    for (const token of addedTokens) {
        if (token.kind === "text") {
            appendTextToken(tokens, token.text, token);
        } else {
            tokens.push(token);
        }
    }
}

function appendTextToken(tokens: MarkdownSourceToken[], text: string, style: MarkdownTokenStyle): void {
    if (text.length === 0) {
        return;
    }

    if (tokens.length > 0) {
        const previousToken = tokens[tokens.length - 1];
        if (previousToken.kind === "text" && hasSameStyle(previousToken, style)) {
            previousToken.text += text;
            return;
        }
    }

    tokens.push({ ...style, kind: "text", text });
}

function hasSameStyle(token: MarkdownSourceToken, style: MarkdownTokenStyle): boolean {
    return (
        Boolean(token.code) === Boolean(style.code) &&
        Boolean(token.emphasis) === Boolean(style.emphasis) &&
        Boolean(token.strong) === Boolean(style.strong)
    );
}
