import type { ReactNode } from "react";
import { AppRahmen } from "@/components/rahmen/app-rahmen";

/** Rahmen mit fester Leiste (Oberflächenplan 09/2026), siehe `components/rahmen/app-rahmen.tsx`. */
export default function Layout({ children }: { children: ReactNode }) {
  return <AppRahmen>{children}</AppRahmen>;
}
