// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { PasswordInput } from "./password-input";

describe("shared secure dialog controls", () => {
  it("gives the password reveal control localized keyboard-accessible labels", async () => {
    render(
      <PasswordInput
        aria-label="Password"
        showPasswordLabel="Show saved secret"
        hidePasswordLabel="Hide saved secret"
      />,
    );
    const reveal = screen.getByRole("button", { name: "Show saved secret" });

    reveal.focus();
    expect(document.activeElement).toBe(reveal);
    await userEvent.keyboard("{Enter}");

    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "Hide saved secret" })).toBe(reveal);
  });

  it("uses the caller-provided localized dialog close label", () => {
    render(
      <Dialog open>
        <DialogContent closeLabel="Fermer">
          <DialogTitle>Catalogue</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Fermer" })).toBeTruthy();
  });
});
