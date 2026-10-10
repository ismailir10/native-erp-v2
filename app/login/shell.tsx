import { PublicShell } from "@/components/app/public-shell";

/** Auth forms retain their approved background; general public content stays still. */
export function AuthShell(props: React.ComponentProps<typeof PublicShell>) {
  return <PublicShell {...props} dotGrid />;
}
