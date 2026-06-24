"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Route → skin mapping.
 * "rugged"  = deep pine + blaze orange Modern Trail
 * "refined" = warm paper + evergreen (clean base)
 */
// Auth screens that stay clean/refined. Keep in sync with layout.tsx.
const REFINED_AUTH_PREFIXES = ["/login", "/signup", "/forgot-password", "/update-password"];

function getSkin(pathname: string): "rugged" | "refined" {
  // auth screens stay clean/refined
  if (REFINED_AUTH_PREFIXES.some((p) => pathname.startsWith(p))) return "refined";
  // gear + planning screens get rugged
  return "rugged";
}

interface Props {
  children: React.ReactNode;
}

export function SkinController({ children }: Props) {
  const pathname = usePathname();
  const skin = getSkin(pathname);

  // Apply skin to <html> so the transition runs on the document root
  // (CSS transitions on html handle the color tween)
  const prevSkinRef = useRef<string | null>(null);
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-skin", skin);
    prevSkinRef.current = skin;
  }, [skin]);

  // Check reduced-motion preference
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Crisp cross-tone wipe — confident, mechanical, no bounce/overshoot.
  const variants = prefersReducedMotion
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, clipPath: "inset(0 0 100% 0)" },
        animate: { opacity: 1, clipPath: "inset(0 0 0% 0)" },
        exit:    { opacity: 0, clipPath: "inset(0 0 0% 0)" },
      };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={variants.initial}
        animate={variants.animate}
        exit={variants.exit}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        style={{ minHeight: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
