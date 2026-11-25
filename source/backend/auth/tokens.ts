/**
 * 32 random bytes, in base64url: a session's token, for its cookie. Only a
 * token's SHA-256 is ever stored (`sha256()`).
 */
export function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")
}

// What `randomCharacters()` draws from: letters and digits only, so a
// double click selects the whole token
const LETTERS_AND_DIGITS =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/**
 * `count` random letters and digits, each as likely as the next: an API
 * token's, after its prefix (api-tokens.ts). 43 of them hold as much chance
 * as 32 random bytes.
 */
export function randomCharacters(count: number) {
    // A byte past the last whole run of 62 is drawn again, so no character
    // comes up more often than another
    const limit = 256 - (256 % LETTERS_AND_DIGITS.length)
    let characters = ""
    while (characters.length < count) {
        for (const byte of crypto.getRandomValues(new Uint8Array(count))) {
            if (byte < limit && characters.length < count) {
                characters +=
                    LETTERS_AND_DIGITS[byte % LETTERS_AND_DIGITS.length]
            }
        }
    }
    return characters
}

/**
 * SHA-256, as hex: how a session's token and an API token are kept, so a
 * leaked row can't be used in their place.
 */
export async function sha256(value: string) {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
    )
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("")
}
