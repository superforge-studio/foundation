import { expect, test } from "vitest"
import { sortMiss } from "@/backend/misses/sort"

// How a request nothing answers is sorted: a scanner's probe, one that
// looks meant for the app and why, or neither

const site = "https://example.com"

test("what scanners try on every site is a probe", () => {
    for (const path of [
        "/wp-login.php",
        "/wp-admin/",
        "/blog/wp-includes/wlwmanifest.xml",
        "/wordpress",
        "/.env",
        "/.env.production",
        "/.git/config",
        "/api/.env",
        "/backup.sql",
        "/cgi-bin/luci",
        "/phpmyadmin/index.html",
        "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php"
    ]) {
        expect(sortMiss(new Request(`${site}${path}`)), path).toEqual({
            kind: "probe"
        })
    }
})

test("what's under /.well-known/ isn't a probe", () => {
    expect(sortMiss(new Request(`${site}/.well-known/security.txt`))).toEqual({
        kind: "other"
    })
})

test("a webhook sent to an address the app doesn't have looks meant for it", () => {
    const webhook = new Request(`${site}/webhooks/stripe`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Stripe-Signature": "t=1,v1=abc"
        },
        body: "{}"
    })
    expect(sortMiss(webhook)).toEqual({
        kind: "meant-for-app",
        because: ["signed", "json"]
    })
})

test("a signed request is never a probe, whatever its path", () => {
    const webhook = new Request(`${site}/hooks/receive.php`, {
        method: "POST",
        headers: { "X-Hub-Signature-256": "sha256=abc" }
    })
    expect(sortMiss(webhook)).toEqual({
        kind: "meant-for-app",
        because: ["signed"]
    })
})

test("a path under /api looks meant for the app", () => {
    expect(sortMiss(new Request(`${site}/api/contacts/old-route`))).toEqual({
        kind: "meant-for-app",
        because: ["api"]
    })
})

test("a link from a page on the same host looks meant for the app", () => {
    const broken = new Request(`${site}/images/team.png`, {
        headers: { Referer: `${site}/about` }
    })
    expect(sortMiss(broken)).toEqual({
        kind: "meant-for-app",
        because: ["linked"]
    })
})

test("a link from another site, or a GET with nothing to say, is neither", () => {
    expect(
        sortMiss(
            new Request(`${site}/old-page`, {
                headers: { Referer: "https://elsewhere.com/post" }
            })
        )
    ).toEqual({ kind: "other" })
    expect(sortMiss(new Request(`${site}/favicon.ico`))).toEqual({
        kind: "other"
    })
})
