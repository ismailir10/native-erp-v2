"use client";
import "./globals.css";
import AppError from "./error";

/** Restore the document and Buku styling when the root layout itself fails. */
export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="id"><head><title>Buku · Terjadi kesalahan</title></head><body><AppError {...props} /></body></html>;
}
