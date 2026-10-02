/** Statement and ledger uploads go through a server action capped at 6 MB by Next (next.config.ts); the app's own limit is lower so the
 *  user always gets this message instead of a generic server error. The forms check it before sending. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TOO_BIG = "File terlalu besar (maks. 5 MB).";
