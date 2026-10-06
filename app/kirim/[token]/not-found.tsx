import { AuthShell } from "@/app/login/shell";

/** One page for an unknown, expired or revoked upload link: nothing says which (I1d). */
export default function LinkNotFound() {
  return <AuthShell title="Tautan tidak berlaku" description="Tautan ini tidak berlaku lagi. Minta tautan baru ke kantor akuntan Anda.">{null}</AuthShell>;
}
