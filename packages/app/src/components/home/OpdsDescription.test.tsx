// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OpdsDescription } from "./OpdsDescription";

describe("OPDS description links", () => {
  it("prevents app navigation and opens a revalidated HTTP link externally", async () => {
    const openExternal = vi.fn(async () => undefined);
    render(
      <OpdsDescription
        description={'<p><a href="/author">Author site</a></p>'}
        documentUrl="https://catalog.test/books/1"
        openExternal={openExternal}
      />,
    );
    const link = screen.getByRole("link", { name: "Author site" });

    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    await userEvent.click(link);

    expect(openExternal).toHaveBeenCalledExactlyOnceWith("https://catalog.test/author");
    expect(window.location.href).toBe("http://localhost:3000/");
  });

  it("keeps unsafe catalog links inert", async () => {
    const openExternal = vi.fn(async () => undefined);
    const { container } = render(
      <OpdsDescription
        description={'<a href="javascript:alert(1)">Unsafe</a>'}
        documentUrl="https://catalog.test/feed"
        openExternal={openExternal}
      />,
    );

    await userEvent.click(screen.getByText("Unsafe"));

    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
