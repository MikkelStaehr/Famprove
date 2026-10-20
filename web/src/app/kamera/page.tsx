import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { CameraDiag } from "@/components/CameraDiag";
import { recordingAllowed } from "@/lib/video/clips";

export const metadata: Metadata = {
  title: "Kameratest · Træning",
};

/**
 * `/kamera` (slice camera-diag, 2026-10-20): every camera on the phone, its zoom and sizes, with a
 * test shot each, as text the user copies for camera-wide. Outside the (tabs) shell like /fokus.
 * Nothing is sent or stored: no server action, no fetch. The camera only where recording is allowed.
 */
export default async function KameraPage() {
  await connection(); // request time: the host decides, never the build
  const allowed = recordingAllowed(process.env, process.env.NODE_ENV);
  return (
    <main className="mx-auto flex w-full max-w-[30rem] flex-col gap-3 pt-[max(20px,env(safe-area-inset-top))] pr-[max(16px,env(safe-area-inset-right))] pb-8 pl-[max(16px,env(safe-area-inset-left))]">
      <Link href="/train" className="self-start font-sans text-14 text-text-muted underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        ← Træning
      </Link>
      <h1 className="font-sans text-28 font-medium text-text">Kameratest</h1>
      {allowed ? (
        <>
          <p className="font-sans text-14 text-text-muted">
            Åbner hvert kamera for sig og viser zoom, opløsninger og et testbillede. Intet sendes eller gemmes; Kopiér alt lægger teksten i udklipsholderen.
          </p>
          <CameraDiag />
        </>
      ) : (
        <p className="font-sans text-14 text-text">Kameratest virker kun på produktionen.</p>
      )}
    </main>
  );
}
