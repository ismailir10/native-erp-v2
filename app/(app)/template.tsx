/** Remounts on every navigation, so each page settles in once (ui-rules §Motion; `.page-settle` in app/globals.css). */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-settle">{children}</div>;
}
