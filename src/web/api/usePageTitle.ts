import { useEffect } from "react";

/** Sets the document title to "<title> | AgentBoard" while the page is shown. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | AgentBoard`;
  }, [title]);
}
