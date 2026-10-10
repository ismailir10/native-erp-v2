"use client";

import dynamic from "next/dynamic";

export const SupportBar = dynamic(() => import("./support-bar").then((module) => module.SupportBar), { loading: () => null });
