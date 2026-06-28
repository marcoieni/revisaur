export function fuzzyScore(value: string, query: string): number {
    const normalizedQuery = query.toLowerCase();
    const normalizedValue = value.toLowerCase();

    if (normalizedValue === normalizedQuery) {
        return 0;
    }

    const tokenIndex = normalizedValue.split(/[^a-z0-9]+/).findIndex((token) => token.startsWith(normalizedQuery));
    if (tokenIndex !== -1) {
        return 5 + tokenIndex;
    }

    const startsAt = normalizedValue.indexOf(normalizedQuery);
    if (startsAt !== -1) {
        return 10 + startsAt;
    }

    let cursor = 0;
    let firstMatch = -1;
    let lastMatch = -1;
    let gaps = 0;

    for (const character of normalizedQuery) {
        const matchIndex = normalizedValue.indexOf(character, cursor);
        if (matchIndex === -1) {
            return Number.POSITIVE_INFINITY;
        }
        if (lastMatch !== -1) {
            gaps += matchIndex - lastMatch - 1;
        }
        if (firstMatch === -1) {
            firstMatch = matchIndex;
        }
        lastMatch = matchIndex;
        cursor = matchIndex + 1;
    }

    return 100 + firstMatch * 2 + gaps * 10;
}

export function bestFuzzyScore(values: string[], query: string): number {
    const normalizedQuery = query.trim();
    if (normalizedQuery === "") {
        return 0;
    }

    return values.reduce(
        (bestScore, value) => Math.min(bestScore, fuzzyScore(value, normalizedQuery)),
        Number.POSITIVE_INFINITY,
    );
}
