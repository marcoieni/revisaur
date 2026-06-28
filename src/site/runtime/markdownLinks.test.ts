import { describe, expect, it } from "vitest";
import { markdownDestinationHref, tokenizeMarkdownSource } from "./markdownLinks.js";

describe("tokenizeMarkdownSource", () => {
    it("turns the markdown link label into a safe link token", () => {
        expect(tokenizeMarkdownSource("See [docs](https://example.com/docs) before merging.")).toEqual([
            { kind: "text", text: "See " },
            {
                destination: "https://example.com/docs",
                href: "https://example.com/docs",
                kind: "link",
                label: "docs",
            },
            { kind: "text", text: " before merging." },
        ]);
    });

    it("keeps unsafe markdown links as text", () => {
        expect(tokenizeMarkdownSource("Do not click [this](javascript:alert(1)).")).toEqual([
            { kind: "text", text: "Do not click [this](javascript:alert(1))." },
        ]);
    });

    it("supports balanced parentheses in link destinations", () => {
        expect(tokenizeMarkdownSource("[spec](https://example.com/rfc_(draft))")).toEqual([
            {
                destination: "https://example.com/rfc_(draft)",
                href: "https://example.com/rfc_(draft)",
                kind: "link",
                label: "spec",
            },
        ]);
    });

    it("marks bold markdown source while keeping delimiters copyable", () => {
        expect(tokenizeMarkdownSource("**Cache key issue found:** merge safely.")).toEqual([
            { kind: "text", strong: true, text: "**Cache key issue found:**" },
            { kind: "text", text: " merge safely." },
        ]);
    });

    it("marks emphasis without treating identifier underscores as markdown", () => {
        expect(tokenizeMarkdownSource("new_cache is _useful_ for the *current key*.")).toEqual([
            { kind: "text", text: "new_cache is " },
            { emphasis: true, kind: "text", text: "_useful_" },
            { kind: "text", text: " for the " },
            { emphasis: true, kind: "text", text: "*current key*" },
            { kind: "text", text: "." },
        ]);
    });

    it("applies source styles to markdown links inside emphasis", () => {
        expect(tokenizeMarkdownSource("See **[docs](https://example.com/docs)**.")).toEqual([
            { kind: "text", text: "See " },
            { kind: "text", strong: true, text: "**" },
            {
                destination: "https://example.com/docs",
                href: "https://example.com/docs",
                kind: "link",
                label: "docs",
                strong: true,
            },
            { kind: "text", strong: true, text: "**" },
            { kind: "text", text: "." },
        ]);
    });
});

describe("markdownDestinationHref", () => {
    it("allows HTTP and HTTPS destinations", () => {
        expect(markdownDestinationHref("http://example.com/path")).toBe("http://example.com/path");
        expect(markdownDestinationHref("https://example.com/path")).toBe("https://example.com/path");
    });

    it("rejects non-browser-navigation schemes", () => {
        expect(markdownDestinationHref("javascript:alert(1)")).toBeUndefined();
        expect(markdownDestinationHref("mailto:security@example.com")).toBeUndefined();
    });
});
