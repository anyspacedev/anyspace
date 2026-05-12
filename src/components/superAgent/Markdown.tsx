import { Streamdown, type Components } from "streamdown";
import { useThemeStore } from "../../stores/themeStore";

const SAFE_LINK_PROTOCOLS = /^(https?:|mailto:)/i;

function safeUrlTransform(url: string): string | null {
  if (!url) return null;
  if (url.startsWith("#") || url.startsWith("/")) return url;
  return SAFE_LINK_PROTOCOLS.test(url) ? url : null;
}

const components: Components = {
  a: ({ href, children, ...rest }) => {
    const url = typeof href === "string" ? href : undefined;
    if (!url) return <span {...rest}>{children as React.ReactNode}</span>;
    return (
      <a
        {...rest}
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => {
          e.preventDefault();
          void import("@tauri-apps/plugin-shell").then((m) => m.open(url));
        }}
      >
        {children as React.ReactNode}
      </a>
    );
  },
};

export function Markdown({ children }: { children: string }) {
  const kind = useThemeStore((s) => s.resolved.kind);
  const shikiTheme: ["github-light", "github-dark"] | ["github-dark", "github-light"] =
    kind === "light" ? ["github-light", "github-dark"] : ["github-dark", "github-light"];

  return (
    <Streamdown
      parseIncompleteMarkdown
      shikiTheme={shikiTheme}
      controls={false}
      lineNumbers={false}
      disallowedElements={["img"]}
      urlTransform={safeUrlTransform}
      components={components}
    >
      {children}
    </Streamdown>
  );
}
