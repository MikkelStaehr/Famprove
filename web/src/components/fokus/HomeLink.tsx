"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode, Ref } from "react";

import { settle } from "@/components/useSetLog";

/**
 * A link back to Træning (Afslut, Tilbage til Træning) that first lets the queued set taps land,
 * so Træning reads them back instead of briefly showing a set as open. It stays a real link: a
 * modified click (new tab) or no JS just follows it.
 */
export function HomeLink({
  flush,
  className,
  children,
  ref,
}: {
  readonly flush: () => Promise<void>;
  readonly className: string;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLAnchorElement>;
}) {
  const router = useRouter();
  return (
    <Link
      ref={ref}
      href="/train"
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        void settle(flush).then(() => router.push("/train"));
      }}
    >
      {children}
    </Link>
  );
}
