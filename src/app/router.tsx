import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * A ~50-line router, rather than a dependency.
 *
 * The app has five destinations and one optional detail segment. React Router would be ~20 kB
 * to express `/reports/matrix`, and the History API is doing all the real work either way.
 */

export type RouteName =
  | "home"
  | "history"
  | "reports"
  | "settings"
  | "accounts"
  | "categories"
  | "budgets"
  | "import"
  | "recurring";

export interface Route {
  name: RouteName;
  /** Everything after the route name, e.g. ["matrix"] for /reports/matrix. */
  segments: string[];
  query: URLSearchParams;
}

const ROUTE_NAMES: RouteName[] = [
  "home",
  "history",
  "reports",
  "settings",
  "accounts",
  "categories",
  "budgets",
  "import",
  "recurring",
];

function parse(pathname: string, search: string): Route {
  const segments = pathname.split("/").filter(Boolean);
  const [first, ...rest] = segments;
  const name = ROUTE_NAMES.find((route) => route === first) ?? "home";
  return { name, segments: rest, query: new URLSearchParams(search) };
}

interface RouterValue {
  route: Route;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  back: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter used outside RouterProvider");
  return value;
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState(() =>
    parse(window.location.pathname, window.location.search),
  );

  useEffect(() => {
    const onPopState = () => setRoute(parse(window.location.pathname, window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string, options?: { replace?: boolean }) => {
    const url = new URL(path, window.location.origin);
    if (options?.replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setRoute(parse(url.pathname, url.search));
    // A route change should start at the top; carrying the previous scroll position over is
    // disorienting, especially coming back from a deep history list.
    window.scrollTo({ top: 0 });
  }, []);

  const back = useCallback(() => window.history.back(), []);

  const value = useMemo(() => ({ route, navigate, back }), [route, navigate, back]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/** An in-app link. Falls back to normal navigation for modified clicks and external URLs. */
export function Link({
  to,
  children,
  ...props
}: { to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
