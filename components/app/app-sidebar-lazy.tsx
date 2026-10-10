"use client";

import dynamic from "next/dynamic";

// Only navigation is inside this SSR boundary; providers, keyboard handlers and page inputs stay eager.
export const AppSidebar = dynamic(
  () => import("./app-sidebar").then((module) => module.AppSidebar),
  { loading: () => null },
);
