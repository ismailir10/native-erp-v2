"use client";

import dynamic from "next/dynamic";

// The selector owns its SSR boundary, away from keyboard handlers and editable fields.
export const WorkspaceScopeBar = dynamic(
  () => import("./workspace-scope").then((module) => module.WorkspaceScopeBar),
  { loading: () => null },
);
