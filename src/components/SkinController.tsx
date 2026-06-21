"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Route → skin mapping.
 * "rugged"  = deep pine + blaze orange Modern Trail
 * "refined" = warm paper + evergreen (clean base)
 */
function getSkin(pathname: string): "rugged" | "refined" {
  // auth screens stay clean/refined
  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) return "refined";
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

  const variants = prefersReducedMotion
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit:    { opacity: 0, y: -4 },
      };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={variants.initial}
        animate={variants.animate}
        exit={variants.exit}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        style={{ minHeight: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
