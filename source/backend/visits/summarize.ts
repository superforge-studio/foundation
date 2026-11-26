import { eq, inArray, type SQL, sql } from "drizzle-orm"
import type { Database } from "@/database"
import { analytics_events, analytics_visits } from "@/database/schema"

const events = analytics_events

// The click IDs each ad network puts in a landing's address, which the
// pages' script keeps as properties of the first `view`
// (frontend/visitors/describe.ts)
const AD_CLICK_IDS = {
    google: ["gclid", "gbraid", "wbraid"],
    meta: ["fbclid"],
    microsoft: ["msclkid"],
    tiktok: ["ttclid"],
    linkedin: ["li_fat_id"]
}

// One of an event's properties, as text
function property(name: string) {
    return sql`(${events.properties} ->> ${name})`
}

// What the visit's first `view`, its landing, says: null when it doesn't,
// whatever a later page does
function ofLanding(value: SQL) {
    return sql`(array_agg(${value} order by ${events.occurred_at}, ${events.id}) filter (where ${events.name} = 'view'))[1]`
}

// How many of the visit's events are named `name`
function countOf(name: string) {
    return sql`(count(*) filter (where ${events.name} = ${name}))::integer`
}

// The network whose click ID the event's address carries: whose ad was
// clicked, for all but Meta, whose ID rides on every tap out of Facebook
// and Instagram, an ad's or not (README.md, "A visit")
const ad_network = sql`case ${sql.join(
    Object.entries(AD_CLICK_IDS).map(
        ([network, ids]) =>
            sql`when coalesce(${sql.join(
                ids.map((id) => property(id)),
                sql`, `
            )}) is not null then ${network}`
    ),
    sql` `
)} end`

/**
 * Works each of `visit_ids` out again from the events it has: when it
 * started and ended, how many pages it viewed and links and buttons it
 * clicked, whether it bounced (one page viewed at most, and nothing
 * clicked), where it landed and left, and where it came from, as its
 * landing said (the referrer, the campaign and the click ID). Called in the
 * transaction that added the events, so a visit always says what its
 * events do, whatever order they arrived in. A visit whose events are gone
 * (prune.ts) is left as it was.
 */
export async function summarizeVisits(database: Database, visit_ids: string[]) {
    if (visit_ids.length === 0) {
        return
    }
    const summed = database.$with("summed").as(
        database
            .select({
                visit_id: events.visit_id,
                started_at: sql`min(${events.occurred_at})`.as("started_at"),
                ended_at: sql`max(${events.occurred_at})`.as("ended_at"),
                views: countOf("view").as("views"),
                clicks: countOf("click").as("clicks"),
                landing_path: ofLanding(sql`${events.path}`).as("landing_path"),
                exit_path:
                    sql`(array_agg(${events.path} order by ${events.occurred_at} desc, ${events.id} desc) filter (where ${events.name} = 'view'))[1]`.as(
                        "exit_path"
                    ),
                referrer: ofLanding(property("referrer")).as("referrer"),
                utm_source: ofLanding(property("utm_source")).as("utm_source"),
                utm_medium: ofLanding(property("utm_medium")).as("utm_medium"),
                utm_campaign: ofLanding(property("utm_campaign")).as(
                    "utm_campaign"
                ),
                utm_term: ofLanding(property("utm_term")).as("utm_term"),
                utm_content: ofLanding(property("utm_content")).as(
                    "utm_content"
                ),
                ad_network: ofLanding(ad_network).as("ad_network")
            })
            .from(events)
            .where(inArray(events.visit_id, visit_ids))
            .groupBy(events.visit_id)
    )
    await database
        .with(summed)
        .update(analytics_visits)
        .set({
            started_at: summedColumn("started_at"),
            ended_at: summedColumn("ended_at"),
            views: summedColumn("views"),
            clicks: summedColumn("clicks"),
            bounced: sql`${summedColumn("views")} <= 1 and ${summedColumn("clicks")} = 0`,
            landing_path: summedColumn("landing_path"),
            exit_path: summedColumn("exit_path"),
            referrer: summedColumn("referrer"),
            utm_source: summedColumn("utm_source"),
            utm_medium: summedColumn("utm_medium"),
            utm_campaign: summedColumn("utm_campaign"),
            utm_term: summedColumn("utm_term"),
            utm_content: summedColumn("utm_content"),
            ad_network: summedColumn("ad_network")
        })
        .from(summed)
        .where(eq(analytics_visits.id, summed.visit_id))
}

// One of `summed`'s columns, by its name, written out with `summed` before
// it: Drizzle writes a CTE's column into an update's SET by its name alone,
// which there is the visit's own column of the same name
function summedColumn(name: string) {
    return sql`${sql.identifier("summed")}.${sql.identifier(name)}`
}
