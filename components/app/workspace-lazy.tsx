"use client";

import dynamic from "next/dynamic";

// Client boundaries split member-only controls while preserving their server-rendered markup.
export const WorkspaceAsk = dynamic(() => import("./workspace-ask").then((module) => module.WorkspaceAsk));
export const WorkspaceScopeBar = dynamic(() => import("./workspace-scope").then((module) => module.WorkspaceScopeBar));
export const WorkspaceShell = dynamic(() => import("./workspace-shell").then((module) => module.WorkspaceShell));
