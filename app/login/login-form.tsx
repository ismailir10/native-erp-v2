"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestResetAction, signInAction, type FormState } from "./actions";

const initial: FormState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  const [email, setEmail] = useState("");
  return <form action={action} className="space-y-5" aria-busy={pending}>
    <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} /></div>
    <div className="space-y-2">
      <div className="flex items-baseline justify-between"><Label htmlFor="password">Kata sandi</Label><Link href="/login/lupa" className="text-sm underline underline-offset-4">Lupa kata sandi?</Link></div>
      <Input id="password" name="password" type="password" autoComplete="current-password" required aria-describedby={state.error ? "login-error" : undefined} />
    </div>
    {state.error && <p id="login-error" role="alert" className="text-sm text-fail">{state.error}</p>}
    <Button type="submit" className="w-full" disabled={pending}>{pending ? "Memeriksa…" : "Masuk"}</Button>
  </form>;
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestResetAction, initial);
  const [email, setEmail] = useState("");
  return <form action={action} className="space-y-5" aria-busy={pending}>
    <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} /></div>
    {state.notice && <p role="status" className="text-sm text-muted-foreground">{state.notice}</p>}
    {state.error && <p role="alert" className="text-sm text-fail">{state.error}</p>}
    <Button type="submit" className="w-full" disabled={pending || Boolean(state.notice)}>{pending ? "Mengirim…" : "Kirim tautan"}</Button>
    <p className="text-sm"><Link href="/login" className="underline underline-offset-4">Kembali ke halaman masuk</Link></p>
  </form>;
}
