// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./opds-component-test-setup";
import { OpdsCatalogFormDialog } from "./OpdsCatalogFormDialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderControlledForm({
  store,
  catalog,
}: {
  store: unknown;
  catalog?: Parameters<typeof OpdsCatalogFormDialog>[0]["catalog"];
}) {
  let setOpen!: (open: boolean) => void;
  const onSaved = vi.fn();
  const onBackgroundSaved = vi.fn();

  function Host() {
    const [open, setOpenState] = useState(true);
    setOpen = setOpenState;
    return (
      <OpdsCatalogFormDialog
        open={open}
        catalog={catalog}
        store={store as never}
        onOpenChange={setOpenState}
        onSaved={() => {
          onSaved();
          setOpenState(false);
        }}
        onBackgroundSaved={onBackgroundSaved}
      />
    );
  }

  render(<Host />);
  return {
    onSaved,
    onBackgroundSaved,
    forceOpen(open: boolean) {
      act(() => setOpen(open));
    },
  };
}

describe("OpdsCatalogFormDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes a localized, keyboard-complete Basic-auth add flow", async () => {
    const addCatalog = vi.fn(async (_input: unknown) => ({ id: "added" }));
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <OpdsCatalogFormDialog
        open
        store={{ addCatalog } as never}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByRole("dialog", { name: "library.opds.form.addTitle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "library.opds.close" })).toBeTruthy();
    const anonymous = screen.getByRole("radio", { name: "library.opds.form.anonymous" });
    anonymous.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      (screen.getByRole("radio", { name: "library.opds.form.basic" }) as HTMLInputElement).checked,
    ).toBe(true);

    await userEvent.type(screen.getByLabelText("library.opds.form.name"), "Private shelf");
    await userEvent.type(
      screen.getByLabelText("library.opds.form.url"),
      "https://catalog.test/opds",
    );
    await userEvent.type(screen.getByLabelText("library.opds.form.username"), "reader");
    await userEvent.type(screen.getByLabelText("library.opds.form.password"), "secret");
    expect(screen.getByRole("button", { name: "library.opds.showPassword" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "library.opds.save" }));

    await waitFor(() => expect(addCatalog).toHaveBeenCalledOnce());
    expect(addCatalog.mock.calls[0]?.[0]).toMatchObject({
      name: "Private shelf",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "secret",
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("preserves a stored password for a same-origin path edit", async () => {
    const updateCatalog = vi.fn(async (_id: string, _update: unknown) => undefined);
    renderControlledForm({
      store: { updateCatalog },
      catalog: {
        id: "custom",
        name: "Private",
        url: "https://catalog.test/opds",
        auth: "basic",
        username: "reader",
        enabled: true,
        builtIn: false,
        hidden: false,
        passwordStorage: "persistent",
      },
    });

    const url = screen.getByLabelText("library.opds.form.url");
    await userEvent.clear(url);
    await userEvent.type(url, "https://catalog.test/opds/v2");
    expect(screen.getByPlaceholderText("library.opds.form.passwordUnchanged")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "library.opds.save" }));

    await waitFor(() => expect(updateCatalog).toHaveBeenCalledOnce());
    expect(updateCatalog.mock.calls[0]?.[1]).not.toHaveProperty("password");
  });

  it("requires a new password before saving a changed credential identity", async () => {
    const updateCatalog = vi.fn(async (_id: string, _update: unknown) => undefined);
    renderControlledForm({
      store: { updateCatalog },
      catalog: {
        id: "custom",
        name: "Private",
        url: "https://catalog.test/opds",
        auth: "basic",
        username: "reader",
        enabled: true,
        builtIn: false,
        hidden: false,
        passwordStorage: "persistent",
      },
    });

    const url = screen.getByLabelText("library.opds.form.url");
    await userEvent.clear(url);
    await userEvent.type(url, "https://other.test/opds");
    expect(
      screen.getByPlaceholderText("library.opds.form.passwordRequiredForIdentityChange"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "library.opds.save" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.type(screen.getByLabelText("library.opds.form.password"), "new-secret");
    expect(
      (screen.getByRole("button", { name: "library.opds.save" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("locks every mutable control and dismissal path during a current-generation save", async () => {
    const firstSave = deferred<{ id: string }>();
    const addCatalog = vi.fn(() => firstSave.promise);
    renderControlledForm({ store: { addCatalog } });
    const user = userEvent.setup();

    const name = screen.getByLabelText("library.opds.form.name") as HTMLInputElement;
    const url = screen.getByLabelText("library.opds.form.url") as HTMLInputElement;
    await user.type(name, "Pending shelf");
    await user.type(url, "http://localhost:8080/opds");
    await user.click(screen.getByRole("radio", { name: "library.opds.form.basic" }));
    const username = screen.getByLabelText("library.opds.form.username") as HTMLInputElement;
    const password = screen.getByLabelText("library.opds.form.password") as HTMLInputElement;
    const reveal = screen.getByRole("button", { name: "library.opds.showPassword" });
    const enabled = screen.getByRole("switch", {
      name: "library.opds.form.enabled",
    }) as HTMLButtonElement;
    await user.type(username, "reader");
    await user.type(password, "secret");
    await user.click(screen.getByRole("button", { name: "library.opds.save" }));
    const warning = screen.getByRole("alert");
    const warningCancel = screen.getAllByRole("button", { name: "library.opds.cancel" })[0];
    const continueSave = screen.getByRole("button", { name: "library.opds.continue" });
    await user.click(continueSave);

    const dialog = screen.getByRole("dialog", { name: "library.opds.form.addTitle" });
    const save = screen.getByRole("button", { name: "library.opds.save" });
    const footerCancel = screen.getAllByRole("button", { name: "library.opds.cancel" })[1];
    const close = screen.getByRole("button", { name: "library.opds.close" });
    const anonymous = screen.getByRole("radio", {
      name: "library.opds.form.anonymous",
    }) as HTMLInputElement;
    const basic = screen.getByRole("radio", {
      name: "library.opds.form.basic",
    }) as HTMLInputElement;
    for (const control of [
      name,
      url,
      anonymous,
      basic,
      username,
      password,
      reveal,
      enabled,
      warningCancel,
      continueSave,
      footerCancel,
      save,
      close,
    ]) {
      expect((control as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
    }
    expect(dialog.getAttribute("aria-busy")).toBe("true");

    await user.type(name, " changed");
    await user.type(url, "/changed");
    await user.click(anonymous);
    await user.type(username, "-changed");
    await user.type(password, "-changed");
    await user.click(reveal);
    await user.click(enabled);
    await user.click(warningCancel);
    await user.click(continueSave);
    await user.click(footerCancel);
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(addCatalog).toHaveBeenCalledOnce();
    expect(name.value).toBe("Pending shelf");
    expect(url.value).toBe("http://localhost:8080/opds");
    expect(anonymous.checked).toBe(false);
    expect(basic.checked).toBe(true);
    expect(username.value).toBe("reader");
    expect(password.value).toBe("secret");
    expect(password.type).toBe("password");
    expect(enabled.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("alert")).toBe(warning);

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "library.opds.form.addTitle" })).toBeTruthy();
    const overlay = dialog.previousElementSibling as HTMLElement;
    fireEvent.pointerDown(overlay, { button: 0, pointerType: "mouse" });
    fireEvent.click(overlay);
    expect(screen.getByRole("dialog", { name: "library.opds.form.addTitle" })).toBeTruthy();
    await user.click(close);
    expect(screen.getByRole("dialog", { name: "library.opds.form.addTitle" })).toBeTruthy();

    firstSave.resolve({ id: "added" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("serializes deferred updates across forced close/reopen without touching the new form", async () => {
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const updateCatalog = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const harness = renderControlledForm({
      store: { updateCatalog },
      catalog: {
        id: "custom",
        name: "Original shelf",
        url: "https://catalog.test/original",
        auth: "basic",
        username: "reader",
        enabled: true,
        builtIn: false,
        hidden: false,
        passwordStorage: "persistent",
      },
    });
    const user = userEvent.setup();

    const name = screen.getByLabelText("library.opds.form.name");
    await user.clear(name);
    await user.type(name, "First update");
    await user.type(screen.getByLabelText("library.opds.form.password"), "first-secret");
    await user.click(screen.getByRole("button", { name: "library.opds.save" }));
    expect(updateCatalog).toHaveBeenCalledOnce();

    harness.forceOpen(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    harness.forceOpen(true);
    const reopenedDialog = await screen.findByRole("dialog", {
      name: "library.opds.form.editTitle",
    });
    const reopenedName = screen.getByLabelText("library.opds.form.name");
    const reopenedPassword = screen.getByLabelText("library.opds.form.password");
    await user.clear(reopenedName);
    await user.type(reopenedName, "Second update");
    await user.type(reopenedPassword, "second-secret");

    const reopenedSave = screen.getByRole("button", { name: "library.opds.save" });
    expect((reopenedName as HTMLInputElement).disabled).toBe(false);
    expect((reopenedPassword as HTMLInputElement).disabled).toBe(false);
    expect(reopenedDialog.getAttribute("aria-busy")).toBe("false");
    expect((reopenedSave as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(reopenedSave.closest("form") as HTMLFormElement);
    expect(updateCatalog).toHaveBeenCalledOnce();

    firstSave.resolve();
    await waitFor(() => expect((reopenedSave as HTMLButtonElement).disabled).toBe(false));
    expect((reopenedName as HTMLInputElement).value).toBe("Second update");
    expect((reopenedPassword as HTMLInputElement).value).toBe("second-secret");
    expect(harness.onSaved).not.toHaveBeenCalled();
    expect(harness.onBackgroundSaved).toHaveBeenCalledOnce();

    await user.click(reopenedSave);
    expect(updateCatalog).toHaveBeenCalledTimes(2);
    expect(updateCatalog.mock.calls[1]?.[1]).toMatchObject({
      name: "Second update",
      password: "second-secret",
    });
    secondSave.resolve();
    await waitFor(() => expect(harness.onSaved).toHaveBeenCalledOnce());
  });
});
