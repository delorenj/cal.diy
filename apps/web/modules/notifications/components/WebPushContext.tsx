"use client";

import { trpc } from "@calcom/trpc/react";
import { showToast } from "@calcom/ui/components/toast";
import { createContext, useEffect, useMemo, useState } from "react";

interface WebPushContextProps {
  permission: NotificationPermission;
  isLoading: boolean;
  isSubscribed: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export const WebPushContext = createContext<WebPushContextProps | null>(null);

interface ProviderProps {
  children: React.ReactNode;
}

const VAPID_PUBLIC_KEY_BYTE_LENGTH = 65;
const UNCOMPRESSED_POINT_PREFIX = 0x04;
const PUSH_NOTIFICATIONS_CONFIGURATION_ERROR = "Push notifications are not configured on this server";

export function WebPushProvider({ children }: ProviderProps) {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied"
  );
  const [pushManager, setPushManager] = useState<PushManager | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const { mutate: addSubscription } =
    trpc.viewer.loggedInViewerRouter.addNotificationsSubscription.useMutation();
  const { mutate: removeSubscription } =
    trpc.viewer.loggedInViewerRouter.removeNotificationsSubscription.useMutation();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/service-worker.js")
      .then(async (registration) => {
        if ("pushManager" in registration) {
          setPushManager(registration.pushManager);
          const subscription = await registration.pushManager.getSubscription();
          setIsSubscribed(!!subscription);
        }
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  }, []);

  const contextValue = useMemo(
    () => ({
      permission,
      isLoading,
      isSubscribed,
      subscribe: async () => {
        try {
          setIsLoading(true);
          const applicationServerKey = decodeVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

          if (!applicationServerKey) {
            console.error(
              "Push notification configuration is invalid: NEXT_PUBLIC_VAPID_PUBLIC_KEY must be an uncompressed P-256 public key"
            );
            showToast(PUSH_NOTIFICATIONS_CONFIGURATION_ERROR, "error");
            return;
          }

          const newPermission = await Notification.requestPermission();
          setPermission(newPermission);

          if (newPermission === "granted" && pushManager) {
            const subscription = await pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey,
            });
            addSubscription({ subscription: JSON.stringify(subscription) });
            setIsSubscribed(true);
            showToast("Notifications enabled successfully", "success");
          }
        } catch (error) {
          console.error("Failed to subscribe:", error);
          if (
            error instanceof DOMException &&
            error.name === "InvalidAccessError" &&
            error.message.includes("applicationServerKey")
          ) {
            showToast(PUSH_NOTIFICATIONS_CONFIGURATION_ERROR, "error");
          } else {
            showToast("Failed to enable notifications", "error");
          }
        } finally {
          setIsLoading(false);
        }
      },
      unsubscribe: async () => {
        if (!pushManager) return;
        try {
          setIsLoading(true);
          const subscription = await pushManager.getSubscription();
          if (subscription) {
            const subscriptionJson = JSON.stringify(subscription);
            await subscription.unsubscribe();
            removeSubscription({ subscription: subscriptionJson });
            setIsSubscribed(false);
            showToast("Notifications disabled successfully", "success");
          }
        } catch (error) {
          console.error("Failed to unsubscribe:", error);
          showToast("Failed to disable notifications", "error");
        } finally {
          setIsLoading(false);
        }
      },
    }),
    [permission, isLoading, isSubscribed, pushManager, addSubscription, removeSubscription]
  );

  return <WebPushContext.Provider value={contextValue}>{children}</WebPushContext.Provider>;
}

export function decodeVapidPublicKey(base64Url: string | undefined): Uint8Array | null {
  if (!base64Url || !/^[A-Za-z0-9_-]+={0,2}$/.test(base64Url)) return null;

  const unpaddedBase64Url = base64Url.replace(/=+$/, "");
  if (unpaddedBase64Url.length % 4 === 1) return null;

  const padding = "=".repeat((4 - (unpaddedBase64Url.length % 4)) % 4);
  const base64 = (unpaddedBase64Url + padding).replace(/-/g, "+").replace(/_/g, "/");

  try {
    const rawData = globalThis.atob(base64);
    if (
      rawData.length !== VAPID_PUBLIC_KEY_BYTE_LENGTH ||
      rawData.charCodeAt(0) !== UNCOMPRESSED_POINT_PREFIX
    ) {
      return null;
    }

    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  } catch {
    return null;
  }
}
