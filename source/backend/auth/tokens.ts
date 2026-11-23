/**
 * 32 random bytes, in base64url: a session's token, for its cookie, or the
 * stand-in's link (@superforge/infra's stand-in). Only a token's SHA-256 is
 * ever stored (`sha256()`).
 */
export function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")
}

/**
 * SHA-256, as hex: how a session's token is kept, so a leaked row can't be
 * used as a cookie.
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
