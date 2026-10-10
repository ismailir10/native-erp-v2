import { publicSupportEmail } from "@/lib/public-contact";

/** Read at render time; a deployment may supply its own public support mailbox. */
export function PublicContact() {
  const email = publicSupportEmail(process.env.BUKU_SUPPORT_EMAIL);
  return email ? <a href={`mailto:${encodeURIComponent(email)}`} className="drill break-all">{email}</a> : <span>Hubungi pengelola Buku</span>;
}
