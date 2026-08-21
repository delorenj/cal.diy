import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeVapidPublicKey, WebPushContext, WebPushProvider } from "./WebPushContext";

const VALID_VAPID_PUBLIC_KEY =
  "BIds0AQJ96xGBjTSMHTOqLBLutQE7Lu32KKdgSdy7A2cS4mKI2cgb3iGkhDJa5Siy-stezyuPm8qpbhmNxdNHMw";

const {
  mockAddSubscription,
  mockGetSubscription,
  mockPushManagerSubscribe,
  mockRegister,
  mockRemoveSubscription,
  mockRequestPermission,
  mockShowToast,
} = vi.hoisted(() => ({
  mockAddSubscription: vi.fn(),
  mockGetSubscription: vi.fn(),
  mockPushManagerSubscribe: vi.fn(),
  mockRegister: vi.fn(),
  mockRemoveSubscription: vi.fn(),
  mockRequestPermission: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      loggedInViewerRouter: {
        addNotificationsSubscription: {
          useMutation: () => ({ mutate: mockAddSubscription }),
        },
        removeNotificationsSubscription: {
          useMutation: () => ({ mutate: mockRemoveSubscription }),
        },
      },
    },
  },
}));

vi.mock("@calcom/ui/components/toast", () => ({
  showToast: mockShowToast,
}));

function SubscribeButton() {
  const webPush = useContext(WebPushContext);

  if (!webPush) throw new Error("WebPushContext is unavailable");

  return <button onClick={() => void webPush.subscribe()}>Enable notifications</button>;
}

describe("decodeVapidPublicKey", () => {
  it.each([
    ["a missing key", undefined],
    ["an empty key", ""],
    ["non-base64url characters", "not+a/vapid=key"],
    ["the wrong decoded length", "BA"],
    ["the wrong uncompressed point prefix", `A${VALID_VAPID_PUBLIC_KEY.slice(1)}`],
  ])("rejects %s", (_description, publicKey) => {
    expect(decodeVapidPublicKey(publicKey)).toBeNull();
  });

  it("decodes an uncompressed P-256 public key", () => {
    const publicKey = decodeVapidPublicKey(VALID_VAPID_PUBLIC_KEY);

    expect(publicKey).toHaveLength(65);
    expect(publicKey?.[0]).toBe(0x04);
  });
});

describe("WebPushProvider subscription configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSubscription.mockResolvedValue(null);
    mockPushManagerSubscribe.mockResolvedValue({ endpoint: "https://push.example.test/subscription" });
    mockRegister.mockResolvedValue({
      pushManager: {
        getSubscription: mockGetSubscription,
        subscribe: mockPushManagerSubscribe,
      },
    });
    mockRequestPermission.mockResolvedValue("granted");

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: mockRegister },
    });
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: mockRequestPermission,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["missing", ""],
    ["invalid", "not-a-vapid-public-key"],
  ])("does not request permission or subscribe when the VAPID key is %s", async (_description, publicKey) => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", publicKey);
    const user = userEvent.setup();

    render(
      <WebPushProvider>
        <SubscribeButton />
      </WebPushProvider>
    );
    await waitFor(() => expect(mockGetSubscription).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Push notifications are not configured on this server",
        "error"
      )
    );
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockPushManagerSubscribe).not.toHaveBeenCalled();
    expect(mockAddSubscription).not.toHaveBeenCalled();
  });

  it("subscribes with a valid VAPID public key", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", VALID_VAPID_PUBLIC_KEY);
    const user = userEvent.setup();

    render(
      <WebPushProvider>
        <SubscribeButton />
      </WebPushProvider>
    );
    await waitFor(() => expect(mockGetSubscription).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() => expect(mockPushManagerSubscribe).toHaveBeenCalledOnce());
    expect(mockPushManagerSubscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidPublicKey(VALID_VAPID_PUBLIC_KEY),
    });
    expect(mockAddSubscription).toHaveBeenCalledOnce();
    expect(mockShowToast).toHaveBeenCalledWith("Notifications enabled successfully", "success");
  });
});
