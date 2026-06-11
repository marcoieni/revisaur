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
