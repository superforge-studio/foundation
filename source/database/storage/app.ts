import { FoundationStorage } from "./files"

/**
 * Every kind of file the app keeps, as `context.var.storage` in a route:
 * the template's (./files.ts, whose header has how a kind is written), and
 * this app's own, which go here, where no update from the template meets
 * them. A kind of the business's is a getter on this class, listed in
 * `kinds` after the template's:
 *
 *   export class Storage extends FoundationStorage {
 *       override get kinds() {
 *           return [...super.kinds, this.invoices]
 *       }
 *
 *       get invoices() {
 *           return new Files(this.store, { folder: "invoices", … })
 *       }
 *   }
 */
export class Storage extends FoundationStorage {}
