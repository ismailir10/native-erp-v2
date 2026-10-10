/** A public contact address must be one mailbox, never an injected mailto query. */
export function publicSupportEmail(value: string | undefined) {
  const email = value?.trim();
  return email && /^[A-Z0-9.!#$%&'*+/=^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(email) ? email : null;
}
