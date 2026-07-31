import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./login-view";

const { mockPush, mockSearchParams, mockSignIn } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSearchParams: vi.fn(),
  mockSignIn: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  signIn: mockSignIn,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@calcom/lib/hooks/useCompatSearchParams", () => ({
  useCompatSearchParams: mockSearchParams,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@calcom/web/modules/auth/hooks/useLastUsed", () => ({
  LastUsed: () => null,
  useLastUsed: () => [null, vi.fn()],
}));

vi.mock("@calcom/web/components/AddToHomescreen", () => ({
  default: () => null,
}));

vi.mock("@calcom/web/components/auth/TwoFactor", async () => {
  const { useFormContext } = await vi.importActual<typeof import("react-hook-form")>("react-hook-form");

  return {
    default: () => {
      const { register } = useFormContext();

      return <input aria-label="2fa_code" {...register("totpCode")} />;
    },
  };
});

vi.mock("@calcom/web/components/auth/BackupCode", () => ({
  default: () => null,
}));

describe("Login OAuth TOTP continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.mockReturnValue(
      new URLSearchParams("totp=header.payload.signature&callbackUrl=%2Fsettings%2Fprofile")
    );
    mockSignIn.mockResolvedValue(null);
  });

  it("submits the verified email and signed token without a password", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <Login
        csrfToken="csrf-token"
        isGoogleLoginEnabled
        isOutlookLoginEnabled={false}
        totpEmail="oauth-user@example.com"
      />
    );

    expect(container.querySelector('input[name="email"]')).toHaveValue("oauth-user@example.com");

    await user.type(screen.getByLabelText("2fa_code"), "123456");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledOnce());

    const [provider, credentials] = mockSignIn.mock.calls[0];
    expect(provider).toBe("credentials");
    expect(credentials).toMatchObject({
      email: "oauth-user@example.com",
      totpCode: "123456",
      totpToken: "header.payload.signature",
      csrfToken: "csrf-token",
      redirect: false,
    });
    expect(credentials).not.toHaveProperty("password");
  });
});
